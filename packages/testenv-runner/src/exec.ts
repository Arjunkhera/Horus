/**
 * Shell execution helpers.
 *
 * Thin wrappers around child_process for running provisioner commands,
 * steps, and test actions. All output is captured and redacted before logging.
 */

import { spawn } from 'node:child_process';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Timeout in ms. Default: 300_000 (5 min). */
  timeout?: number;
  /** Environment variables to merge with process.env. */
  env?: Record<string, string>;
  /** Working directory. */
  cwd?: string;
}

/**
 * Execute a shell command and return stdout, stderr, and exit code.
 * Always resolves (never rejects) — callers check exitCode.
 */
export function execCommand(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const { timeout = 300_000, env, cwd } = opts;
    const child = spawn('sh', ['-c', cmd], {
      env: { ...process.env, ...(env ?? {}) },
      cwd,
      stdio: 'pipe',
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? -1 : (code ?? -1),
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}
