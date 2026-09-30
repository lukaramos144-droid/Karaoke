import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

fs.mkdirSync(config.dataDir, { recursive: true });
const secretFile = path.join(config.dataDir, '.secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = fs.readFileSync(secretFile, 'utf8');

export const adminPassword = config.adminPassword || crypto.randomBytes(4).toString('hex');
export const passwordWasGenerated = !config.adminPassword;

const sig = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url').slice(0, 32);
const safeEq = (a: string, b: string) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export type Role = 'user' | 'admin' | 'tv';
export interface Identity { role: Role; id: string }

export const checkPassword = (p: string) => safeEq(p, adminPassword);
export const ownerTag = (id: string) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);

export function issueUser() {
  const id = crypto.randomBytes(9).toString('hex');
  return { token: `u.${id}.${sig('u.' + id)}`, id };
}
export const issueAdmin = () => {
  const exp = String(Date.now() + 12 * 3_600_000);
  return `a.${exp}.${sig('a.' + exp)}`;
};
export const issueTv = () => `t.0.${sig('t.0')}`;

export function verify(token: string | undefined | null): Identity | null {
  if (!token) return null;
  const [kind, id, mac] = token.split('.');
  if (!kind || !id || !mac || !safeEq(mac, sig(`${kind}.${id}`))) return null;
  if (kind === 'u') return { role: 'user', id };
  if (kind === 't') return { role: 'tv', id };
  if (kind === 'a' && Number(id) > Date.now()) return { role: 'admin', id };
  return null;
}
