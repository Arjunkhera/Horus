import { execFile } from 'child_process';
import { promisify } from 'util';
import { ForgeError } from '../adapters/errors.js';

const execFileAsync = promisify(execFile);

/** Permission modes accepted by `claude --permission-mode`. */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** Options for spawning a headless Claude Code agent session rooted at a worktree. */
export interface SpawnAgentOptions {
  /** The task spec handed to the agent as its initial prompt. */
  prompt: string;
  /**
   * Working directory the session is rooted at — MUST be the worktree.
   * cwd = worktree is what makes Claude Code auto-load the repo's CLAUDE.md /
   * .claude/skills / settings (the "Note-9" fix).
   */
  cwd: string;
  /** Resume an existing Claude Code conversation by its session_id. */
  resume?: string;
  /**
   * Permission mode for the headless run. Defaults to 'acceptEdits' so an
   * isolated-worktree edit session can apply changes without interactive prompts.
   */
  permissionMode?: AgentPermissionMode;
  /** Restrict the tool set (passed as a comma-joined --allowedTools list). */
  allowedTools?: string[];
  /** Cap the number of agent turns. */
  maxTurns?: number;
  /** Subprocess timeout in ms. 0 (default) disables it — coding runs are long. */
  timeoutMs?: number;
  /** Path/name of the claude binary. Defaults to $CLAUDE_BIN or 'claude'. */
  claudeBin?: string;
}

/** Result of a headless agent run, parsed from `claude -p --output-format json`. */
export interface SpawnAgentResult {
  /** The Claude Code session_id — persist this for --resume and provenance. */
  claudeSessionId: string;
  /** The agent's final result text. */
  result: string;
  /** Whether Claude reported the run as an error. */
  isError: boolean;
  /** Total cost in USD, when reported. */
  costUsd?: number;
  /** Number of agent turns, when reported. */
  numTurns?: number;
  /** The full parsed JSON payload, for callers that need more. */
  raw: Record<string, unknown>;
}

/** Headless JSON results can be large (full transcript summaries); give stdout plenty of room. */
const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB

function resolveClaudeBin(opts: SpawnAgentOptions): string {
  return opts.claudeBin ?? process.env.CLAUDE_BIN ?? 'claude';
}

/**
 * Build the argv for a NON-BARE headless run. `--bare` is intentionally NEVER
 * added: it would skip CLAUDE.md / skills / settings discovery AND the OAuth
 * credential inheritance — exactly the behaviours the edit flow depends on.
 */
export function buildClaudeArgs(opts: SpawnAgentOptions): string[] {
  const args: string[] = ['-p', opts.prompt, '--output-format', 'json'];
  if (opts.resume) args.push('--resume', opts.resume);
  args.push('--permission-mode', opts.permissionMode ?? 'acceptEdits');
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  if (typeof opts.maxTurns === 'number') {
    args.push('--max-turns', String(opts.maxTurns));
  }
  return args;
}

/**
 * Spawn a non-bare headless Claude Code session rooted at `cwd` and capture the
 * Claude session_id from its JSON result.
 *
 * Horus orchestrates; Claude Code executes. This is the single edit-flow
 * primitive (Shape-1): the worktree is the project root, so the repo's own
 * config loads natively, and the subscription credential is inherited.
 */
export async function spawnAgentSession(opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  const bin = resolveClaudeBin(opts);
  const args = buildClaudeArgs(opts);

  let stdout: string;
  try {
    const res = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 0,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8', // guarantee string stdout (and string err.stdout on the salvage path)
    });
    stdout = res.stdout;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new ForgeError(
        'AGENT_BIN_NOT_FOUND',
        `Claude Code binary "${bin}" was not found on PATH.`,
        `Install Claude Code or set CLAUDE_BIN to its absolute path. The edit-flow spawn requires a non-bare claude executable.`,
      );
    }
    // Some failures still emit a JSON result on stdout (e.g. is_error: true) — try to use it.
    const salvaged = typeof err?.stdout === 'string' ? err.stdout : '';
    if (salvaged.trim()) {
      stdout = salvaged;
    } else {
      throw new ForgeError(
        'AGENT_SPAWN_FAILED',
        `Headless claude run failed (cwd=${opts.cwd}): ${err?.message ?? 'unknown error'}`,
        `Verify the worktree is valid and the claude session can authenticate (non-bare inherits the logged-in credential).`,
      );
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ForgeError(
      'AGENT_OUTPUT_UNPARSEABLE',
      `Could not parse JSON from "claude --output-format json" (cwd=${opts.cwd}).`,
      `First 400 chars of output: ${stdout.slice(0, 400)}`,
    );
  }

  const claudeSessionId = (parsed['session_id'] ?? parsed['sessionId']) as string | undefined;
  if (!claudeSessionId) {
    throw new ForgeError(
      'AGENT_OUTPUT_MISSING_SESSION_ID',
      `"claude --output-format json" did not return a session_id (cwd=${opts.cwd}).`,
      `session_id is required for resume + provenance. Confirm the Claude Code version supports --output-format json.`,
    );
  }

  return {
    claudeSessionId,
    result: typeof parsed['result'] === 'string' ? (parsed['result'] as string) : '',
    isError: parsed['is_error'] === true,
    costUsd: typeof parsed['total_cost_usd'] === 'number' ? (parsed['total_cost_usd'] as number) : undefined,
    numTurns: typeof parsed['num_turns'] === 'number' ? (parsed['num_turns'] as number) : undefined,
    raw: parsed,
  };
}
