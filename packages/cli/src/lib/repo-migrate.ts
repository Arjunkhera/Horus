import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RepoRegistryClient, CreateRepoInput } from '@forge/core';
import type { RepoIndex, RepoIndexEntry } from '@forge/core';
import { RepoExistsError } from '@forge/core';

export interface MigrateOptions {
  from?: string;
  dryRun?: boolean;
  client: RepoRegistryClient;
}

export interface MigrateResult {
  migrated: string[];
  skipped: { repo: string; reason: string }[];
  failed: { repo: string; error: string }[];
}

export function inferOrg(remoteUrl: string): string | null {
  // "git@github.com:OrgName/repo.git" → "OrgName"
  const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\//);
  if (sshMatch) return sshMatch[1]!;
  // "https://github.com/OrgName/repo.git" → "OrgName"
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\//);
  if (httpsMatch) return httpsMatch[1]!;
  return null;
}

function mapWorkflow(entry: RepoIndexEntry): CreateRepoInput['workflow'] {
  if (!entry.workflow) return undefined;
  const wf = entry.workflow as Record<string, unknown>;
  return {
    type: entry.workflow.type as 'owner' | 'fork' | 'contributor',
    pushTo: entry.workflow.pushTo,
    prTarget: entry.workflow.prTarget,
    branchPattern: entry.workflow.branchPattern,
    commitFormat: entry.workflow.commitFormat,
    mergeStrategy: wf['mergeStrategy'] as 'squash' | 'rebase' | 'merge' | undefined,
  };
}

export async function migrateRepos(opts: MigrateOptions): Promise<MigrateResult> {
  const fromPath = opts.from
    ? opts.from
    : path.join(os.homedir(), 'Horus', 'data', 'config', 'repos.json');

  const raw = await fs.readFile(fromPath, 'utf8');
  const index = JSON.parse(raw) as RepoIndex;
  const entries = index.repos ?? [];

  const result: MigrateResult = { migrated: [], skipped: [], failed: [] };

  for (const entry of entries) {
    if (!entry.remoteUrl) {
      result.skipped.push({ repo: entry.name, reason: 'no remoteUrl' });
      continue;
    }

    const org = inferOrg(entry.remoteUrl);
    if (!org) {
      result.skipped.push({ repo: entry.name, reason: 'could not infer org from remoteUrl' });
      continue;
    }

    const input: CreateRepoInput = {
      org,
      name: entry.name,
      canonicalUrl: entry.remoteUrl,
      defaultBranch: entry.defaultBranch,
      language: entry.language ?? undefined,
      workflow: mapWorkflow(entry),
    };

    if (opts.dryRun) {
      result.migrated.push(`${org}/${entry.name} (dry-run)`);
      continue;
    }

    try {
      await opts.client.register(input);
      result.migrated.push(`${org}/${entry.name}`);
    } catch (err: unknown) {
      if (err instanceof RepoExistsError) {
        result.skipped.push({ repo: `${org}/${entry.name}`, reason: 'already registered' });
      } else {
        const msg = (err as Error).message ?? String(err);
        if (msg.includes('REPO_EXISTS') || (err as { code?: string }).code === 'REPO_EXISTS') {
          result.skipped.push({ repo: `${org}/${entry.name}`, reason: 'already registered' });
        } else {
          result.failed.push({ repo: `${org}/${entry.name}`, error: msg });
        }
      }
    }
  }

  return result;
}
