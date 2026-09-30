import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { store, Song } from './db';
import { emit } from './hub';
import { processing } from './state';
import { advance } from './player';
import { audioSource } from './providers/audio';
import { findLyrics, writeLyrics } from './providers/lyrics';
import { run } from './proc';

const exists = (p: string) => fs.existsSync(p);
let busy = false;
const inflight = new Map<string, Promise<void>>(); // dedupe por videoId

function report(song: Song, stage: string, progress: number) {
  progress = Math.round(progress);
  const changed = processing.stage !== stage || Math.abs(progress - processing.progress) >= 2;
  Object.assign(processing, { songId: song.id, stage, progress });
  store.patch(song.id, { stage, progress });
  if (changed) emit('PROCESSING_PROGRESS', { songId: song.id, stage, progress });
}

async function retry<T>(n: number, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500)); } }
  throw last;
}

async function buildInstrumental(song: Song) {
  const dir = path.join(config.cacheDir, song.videoId);
  const out = path.join(dir, 'instrumental.mp3');
  if (exists(out)) { fs.utimesSync(out, new Date(), new Date()); return; }
  const work = path.join(dir, 'work');
  fs.mkdirSync(work, { recursive: true });
  try {
    report(song, 'Baixando áudio', 0);
    const original = await retry(2, () => audioSource.fetchAudio(song.videoId, work, (p) => report(song, 'Baixando áudio', p * 0.25)));
    let source = original;
    if (config.audioMode === 'demucs') {
      report(song, 'Removendo vocais', 25);
      const sep = await run(config.python, [
        path.resolve('worker/separate.py'), '--input', original, '--out-dir', path.join(work, 'stems'),
        '--model', config.demucsModel, '--device', config.demucsDevice,
      ], {
        timeoutMs: config.timeouts.separate,
        onChunk: (t) => { const m = [...t.matchAll(/PROGRESS (\d+)/g)].pop(); if (m) report(song, 'Removendo vocais', 25 + Number(m[1]) * 0.6); },
      });
      const line = sep.stdout.split('\n').find((l) => l.startsWith('RESULT '));
      if (sep.code !== 0 || !line) throw new Error('Separação de vocais falhou: ' + (sep.stderr.split('\n').filter(Boolean).pop() ?? ''));
      source = line.slice(7).trim();
    }
    report(song, 'Normalizando', 88);
    const tmp = path.join(work, 'out.mp3');
    const ff = await run(config.ffmpeg, ['-y', '-i', source, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '44100', '-b:a', store.settings().audioQuality, tmp], { timeoutMs: config.timeouts.ffmpeg });
    if (ff.code !== 0 || !exists(tmp)) throw new Error('FFmpeg falhou');
    fs.renameSync(tmp, out); // vocais/originais nunca ficam guardados: apenas o instrumental
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function processSong(song: Song) {
  store.patch(song.id, { status: 'processing', attempts: song.attempts + 1, error: null });
  emit('PROCESSING_STARTED', { songId: song.id });
  try {
    let p = inflight.get(song.videoId);
    if (!p) { p = buildInstrumental(song).finally(() => inflight.delete(song.videoId)); inflight.set(song.videoId, p); }
    await p;
    report(song, 'Buscando letra', 92);
    const lyr = await findLyrics({ title: song.title, artist: song.artist, duration: song.duration });
    writeLyrics(song.id, lyr ?? { source: 'none', synced: false, lines: [] }); // sem letra: toca só o instrumental
    store.patch(song.id, { status: 'ready', stage: '', progress: 100 });
  } catch (e) {
    console.error(`[pipeline] música ${song.id}:`, (e as Error).message);
    store.patch(song.id, { status: 'error', error: (e as Error).message.slice(0, 200) });
  }
  Object.assign(processing, { songId: null, stage: '', progress: 0 });
  emit('PROCESSING_FINISHED', { songId: song.id });
}

/** Processa uma música por vez, na ordem da fila; erro em uma nunca trava as outras. */
export async function kick() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const next = store.byStatus('queued')[0];
      if (!next) break;
      await processSong(next);
      advance();
    }
  } finally { busy = false; }
}

export function retrySong(id: number) {
  const s = store.get(id);
  if (s?.status === 'error') { store.patch(id, { status: 'queued', error: null, progress: 0 }); emit('QUEUE_UPDATED'); kick(); }
}

/** Limpeza automática do cache temporário e de letras antigas. */
export function startCleanup() {
  const sweep = () => {
    try {
      const keep = new Set(store.active().map((s) => s.videoId));
      for (const d of fs.existsSync(config.cacheDir) ? fs.readdirSync(config.cacheDir) : []) {
        const p = path.join(config.cacheDir, d);
        if (!keep.has(d) && Date.now() - fs.statSync(p).mtimeMs > config.cacheTtlMs) fs.rmSync(p, { recursive: true, force: true });
      }
      const alive = new Set(store.active().map((s) => `${s.id}.json`));
      for (const f of fs.readdirSync(config.lyricsDir)) {
        const p = path.join(config.lyricsDir, f);
        if (f.endsWith('.json') && !alive.has(f) && Date.now() - fs.statSync(p).mtimeMs > config.cacheTtlMs) fs.rmSync(p);
      }
      store.prune(24 * 3_600_000);
    } catch (e) { console.warn('[cleanup]', (e as Error).message); }
  };
  sweep();
  setInterval(sweep, 3_600_000).unref();
}
