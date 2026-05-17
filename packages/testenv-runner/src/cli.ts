#!/usr/bin/env node
/**
 * testenv-run CLI
 *
 * Usage:
 *   testenv-run <manifest-path> [options]
 *
 * Options:
 *   --profile <name>      Run profile (default: from manifest or "default")
 *   --slot <id>           Slot identifier (default: auto-generated)
 *   --workdir <path>      Working directory (default: cwd)
 *   --src <path>          Source path for git clone (template var {src})
 *   --commit <hash>       Git commit hash of code under test
 *   --branch <name>       Git branch of code under test
 *   --run-class <class>   Run classification: red|green|regression|adhoc (default: adhoc)
 *   --spec-version <hash> Spec version (commit hash of .testenv dir)
 *   --concurrency <n>     Max parallel test actions (default: 4)
 *   --no-stream           Disable streaming NDJSON to stdout
 *   --output <path>       Write RunResult JSON to file instead of (or in addition to) stdout
 *   --help                Show this help
 *
 * Exit codes:
 *   0 — all phases passed
 *   1 — one or more phases failed
 *   2 — manifest validation error or CLI usage error
 */

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateManifest, formatValidationErrors } from '@akhera-horus/testenv';
import { run } from './runner.js';

// ---------------------------------------------------------------------------
// Arg parsing (no external dep — keep runner-core lean)
// ---------------------------------------------------------------------------

interface CliArgs {
  manifestPath: string;
  profile?: string;
  slot?: string;
  workdir?: string;
  src?: string;
  commit?: string;
  branch?: string;
  runClass?: 'red' | 'green' | 'regression' | 'adhoc';
  specVersion?: string;
  concurrency: number;
  stream: boolean;
  output?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs | null {
  const args = argv.slice(2); // strip node + script

  if (args.includes('--help') || args.includes('-h')) {
    return null; // triggers help display
  }

  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  const manifestPath = args.find((a) => !a.startsWith('-'));
  if (!manifestPath) {
    return null;
  }

  const runClassRaw = get('--run-class');
  const validRunClasses = ['red', 'green', 'regression', 'adhoc'] as const;
  const runClass =
    runClassRaw && (validRunClasses as readonly string[]).includes(runClassRaw)
      ? (runClassRaw as 'red' | 'green' | 'regression' | 'adhoc')
      : 'adhoc';

  const concurrencyRaw = get('--concurrency');
  const concurrency = concurrencyRaw ? parseInt(concurrencyRaw, 10) : 4;

  return {
    manifestPath: resolve(manifestPath),
    profile: get('--profile'),
    slot: get('--slot'),
    workdir: get('--workdir'),
    src: get('--src'),
    commit: get('--commit'),
    branch: get('--branch'),
    runClass,
    specVersion: get('--spec-version'),
    concurrency: isNaN(concurrency) ? 4 : concurrency,
    stream: !args.includes('--no-stream'),
    output: get('--output'),
    help: false,
  };
}

function printHelp(): void {
  process.stderr.write(`
testenv-run — deterministic testenv/v1 phase executor

Usage:
  testenv-run <manifest.yaml> [options]

Options:
  --profile <name>         Run profile (e.g. "laptop", "cloud")
  --slot <id>              Slot identifier (default: auto-generated)
  --workdir <path>         Working directory for commands (default: cwd)
  --src <path>             Source path for {src} template variable
  --commit <hash>          Git commit hash of code under test
  --branch <name>          Git branch of code under test
  --run-class <class>      red|green|regression|adhoc (default: adhoc)
  --spec-version <hash>    Spec version (commit hash of .testenv dir)
  --concurrency <n>        Max parallel test actions (default: 4)
  --no-stream              Suppress streaming NDJSON event log to stdout
  --output <path>          Write RunResult JSON to this file
  --help                   Show this help

Exit codes:
  0  All phases passed
  1  One or more phases failed
  2  Manifest validation error or usage error

Event log format:
  Each event is emitted to stdout as NDJSON:
  {"ts":"...","severity":"info","phase":"setup","message":"..."}

RunResult:
  The final RunResult JSON is emitted to stderr (or --output file).
  It conforms to testenv/v1/result schema.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!args) {
    printHelp();
    process.exit(2);
  }

  // Load and validate manifest
  let raw: unknown;
  try {
    const content = readFileSync(args.manifestPath, 'utf-8');
    raw = parseYaml(content);
  } catch (e) {
    process.stderr.write(`error: cannot read manifest at "${args.manifestPath}": ${(e as Error).message}\n`);
    process.exit(2);
  }

  const validation = validateManifest(raw);
  if (!validation.ok) {
    process.stderr.write(`error: manifest validation failed:\n${formatValidationErrors(validation.errors)}\n`);
    process.exit(2);
  }

  const manifest = validation.data;

  // Execute
  const result = await run(manifest, {
    profile: args.profile,
    slot: args.slot,
    workdir: args.workdir,
    src: args.src,
    commit: args.commit,
    branch: args.branch,
    runClass: args.runClass,
    specVersion: args.specVersion,
    concurrency: args.concurrency,
    stream: args.stream,
  });

  // Write RunResult
  const resultJson = JSON.stringify(result, null, 2);

  if (args.output) {
    writeFileSync(args.output, resultJson, 'utf-8');
    process.stderr.write(`RunResult written to: ${args.output}\n`);
  } else {
    // Write to stderr to keep stdout clean for NDJSON event stream
    process.stderr.write('\n--- RunResult ---\n');
    process.stderr.write(resultJson + '\n');
  }

  process.exit(result.verdict === 'pass' ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(2);
});
