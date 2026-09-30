import type { WebSocket } from 'ws';
import { store, Song } from './db';
import { ownerTag, Role } from './auth';
import { player, processing } from './state';
import { joinUrl, mdnsUrl } from './net';

export interface Client { ws: WebSocket; role: Role; id: string; alive: boolean }
export const clients = new Set<Client>();

export const publicSong = (s: Song) => {
  const { owner, ...rest } = s;
  return { ...rest, ownerTag: ownerTag(owner), thumb: `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg` };
};

export function snapshot() {
  const list = [...clients];
  return {
    player: { ...player },
    queue: store.active().map(publicSong),
    settings: store.settings(),
    processing: { ...processing },
    devices: { users: list.filter((c) => c.role !== 'tv').length, tv: list.filter((c) => c.role === 'tv').length },
    net: { url: joinUrl(), mdns: mdnsUrl() },
  };
}

const send = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
};

/** Envia o evento específico e, em seguida, o estado completo (clientes só precisam renderizar STATE). */
export function emit(type: string, payload: unknown = null) {
  if (type !== 'STATE') send({ type, payload });
  send({ type: 'STATE', payload: snapshot() });
}
