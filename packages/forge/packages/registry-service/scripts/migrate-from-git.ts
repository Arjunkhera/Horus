#!/usr/bin/env tsx
/**
 * migrate-from-git.ts
 *
 * One-shot migration from the existing git-backed Forge registry to the new
 * HTTP registry service.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-git.ts \
 *     --source  https://github.com/Arjunkhera/Forge-Registry \
 *     --target  https://registry.example.com \
 *     --token   <admin-bearer-token> \
 *     [--dry-run]
 *
 * Git registry layout expected on disk:
 *   {type}s/{id}/{version}/metadata.yaml
 *   {type}s/{id}/{version}/<content files…>
 *
 * For every artifact directory the script:
 *   1. Reads all files and base64-encodes them.
 *   2. POSTs to POST /artifacts/{type}/{id}/{version} on the target service.
 *   3. Treats HTTP 409 ("VERSION_CONFLICT") as already-migrated (idempotent).
 *   4. Records success / skip / failure per artifact.
 *
 * After processing all artifacts the script prints a summary report and exits
 * with code 0 on full success or 1 if any artifact failed.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    source:  { type: 'string' },
    target:  { type: 'string' },
    token:   { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

function usage(): never {
  console.error(`
Usage:
  npx tsx scripts/migrate-from-git.ts \\
    --source  <git-repo-url>         \\
    --target  <http-service-url>     \\
    --token   <admin-bearer-token>   \\
    [--dry-run]

Example:
  npx tsx scripts/migrate-from-git.ts \\
    --source  https://github.com/Arjunkhera/Forge-Registry \\
    --target  http://localhost:3000 \\
    --token   abc123 \\
    --dry-run
`.trimStart());
  process.exit(1);
}

if (!args['source'] || !args['target'] || !args['token']) {
  usage();
}

const SOURCE_REPO = args['source']!;
const TARGET_URL  = args['target']!.replace(/\/$/, '');
const TOKEN       = args['token']!;
const DRY_RUN     = args['dry-run'] ?? false;

// ---------------------------------------------------------------------------
// Known artifact types — mirrors SUPPORTED_TYPES in the registry service
// ---------------------------------------------------------------------------

const ARTIFACT_TYPES = ['skill', 'agent', 'plugin', 'persona', 'workspace-config'] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// Map type → directory name used in the git registry layout ({type}s/ or the
// workspace-config special case).
function dirForType(type: ArtifactType): string {
  if (type === 'workspace-config') return 'workspace-configs';
  return `${type}s`;
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

type ArtifactStatus = 'migrated' | 'skipped' | 'failed';

interface ArtifactResult {
  type: ArtifactType;
  id: string;
  version: string;
  status: ArtifactStatus;
  /** Only present on 'failed' */
  error?: string;
  /** SHA-256 of metadata.yaml (used for spot-check) */
  metadataSha256?: string;
  /** SHA-256s reported by the target service after successful publish */
  remoteChecksums?: Array<{ name: string; sha256: string }>;
}

const results: ArtifactResult[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[migrate] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[migrate][WARN] ${msg}`);
}

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Walk a single artifact version directory, collect all files as filename →
 * base64 string pairs.
 */
function collectFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      const buf = readFileSync(fullPath);
      files[entry] = buf.toString('base64');
    }
    // Sub-directories inside a version bundle are not expected in the current
    // layout — skip silently and warn.
    if (stat.isDirectory()) {
      warn(`Skipping sub-directory '${entry}' inside artifact bundle at ${dir}`);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// HTTP publish
// ---------------------------------------------------------------------------

interface PublishResponse {
  files?: Array<{ name: string; sha256: string }>;
  error?: string;
  message?: string;
}

async function publishArtifact(
  type: ArtifactType,
  id: string,
  version: string,
  files: Record<string, string>,
): Promise<{ ok: true; body: PublishResponse } | { ok: false; status: number; body: PublishResponse }> {
  const url = `${TARGET_URL}/artifacts/${type}/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
  const body = JSON.stringify({ files });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body,
  });

  let responseBody: PublishResponse = {};
  try {
    responseBody = (await response.json()) as PublishResponse;
  } catch {
    // Non-JSON body — treat as empty
  }

  if (response.ok) {
    return { ok: true, body: responseBody };
  }
  return { ok: false, status: response.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

/**
 * HEAD /artifacts/{type}/{id}/{version} — confirms artifact exists in target.
 */
async function verifyExists(type: ArtifactType, id: string, version: string): Promise<boolean> {
  const url = `${TARGET_URL}/artifacts/${type}/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Discovery: enumerate all artifacts in the cloned git registry
// ---------------------------------------------------------------------------

interface DiscoveredArtifact {
  type: ArtifactType;
  id: string;
  version: string;
  dir: string;
}

function discoverArtifacts(repoRoot: string): DiscoveredArtifact[] {
  const discovered: DiscoveredArtifact[] = [];

  for (const type of ARTIFACT_TYPES) {
    const typeDirName = dirForType(type);
    const typeDir = join(repoRoot, typeDirName);

    if (!existsSync(typeDir)) {
      log(`No '${typeDirName}/' directory found — skipping type '${type}'`);
      continue;
    }

    const idEntries = readdirSync(typeDir);
    for (const id of idEntries) {
      const idDir = join(typeDir, id);
      if (!statSync(idDir).isDirectory()) continue;

      const versionEntries = readdirSync(idDir);
      for (const version of versionEntries) {
        const versionDir = join(idDir, version);
        if (!statSync(versionDir).isDirectory()) continue;

        // Must contain metadata.yaml to be a valid artifact bundle
        const metadataPath = join(versionDir, 'metadata.yaml');
        if (!existsSync(metadataPath)) {
          warn(`No metadata.yaml in ${versionDir} — skipping`);
          continue;
        }

        discovered.push({ type, id, version, dir: versionDir });
      }
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Spot-check: random sample of migrated artifacts
// ---------------------------------------------------------------------------

async function spotCheckRandom(migrated: ArtifactResult[], sampleSize: number): Promise<void> {
  if (migrated.length === 0) {
    log('Spot-check: no successfully migrated artifacts to check.');
    return;
  }

  const sample = [...migrated]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(sampleSize, migrated.length));

  log(`\nSpot-check: verifying ${sample.length} random artifact(s) on target…`);

  let passed = 0;
  let failed = 0;

  for (const artifact of sample) {
    const exists = await verifyExists(artifact.type, artifact.id, artifact.version);
    const prefix = `  ${artifact.type}:${artifact.id}@${artifact.version}`;
    if (exists) {
      log(`${prefix}  HEAD 200  OK`);
      if (artifact.metadataSha256) {
        log(`    metadata.yaml SHA-256 (local): ${artifact.metadataSha256}`);
      }
      if (artifact.remoteChecksums) {
        const remoteMeta = artifact.remoteChecksums.find((f) => f.name === 'metadata.yaml');
        if (remoteMeta) {
          const match = remoteMeta.sha256 === artifact.metadataSha256;
          log(`    metadata.yaml SHA-256 (remote): ${remoteMeta.sha256}  ${match ? '✓ match' : '✗ MISMATCH'}`);
          if (!match) failed++;
          else passed++;
        } else {
          passed++;
        }
      } else {
        passed++;
      }
    } else {
      log(`${prefix}  HEAD 404  MISSING`);
      failed++;
    }
  }

  log(`Spot-check complete: ${passed} passed, ${failed} failed`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Source git registry : ${SOURCE_REPO}`);
  log(`Target HTTP service : ${TARGET_URL}`);
  log(`Dry-run             : ${DRY_RUN}`);
  log('');

  // ── Clone the source registry to a temp directory ─────────────────────────
  const tmpBase = tmpdir();
  const cloneDir = mkdtempSync(join(tmpBase, 'forge-registry-migration-'));
  log(`Cloning source registry to ${cloneDir} …`);

  try {
    execSync(`git clone --depth=1 ${SOURCE_REPO} ${cloneDir}`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`Failed to clone '${SOURCE_REPO}': ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Discover all artifacts ─────────────────────────────────────────────────
  const artifacts = discoverArtifacts(cloneDir);
  log(`Discovered ${artifacts.length} artifact(s) to migrate.\n`);

  if (artifacts.length === 0) {
    log('Nothing to migrate. Exiting.');
    cleanup(cloneDir);
    process.exit(0);
  }

  // ── Dry-run: just list what would be migrated ──────────────────────────────
  if (DRY_RUN) {
    log('DRY-RUN — the following artifacts would be posted to the target service:');
    for (const a of artifacts) {
      const files = Object.keys(collectFiles(a.dir));
      log(`  ${a.type}:${a.id}@${a.version}  (${files.length} file(s): ${files.join(', ')})`);
    }
    log(`\nTotal: ${artifacts.length} artifact(s). No changes were made (--dry-run).`);
    cleanup(cloneDir);
    process.exit(0);
  }

  // ── Migrate each artifact ──────────────────────────────────────────────────
  for (const artifact of artifacts) {
    const label = `${artifact.type}:${artifact.id}@${artifact.version}`;
    process.stdout.write(`  Migrating ${label} … `);

    let files: Record<string, string>;
    try {
      files = collectFiles(artifact.dir);
    } catch (err) {
      console.error(`FAILED (read error): ${(err as Error).message}`);
      results.push({
        type: artifact.type,
        id: artifact.id,
        version: artifact.version,
        status: 'failed',
        error: `File read error: ${(err as Error).message}`,
      });
      continue;
    }

    // Compute local SHA-256 of metadata.yaml for spot-check later
    let metadataSha256: string | undefined;
    if (files['metadata.yaml']) {
      metadataSha256 = sha256hex(Buffer.from(files['metadata.yaml'], 'base64'));
    }

    let publishResult: Awaited<ReturnType<typeof publishArtifact>>;
    try {
      publishResult = await publishArtifact(
        artifact.type,
        artifact.id,
        artifact.version,
        files,
      );
    } catch (err) {
      process.stdout.write(`FAILED (network error)\n`);
      results.push({
        type: artifact.type,
        id: artifact.id,
        version: artifact.version,
        status: 'failed',
        error: `Network error: ${(err as Error).message}`,
        metadataSha256,
      });
      continue;
    }

    if (publishResult.ok) {
      process.stdout.write(`OK (201)\n`);
      results.push({
        type: artifact.type,
        id: artifact.id,
        version: artifact.version,
        status: 'migrated',
        metadataSha256,
        remoteChecksums: publishResult.body.files,
      });
      continue;
    }

    // 409 VERSION_CONFLICT → already migrated (idempotent)
    if (publishResult.status === 409) {
      const code = publishResult.body.error ?? '';
      if (code === 'VERSION_CONFLICT') {
        process.stdout.write(`SKIP (409 already migrated)\n`);
        results.push({
          type: artifact.type,
          id: artifact.id,
          version: artifact.version,
          status: 'skipped',
          metadataSha256,
        });
        continue;
      }
    }

    // Any other non-2xx response is a failure
    const errCode    = publishResult.body.error   ?? `HTTP ${publishResult.status}`;
    const errMessage = publishResult.body.message ?? '(no message)';
    process.stdout.write(`FAILED (${publishResult.status} ${errCode})\n`);
    results.push({
      type: artifact.type,
      id: artifact.id,
      version: artifact.version,
      status: 'failed',
      error: `${errCode}: ${errMessage}`,
      metadataSha256,
    });
  }

  // ── Summary report ─────────────────────────────────────────────────────────
  const migrated = results.filter((r) => r.status === 'migrated');
  const skipped  = results.filter((r) => r.status === 'skipped');
  const failed   = results.filter((r) => r.status === 'failed');

  log('\n─────────────────────────────────────────────');
  log('Migration summary');
  log('─────────────────────────────────────────────');
  log(`  Total discovered : ${artifacts.length}`);
  log(`  Migrated         : ${migrated.length}`);
  log(`  Skipped (exists) : ${skipped.length}`);
  log(`  Failed           : ${failed.length}`);
  log('─────────────────────────────────────────────');

  if (failed.length > 0) {
    log('\nFailed artifacts:');
    for (const r of failed) {
      log(`  ${r.type}:${r.id}@${r.version}  — ${r.error}`);
    }
  }

  // ── Spot-check: verify a random sample of migrated + skipped artifacts ─────
  const allSuccessful = [...migrated, ...skipped];
  await spotCheckRandom(allSuccessful, 5);

  // ── Artifact count comparison ──────────────────────────────────────────────
  log('\n─────────────────────────────────────────────');
  log('Artifact count comparison');
  log('─────────────────────────────────────────────');
  log(`  Git registry (source) : ${artifacts.length} artifact version(s)`);
  log(`  HTTP registry (target): ${migrated.length + skipped.length} successfully present`);
  if (migrated.length + skipped.length === artifacts.length) {
    log('  Count matches — migration complete.');
  } else {
    log(`  Count mismatch — ${failed.length} artifact(s) missing on target.`);
  }
  log('─────────────────────────────────────────────');

  cleanup(cloneDir);

  if (failed.length > 0) {
    log('\nMigration completed with errors. Exit code 1.');
    process.exit(1);
  }

  log('\nMigration completed successfully. Exit code 0.');
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
    log(`Cleaned up temp clone at ${dir}`);
  } catch (err) {
    warn(`Could not remove temp directory ${dir}: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('[migrate][FATAL]', err);
  process.exit(1);
});
