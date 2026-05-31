import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: vi.fn() };
});

import { execFile } from 'child_process';
import { spawnAgentSession, buildClaudeArgs } from '../agent-spawn.js';
import { ForgeError } from '../../adapters/errors.js';

const mockExec = vi.mocked(execFile);

/** Make the mocked execFile resolve with the given stdout (callback form used by promisify). */
function resolveWith(stdout: string): void {
  mockExec.mockImplementation(((_cmd: any, _args: any, _opts: any, cb: any) => {
    cb(null, { stdout, stderr: '' });
    return {} as any;
  }) as any);
}

/** Make the mocked execFile reject with the given error (optionally carrying stdout). */
function rejectWith(err: any): void {
  mockExec.mockImplementation(((_cmd: any, _args: any, _opts: any, cb: any) => {
    cb(err, err?.stdout !== undefined ? { stdout: err.stdout, stderr: '' } : undefined);
    return {} as any;
  }) as any);
}

const goodPayload = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Implemented the feature.',
  session_id: 'claude-sess-abc123',
  total_cost_usd: 0.42,
  num_turns: 7,
});

beforeEach(() => {
  delete process.env.CLAUDE_BIN;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildClaudeArgs', () => {
  it('builds a non-bare headless invocation with JSON output and default acceptEdits', () => {
    const args = buildClaudeArgs({ prompt: 'do the thing', cwd: '/wt' });
    expect(args).toEqual([
      '-p', 'do the thing',
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
    ]);
  });

  it('NEVER includes --bare (would break Note-9 config load + OAuth inheritance)', () => {
    const args = buildClaudeArgs({
      prompt: 'p', cwd: '/wt', resume: 'r', permissionMode: 'bypassPermissions',
      allowedTools: ['Read', 'Edit'], maxTurns: 12,
    });
    expect(args).not.toContain('--bare');
  });

  it('includes --resume, --allowedTools (comma-joined), and --max-turns when provided', () => {
    const args = buildClaudeArgs({
      prompt: 'p', cwd: '/wt', resume: 'sess-prev',
      allowedTools: ['Read', 'Edit', 'Bash'], maxTurns: 5, permissionMode: 'plan',
    });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-prev');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Edit,Bash');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('5');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });
});

describe('spawnAgentSession', () => {
  it('parses session_id, result, cost, and turns from the JSON result', async () => {
    resolveWith(goodPayload);
    const out = await spawnAgentSession({ prompt: 'task', cwd: '/wt' });
    expect(out.claudeSessionId).toBe('claude-sess-abc123');
    expect(out.result).toBe('Implemented the feature.');
    expect(out.isError).toBe(false);
    expect(out.costUsd).toBe(0.42);
    expect(out.numTurns).toBe(7);
  });

  it('spawns the resolved binary rooted at cwd with the built args', async () => {
    resolveWith(goodPayload);
    await spawnAgentSession({ prompt: 'task', cwd: '/the/worktree', claudeBin: '/usr/bin/claude' });
    const [cmd, args, opts] = mockExec.mock.calls[0] as any;
    expect(cmd).toBe('/usr/bin/claude');
    expect(args).toContain('--output-format');
    expect(opts.cwd).toBe('/the/worktree');
  });

  it('honours $CLAUDE_BIN when no claudeBin is passed', async () => {
    process.env.CLAUDE_BIN = '/opt/claude';
    resolveWith(goodPayload);
    await spawnAgentSession({ prompt: 'task', cwd: '/wt' });
    expect((mockExec.mock.calls[0] as any)[0]).toBe('/opt/claude');
  });

  it('salvages a JSON result emitted on stdout even when the process exits non-zero', async () => {
    rejectWith(Object.assign(new Error('exit 1'), {
      code: 1,
      stdout: JSON.stringify({ is_error: true, result: 'failed mid-run', session_id: 'sess-x' }),
    }));
    const out = await spawnAgentSession({ prompt: 'task', cwd: '/wt' });
    expect(out.isError).toBe(true);
    expect(out.claudeSessionId).toBe('sess-x');
  });

  it('throws AGENT_BIN_NOT_FOUND when the claude binary is missing', async () => {
    rejectWith(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    await expect(spawnAgentSession({ prompt: 'task', cwd: '/wt' })).rejects.toMatchObject({
      code: 'AGENT_BIN_NOT_FOUND',
    });
  });

  it('throws AGENT_SPAWN_FAILED when the process fails with no salvageable output', async () => {
    rejectWith(Object.assign(new Error('boom'), { code: 1 }));
    await expect(spawnAgentSession({ prompt: 'task', cwd: '/wt' })).rejects.toBeInstanceOf(ForgeError);
    await expect(spawnAgentSession({ prompt: 'task', cwd: '/wt' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
    });
  });

  it('throws AGENT_OUTPUT_UNPARSEABLE when stdout is not JSON', async () => {
    resolveWith('this is not json');
    await expect(spawnAgentSession({ prompt: 'task', cwd: '/wt' })).rejects.toMatchObject({
      code: 'AGENT_OUTPUT_UNPARSEABLE',
    });
  });

  it('throws AGENT_OUTPUT_MISSING_SESSION_ID when session_id is absent', async () => {
    resolveWith(JSON.stringify({ is_error: false, result: 'ok' }));
    await expect(spawnAgentSession({ prompt: 'task', cwd: '/wt' })).rejects.toMatchObject({
      code: 'AGENT_OUTPUT_MISSING_SESSION_ID',
    });
  });
});
