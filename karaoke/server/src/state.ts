export const player = {
  status: 'idle' as 'idle' | 'playing' | 'paused',
  songId: null as number | null,
  position: 0,
  startedAt: 0,
  nonce: 0,
  repeat: false,
};
export const processing = { songId: null as number | null, stage: '', progress: 0 };
