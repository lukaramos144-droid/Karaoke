import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config, DEFAULT_SETTINGS, Settings } from './config';

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, 'karaoke.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS songs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '', singer TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', position REAL NOT NULL, duration INTEGER NOT NULL DEFAULT 0,
  lyric_offset REAL NOT NULL DEFAULT 0, error TEXT, progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, finished_at INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export type SongStatus = 'queued' | 'processing' | 'ready' | 'playing' | 'done' | 'error';
export interface Song {
  id: number; videoId: string; title: string; artist: string; singer: string; owner: string;
  status: SongStatus; position: number; duration: number; offset: number; error: string | null;
  progress: number; stage: string; attempts: number; createdAt: number;
}
const COLS = `id, video_id AS videoId, title, artist, singer, owner, status, position, duration,
  lyric_offset AS offset, error, progress, stage, attempts, created_at AS createdAt`;
const ACTIVE = `('queued','processing','ready','playing','error')`;
const COLMAP: Record<string, string> = {
  title: 'title', artist: 'artist', singer: 'singer', status: 'status', duration: 'duration',
  offset: 'lyric_offset', error: 'error', progress: 'progress', stage: 'stage',
  attempts: 'attempts', position: 'position', finishedAt: 'finished_at',
};

export const store = {
  get: (id: number) => db.prepare(`SELECT ${COLS} FROM songs WHERE id=?`).get(id) as Song | undefined,
  active: () => db.prepare(`SELECT ${COLS} FROM songs WHERE status IN ${ACTIVE} ORDER BY position`).all() as Song[],
  byStatus: (s: SongStatus) => db.prepare(`SELECT ${COLS} FROM songs WHERE status=? ORDER BY position`).all(s) as Song[],
  add(d: { videoId: string; title: string; artist: string; singer: string; owner: string; duration: number }) {
    const max = (db.prepare(`SELECT COALESCE(MAX(position),0) m FROM songs`).get() as { m: number }).m;
    const r = db.prepare(`INSERT INTO songs(video_id,title,artist,singer,owner,duration,position,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(d.videoId, d.title, d.artist, d.singer, d.owner, d.duration, max + 1, Date.now());
    return store.get(Number(r.lastInsertRowid))!;
  },
  patch(id: number, p: Record<string, string | number | null>) {
    const keys = Object.keys(p).filter((k) => k in COLMAP);
    if (!keys.length) return;
    db.prepare(`UPDATE songs SET ${keys.map((k) => COLMAP[k] + '=?').join(',')} WHERE id=?`)
      .run(...keys.map((k) => p[k]), id);
  },
  remove: (id: number) => db.prepare(`DELETE FROM songs WHERE id=?`).run(id),
  clear: () => db.prepare(`DELETE FROM songs WHERE status IN ('queued','processing','ready','error')`).run(),
  move(id: number, index: number) {
    const ids = store.active().map((s) => s.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    const up = db.prepare(`UPDATE songs SET position=? WHERE id=?`);
    db.transaction(() => ids.forEach((sid, i) => up.run(i + 1, sid)))();
  },
  recover() {
    db.prepare(`UPDATE songs SET status='queued', stage='', progress=0 WHERE status='processing'`).run();
    db.prepare(`UPDATE songs SET status='ready' WHERE status='playing'`).run();
  },
  prune(olderThanMs: number) {
    db.prepare(`DELETE FROM songs WHERE status='done' AND finished_at < ?`).run(Date.now() - olderThanMs);
    db.prepare(`DELETE FROM songs WHERE status='error' AND created_at < ?`).run(Date.now() - 30 * 60_000);
  },
  settings(): Settings {
    const row = db.prepare(`SELECT value FROM settings WHERE key='all'`).get() as { value: string } | undefined;
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  },
  saveSettings(p: Partial<Settings>) {
    const next = { ...store.settings(), ...p };
    db.prepare(`INSERT INTO settings(key,value) VALUES('all',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(JSON.stringify(next));
    return next;
  },
};
