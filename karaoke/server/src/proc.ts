import { spawn } from 'node:child_process';

export interface RunOpts { timeoutMs: number; onChunk?: (text: string) => void; cwd?: string }

/** Executa um binário SEM shell (argumentos em array => sem injeção de comandos). */
export function run(cmd: string, args: string[], opts: RunOpts): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Tempo esgotado: ${cmd}`)); }, opts.timeoutMs);
    child.stdout.on('data', (d) => { const t = d.toString(); stdout += t; opts.onChunk?.(t); });
    child.stderr.on('data', (d) => { const t = d.toString(); stderr += t.slice(-4000); opts.onChunk?.(t); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Não foi possível executar ${cmd}: ${e.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
