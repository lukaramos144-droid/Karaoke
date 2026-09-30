import express, { NextFunction, Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Bonjour } from 'bonjour-service';
import { config } from './config';
import { store } from './db';
import { adminPassword, checkPassword, Identity, issueAdmin, issueTv, issueUser, passwordWasGenerated, ownerTag, verify } from './auth';
import { clients, emit, snapshot, Client } from './hub';
import { player } from './state';
import { advance, control, finish, resetPlayer, startWatchdog } from './player';
import { kick, retrySong, startCleanup } from './pipeline';
import { audioSource, isVideoId } from './providers/audio';
import { readLyrics, writeLyrics, parseLrc } from './providers/lyrics';
import { joinUrl, mdnsUrl } from './net';

fs.mkdirSync(config.cacheDir, { recursive: true });
fs.mkdirSync(config.lyricsDir, { recursive: true });
store.recover();
resetPlayer();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
const heavy = rateLimit({ windowMs: 60_000, limit: 30, message: { error: 'Muitas tentativas, aguarde um pouco.' } });
const loginLimit = rateLimit({ windowMs: 60_000, limit: 8, message: { error: 'Muitas tentativas de login.' } });

type Req = Request & { who?: Identity };
const wrap = (fn: (req: Req, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  (async () => fn(req, res))().catch((e) => {
    const status = (e as { status?: number }).status ?? ((e as Error).name === 'ZodError' ? 400 : 400);
    res.status(status).json({ error: (e as Error).message });
    void next;
  });
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const auth = (...roles: Identity['role'][]) => (req: Req, res: Response, next: NextFunction) => {
  const who = verify(req.header('x-token'));
  if (!who || !roles.includes(who.role)) return void res.status(401).json({ error: 'Não autorizado' });
  req.who = who; next();
};
const clean = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim();
const str = (max: number) => z.string().transform(clean).pipe(z.string().max(max));

// ---------- público ----------
app.post('/api/session', wrap((_req, res) => { const { token, id } = issueUser(); res.json({ token, me: ownerTag(id) }); }));
app.get('/api/state', wrap((_req, res) => res.json(snapshot())));
app.get('/api/qr.svg', wrap(async (_req, res) => {
  res.type('image/svg+xml').send(await QRCode.toString(joinUrl(), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0618', light: '#ffffff' } }));
}));
app.get('/api/lyrics/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  res.json({ lyrics: readLyrics(id) ?? { source: 'none', synced: false, lines: [] }, offset: store.get(id)?.offset ?? 0 });
}));
app.get('/media/:file', (req, res) => {
  const m = req.params.file.match(/^([\w-]{11})\.mp3$/);
  const f = m && path.join(config.cacheDir, m[1], 'instrumental.mp3');
  if (!f || !fs.existsSync(f)) return void res.sendStatus(404);
  res.sendFile(f); // suporta Range (seek)
});

// ---------- usuário ----------
const userOrAdmin = auth('user', 'admin');
app.get('/api/search', userOrAdmin, heavy, wrap(async (req, res) => {
  const q = clean(String(req.query.q ?? ''));
  if (q.length < 2) fail(400, 'Digite pelo menos 2 letras');
  res.json({ results: await audioSource.search(q) });
}));
app.post('/api/resolve', userOrAdmin, heavy, wrap(async (req, res) => {
  const { url } = z.object({ url: z.string().max(300) }).parse(req.body);
  res.json({ track: await audioSource.resolveUrl(url) });
}));

const addSchema = z.object({ videoId: z.string(), title: str(120).pipe(z.string().min(1)), artist: str(80).default(''), singer: str(40).default(''), duration: z.number().int().min(0).max(36000).default(0) });
const lastAdd = new Map<string, number>();
function enqueue(body: unknown, owner: string, admin: boolean) {
  const d = addSchema.parse(body);
  if (!isVideoId(d.videoId)) fail(400, 'Vídeo inválido');
  const s = store.settings();
  if (!admin) {
    if (d.duration > s.maxDurationSec) fail(400, `Música longa demais (máx. ${Math.round(s.maxDurationSec / 60)} min)`);
    const wait = ((lastAdd.get(owner) ?? 0) + s.cooldownSec * 1000 - Date.now()) / 1000;
    if (wait > 0) fail(429, `Aguarde ${Math.ceil(wait)}s para adicionar outra música`);
    const mine = store.active().filter((x) => x.owner === owner && x.status !== 'error');
    if (mine.length >= s.maxPerUser) fail(429, `Você já tem ${s.maxPerUser} músicas na fila`);
    if (mine.some((x) => x.videoId === d.videoId)) fail(400, 'Você já adicionou essa música');
    lastAdd.set(owner, Date.now());
  }
  const song = store.add({ ...d, owner });
  emit('SONG_ADDED', { songId: song.id });
  void kick(); advance();
  const position = store.active().findIndex((x) => x.id === song.id) + 1;
  return { id: song.id, position };
}
app.post('/api/queue', userOrAdmin, wrap((req: Req, res) => res.json(enqueue(req.body, req.who!.id, req.who!.role === 'admin'))));
app.delete('/api/queue/:id', userOrAdmin, wrap((req: Req, res) => {
  const song = store.get(Number(req.params.id));
  if (!song) fail(404, 'Música não encontrada');
  if (req.who!.role !== 'admin' && song!.owner !== req.who!.id) fail(403, 'Só quem adicionou pode remover');
  if (song!.status === 'playing') fail(400, 'Essa música está tocando');
  store.remove(song!.id);
  emit('SONG_REMOVED', { songId: song!.id });
  res.json({ ok: true });
}));

// ---------- TV e admin ----------
const isLoopback = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
app.post('/api/admin/login', loginLimit, wrap((req, res) => {
  const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
  if (!checkPassword(password)) fail(401, 'Senha incorreta');
  res.json({ token: issueAdmin() });
}));
app.get('/api/tv-token', wrap((req, res) => {
  const who = verify(req.header('x-token'));
  if (!isLoopback(req) && who?.role !== 'admin') fail(403, 'Abra a TV no computador principal ou informe a senha');
  res.json({ token: issueTv() });
}));

const admin = auth('admin');
app.post('/api/admin/control', admin, wrap((req, res) => { control(z.object({ action: z.string() }).parse(req.body).action); res.json({ ok: true }); }));
app.post('/api/admin/move', admin, wrap((req, res) => {
  const { id, index } = z.object({ id: z.number(), index: z.number().int() }).parse(req.body);
  store.move(id, index); emit('QUEUE_UPDATED'); res.json({ ok: true });
}));
app.post('/api/admin/retry/:id', admin, wrap((req, res) => { retrySong(Number(req.params.id)); res.json({ ok: true }); }));
app.get('/api/admin/settings', admin, wrap((_r, res) => res.json(store.settings())));
app.put('/api/admin/settings', admin, wrap((req, res) => {
  const p = z.object({
    maxPerUser: z.number().int().min(1).max(50), cooldownSec: z.number().int().min(0).max(3600),
    maxDurationSec: z.number().int().min(30).max(7200), defaultOffset: z.number().min(-10).max(10),
    showQr: z.boolean(), lyricsSize: z.number().min(50).max(200), animSpeed: z.number().min(0.25).max(3),
    volume: z.number().min(0).max(1), queueMode: z.enum(['fifo', 'shuffle']), theme: z.enum(['neon', 'sunset', 'ice']),
    wifiName: str(40), audioQuality: z.enum(['128k', '192k', '256k']),
  }).partial().parse(req.body);
  res.json(store.saveSettings(p)); emit('QUEUE_UPDATED');
}));
app.put('/api/admin/songs/:id/offset', admin, wrap((req, res) => {
  const { offset } = z.object({ offset: z.number().min(-30).max(30) }).parse(req.body);
  store.patch(Number(req.params.id), { offset }); emit('QUEUE_UPDATED'); res.json({ ok: true });
}));
app.get('/api/admin/songs/:id/lyrics', admin, wrap((req, res) => res.json(readLyrics(Number(req.params.id)) ?? { source: 'none', synced: false, lines: [] })));
app.put('/api/admin/songs/:id/lyrics', admin, wrap((req, res) => {
  const { lrc } = z.object({ lrc: z.string().max(100_000) }).parse(req.body);
  const lines = parseLrc(lrc);
  writeLyrics(Number(req.params.id), { source: 'manual', synced: true, lines });
  emit('QUEUE_UPDATED', { songId: Number(req.params.id) }); res.json({ lines: lines.length });
}));

// ---------- páginas ----------
app.use(express.static(config.publicDir, { extensions: ['html'] }));
app.get('/', (_r, res) => res.sendFile(path.join(config.publicDir, 'mobile.html')));
app.get('/tv', (_r, res) => res.sendFile(path.join(config.publicDir, 'tv.html')));
app.get('/admin', (_r, res) => res.sendFile(path.join(config.publicDir, 'admin.html')));
app.use('/api', (_r, res) => res.status(404).json({ error: 'Não encontrado' }));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  const who = verify(new URL(req.url ?? '', 'http://x').searchParams.get('token'));
  if (!who) return ws.close(1008, 'unauthorized');
  const client: Client = { ws, role: who.role, id: who.id, alive: true };
  clients.add(client);
  ws.on('pong', () => { client.alive = true; });
  ws.on('close', () => { clients.delete(client); emit('STATE'); });
  ws.on('error', () => ws.terminate());
  ws.on('message', (raw) => {
    if (client.role !== 'tv') return;
    try {
      const m = JSON.parse(raw.toString()) as { type: string; songId?: number; t?: number; message?: string };
      if (m.songId !== player.songId || !m.songId) return;
      if (m.type === 'TIME' && typeof m.t === 'number') player.position = m.t;
      else if (m.type === 'ENDED') finish(m.songId, 'ended');
      else if (m.type === 'ERROR') finish(m.songId, 'error', String(m.message ?? 'Falha na reprodução').slice(0, 120));
    } catch { /* mensagem inválida: ignora */ }
  });
  emit('STATE');
});
setInterval(() => wss.clients.forEach((s) => {
  const c = [...clients].find((x) => x.ws === s);
  if (c && !c.alive) return void s.terminate();
  if (c) c.alive = false;
  s.ping();
}), 20_000).unref();

startWatchdog();
startCleanup();
void kick();
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

server.listen(config.port, '0.0.0.0', () => {
  const line = '─'.repeat(54);
  console.log(`\n${line}\n  KARAOKÊ no ar\n  Celulares (QR):  ${joinUrl()}\n  Nome local:      ${mdnsUrl()}\n  TV (neste PC):   http://localhost:${config.port}/tv\n  Painel admin:    http://localhost:${config.port}/admin\n  Senha admin:     ${adminPassword}${passwordWasGenerated ? '  (gerada; defina ADMIN_PASSWORD para fixar)' : ''}\n  Modo de áudio:   ${config.audioMode}\n${line}\n`);
  try { new Bonjour().publish({ name: 'Karaoke', type: 'http', port: config.port, host: `${config.mdnsName}.local` }); }
  catch (e) { console.warn('[mdns] indisponível:', (e as Error).message); }
});
