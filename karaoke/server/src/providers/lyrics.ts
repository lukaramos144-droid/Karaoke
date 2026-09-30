import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export interface LyricLine { t: number; text: string }
export interface Lyrics { source: string; synced: boolean; lines: LyricLine[] }
export interface LyricsQuery { title: string; artist: string; duration: number }
export interface LyricsProvider { name: string; find(q: LyricsQuery): Promise<Lyrics | null> }

export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim();
    if (!stamps.length || !body) continue;
    for (const s of stamps) out.push({ t: Number(s[1]) * 60 + Number(s[2]), text: body });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Sem timestamps: distribui as linhas uniformemente. O admin pode ajustar depois. */
export function spreadEvenly(text: string, duration: number): LyricLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = Math.min(12, duration * 0.08), span = Math.max(duration - start - 10, lines.length * 2);
  return lines.map((l, i) => ({ t: start + (i * span) / Math.max(lines.length, 1), text: l }));
}

/** Letras próprias: data/lyrics/local/<Artista> - <Título>.lrc (ou .txt sem tempo). */
const localProvider: LyricsProvider = {
  name: 'local',
  async find({ title, artist, duration }) {
    const dir = path.join(config.lyricsDir, 'local');
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const want = norm(`${artist} ${title}`);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const ext = path.extname(f).toLowerCase();
      if (!['.lrc', '.txt'].includes(ext) || norm(path.basename(f, ext)) !== want) continue;
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      return ext === '.lrc' ? { source: 'local', synced: true, lines: parseLrc(body) }
        : { source: 'local', synced: false, lines: spreadEvenly(body, duration) };
    }
    return null;
  },
};

/** LRCLIB (lrclib.net): API pública e gratuita de letras, com versões sincronizadas. */
const lrclibProvider: LyricsProvider = {
  name: 'lrclib',
  async find({ title, artist, duration }) {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'karaoke-lan/0.1' } });
    if (!res.ok) return null;
    const items = (await res.json()) as Array<{ duration?: number; syncedLyrics?: string; plainLyrics?: string }>;
    const near = (a: { duration?: number }) => Math.abs((a.duration ?? 0) - duration);
    const sorted = [...items].sort((a, b) => near(a) - near(b));
    const synced = sorted.find((i) => i.syncedLyrics && (!duration || near(i) < 15));
    if (synced) return { source: 'lrclib', synced: true, lines: parseLrc(synced.syncedLyrics!) };
    const plain = sorted.find((i) => i.plainLyrics);
    return plain ? { source: 'lrclib', synced: false, lines: spreadEvenly(plain.plainLyrics!, duration) } : null;
  },
};

/** Ordem de prioridade. Para adicionar uma fonte, implemente LyricsProvider e inclua aqui. */
export const providers: LyricsProvider[] = [localProvider, lrclibProvider];

export async function findLyrics(q: LyricsQuery): Promise<Lyrics | null> {
  let fallback: Lyrics | null = null;
  for (const p of providers) {
    try {
      const l = await p.find(q);
      if (l?.lines.length) { if (l.synced) return l; fallback ??= l; }
    } catch (e) { console.warn(`[lyrics:${p.name}]`, (e as Error).message); }
  }
  return fallback; // sem sincronização automática (alinhamento por áudio) implementada: veja README
}

export const lyricsFile = (songId: number) => path.join(config.lyricsDir, `${songId}.json`);
export const readLyrics = (songId: number): Lyrics | null => {
  try { return JSON.parse(fs.readFileSync(lyricsFile(songId), 'utf8')); } catch { return null; }
};
export const writeLyrics = (songId: number, l: Lyrics) => fs.writeFileSync(lyricsFile(songId), JSON.stringify(l));
