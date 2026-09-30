import path from 'node:path';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? './data');

export const config = {
  port: Number(env.PORT ?? 3000),
  dataDir,
  cacheDir: path.resolve(env.CACHE_DIR ?? path.join(dataDir, 'cache')),
  lyricsDir: path.join(dataDir, 'lyrics'),
  publicDir: path.resolve('public'),
  adminPassword: env.ADMIN_PASSWORD ?? '',
  audioMode: (env.AUDIO_MODE ?? 'demucs') as 'demucs' | 'passthrough',
  demucsModel: env.DEMUCS_MODEL ?? 'htdemucs',
  demucsDevice: env.DEMUCS_DEVICE ?? 'cpu',
  ytdlp: env.YTDLP_BIN ?? 'yt-dlp',
  ffmpeg: env.FFMPEG_BIN ?? 'ffmpeg',
  python: env.PYTHON_BIN ?? 'python3',
  hostIp: env.HOST_IP ?? '',
  mdnsName: env.MDNS_NAME ?? 'karaoke',
  cacheTtlMs: Number(env.CACHE_TTL_HOURS ?? 24) * 3_600_000,
  timeouts: { download: 5 * 60_000, separate: 20 * 60_000, ffmpeg: 3 * 60_000 },
};

export const DEFAULT_SETTINGS = {
  maxPerUser: 3,
  cooldownSec: 20,
  maxDurationSec: 480,
  defaultOffset: 0,
  showQr: true,
  lyricsSize: 100,
  animSpeed: 1,
  volume: 0.9,
  queueMode: 'fifo' as 'fifo' | 'shuffle',
  theme: 'neon' as 'neon' | 'sunset' | 'ice',
  wifiName: env.WIFI_NAME ?? 'CASA-KARAOKE',
  audioQuality: '192k' as '128k' | '192k' | '256k',
};
export type Settings = typeof DEFAULT_SETTINGS;
