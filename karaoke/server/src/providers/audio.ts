import { config } from '../config';
import { run } from '../proc';

/**
 * AudioSource: único ponto que sabe COMO obter áudio. Para trocar de fonte (arquivos locais,
 * outro serviço licenciado), implemente esta interface e altere `audioSource` no final do arquivo.
 * O uso do yt-dlp/YouTube está sujeito aos termos de uso do serviço: use apenas conteúdo que você tem direito de usar.
 */
export interface Track { videoId: string; title: string; artist: string; duration: number }
export interface AudioSource {
  search(query: string): Promise<Track[]>;
  resolveUrl(url: string): Promise<Track>;
  /** Baixa o áudio para `outTemplate` (com %(ext)s) e retorna o caminho do arquivo. */
  fetchAudio(videoId: string, workDir: string, onProgress: (pct: number) => void): Promise<string>;
}

const ID_RE = /^[\w-]{11}$/;
export const isVideoId = (s: string) => ID_RE.test(s);

export function parseYoutubeUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Link inválido'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Link inválido');
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host === 'youtube.com') id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1] ?? '';
  else throw new Error('Apenas links do YouTube são aceitos');
  if (!ID_RE.test(id)) throw new Error('Não encontrei o ID do vídeo no link');
  return id;
}

const NOISE = /\s*[\(\[][^)\]]*(official|video|lyric|audio|clipe|ao vivo|live|hd|4k|karaoke|legendado|visualizer)[^)\]]*[\)\]]/gi;
export function splitTitle(rawTitle: string, channel: string): { title: string; artist: string } {
  const clean = rawTitle.replace(NOISE, '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: channel.replace(/\s*-\s*Topic$|VEVO$/i, '').trim(), title: clean };
}

const toTrack = (j: any): Track => {
  const { title, artist } = splitTitle(String(j.title ?? ''), String(j.channel ?? j.uploader ?? ''));
  return { videoId: String(j.id), title, artist, duration: Math.round(Number(j.duration ?? 0)) };
};

const cache = new Map<string, { at: number; v: Track[] }>();

export const ytdlpSource: AudioSource = {
  async search(query) {
    const q = query.trim().slice(0, 100);
    const hit = cache.get(q.toLowerCase());
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v;
    const r = await run(config.ytdlp, ['--no-warnings', '--flat-playlist', '-j', `ytsearch8:${q}`], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error('Busca indisponível (verifique a internet e o yt-dlp)');
    const v = r.stdout.split('\n').filter(Boolean).map((l) => { try { return toTrack(JSON.parse(l)); } catch { return null; } })
      .filter((t): t is Track => !!t && ID_RE.test(t.videoId));
    cache.set(q.toLowerCase(), { at: Date.now(), v });
    return v;
  },
  async resolveUrl(url) {
    const id = parseYoutubeUrl(url);
    const r = await run(config.ytdlp, ['--no-warnings', '--no-playlist', '-j', `https://www.youtube.com/watch?v=${id}`], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error('Não consegui ler esse vídeo');
    return toTrack(JSON.parse(r.stdout.split('\n')[0]));
  },
  async fetchAudio(videoId, workDir, onProgress) {
    if (!ID_RE.test(videoId)) throw new Error('ID inválido');
    const r = await run(config.ytdlp, [
      '--no-warnings', '--no-playlist', '--newline', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3',
      '-o', `${workDir}/original.%(ext)s`, `https://www.youtube.com/watch?v=${videoId}`,
    ], {
      timeoutMs: config.timeouts.download,
      onChunk: (t) => { const m = [...t.matchAll(/(\d+(?:\.\d+)?)%/g)].pop(); if (m) onProgress(Number(m[1])); },
    });
    if (r.code !== 0) throw new Error('Falha ao obter o áudio');
    return `${workDir}/original.mp3`;
  },
};

export const audioSource: AudioSource = ytdlpSource;
