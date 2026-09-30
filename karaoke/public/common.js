export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) n.append(k instanceof Node ? k : String(k ?? ''));
  return n; // sempre textContent/append: nunca innerHTML com dados de usuários
};
export async function api(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erro'), { status: r.status });
  return j;
}
/** WebSocket com reconexão automática (backoff até 5s). */
export function connect(token, onMsg, onStatus = () => {}) {
  let ws, tries = 0, closed = false;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { tries = 0; onStatus(true); };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { onStatus(false); if (!closed) setTimeout(open, Math.min(500 * ++tries, 5000)); };
  };
  open();
  return { send: (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)), close: () => { closed = true; ws.close(); } };
}
export const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const applyTheme = (t) => document.documentElement.setAttribute('data-theme', t || 'neon');
export const statusLabel = { queued: 'Na fila', processing: 'Preparando', ready: 'Pronta', playing: 'Tocando', error: 'Erro' };
