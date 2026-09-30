import { store } from './db';
import { player } from './state';
import { emit } from './hub';

const idle = () => { player.status = 'idle'; player.songId = null; player.position = 0; };

/** Escolhe a próxima música pronta. Músicas ainda em processamento ou com erro nunca bloqueiam a fila. */
export function advance() {
  if (player.status !== 'idle') return;
  const ready = store.byStatus('ready');
  if (!ready.length) return emit('STATE');
  const next = store.settings().queueMode === 'shuffle' ? ready[Math.floor(Math.random() * ready.length)] : ready[0];
  store.patch(next.id, { status: 'playing' });
  Object.assign(player, { status: 'playing', songId: next.id, position: 0, startedAt: Date.now() });
  player.nonce++;
  emit('SONG_STARTED', { songId: next.id });
}

export function finish(songId: number, reason: 'ended' | 'skipped' | 'error', message?: string) {
  if (player.songId !== songId) return;
  if (reason === 'ended' && player.repeat) {
    player.position = 0; player.startedAt = Date.now(); player.nonce++;
    return emit('SONG_STARTED', { songId });
  }
  store.patch(songId, reason === 'error' ? { status: 'error', error: message ?? 'Falha na reprodução' } : { status: 'done', finishedAt: Date.now() });
  idle();
  if (reason === 'skipped') emit('SONG_SKIPPED', { songId });
  advance();
}

export function control(action: string) {
  switch (action) {
    case 'pause': if (player.status === 'playing') { player.status = 'paused'; emit('SONG_PAUSED'); } break;
    case 'resume': if (player.status === 'paused') { player.status = 'playing'; emit('SONG_RESUMED'); } break;
    case 'skip': if (player.songId) finish(player.songId, 'skipped'); break;
    case 'restart': if (player.songId) { player.position = 0; player.nonce++; emit('SONG_STARTED', { songId: player.songId }); } break;
    case 'repeat': player.repeat = !player.repeat; emit('STATE'); break;
    case 'shuffle': store.saveSettings({ queueMode: store.settings().queueMode === 'shuffle' ? 'fifo' : 'shuffle' }); emit('STATE'); break;
    case 'clear': store.clear(); emit('QUEUE_UPDATED'); break;
    default: throw new Error('Ação desconhecida');
  }
}

/** Watchdog: se a TV sumir e a música passar muito da duração, libera a fila. */
export function startWatchdog() {
  setInterval(() => {
    if (player.status !== 'playing' || !player.songId) return;
    const s = store.get(player.songId);
    const limit = ((s?.duration || 600) + 45) * 1000;
    if (Date.now() - player.startedAt > limit && player.position < 1) finish(player.songId, 'error', 'TV não respondeu');
  }, 15_000).unref();
}

export function resetPlayer() { idle(); }
