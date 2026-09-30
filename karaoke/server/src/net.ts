import os from 'node:os';
import { config } from './config';

export function lanIp(): string {
  if (config.hostIp) return config.hostIp;
  const all = Object.values(os.networkInterfaces()).flat().filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal);
  const priv = all.find((i) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address));
  return (priv ?? all[0])?.address ?? '127.0.0.1';
}
export const joinUrl = () => `http://${lanIp()}:${config.port}`;
export const mdnsUrl = () => `http://${config.mdnsName}.local${config.port === 80 ? '' : ':' + config.port}`;
