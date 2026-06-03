/**
 * Host-side global artifact installer.
 *
 * Fetches Forge artifacts from the control-plane registry over plain REST and
 * emits them into the user's global Claude Code directory (`~/.claude/`). This
 * mirrors @forge/core's GlobalClaudeCodeStrategy, but runs in the CLI on the
 * host (Node), because the container-embedded forge engine can only write the
 * container's `~/.claude`, not the user's real home.
 *
 * Mapping:
 *   skill           → ~/.claude/skills/{id}/SKILL.md
 *   agent           → ~/.claude/agents/{id}.md      (AGENT.md content)
 *   persona         → ~/.claude/agents/{id}.md      (PERSONA.md, frontmatter normalised)
 *   plugin          → emit its resolved deps (no own file)
 *   workspace-config→ emit its resolved deps (no own file)
 *
 * The set of artifacts to install globally is the union of a built-in default
 * set and a user-extensible manifest at `~/Horus/data/config/global-artifacts.json`,
 * maintained by `horus global install/uninstall`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { getHorusDir } from './config.js';

export type ArtifactType = 'skill' | 'agent' | 'plugin' | 'persona' | 'workspace-config';

export const ARTIFACT_TYPES: ArtifactType[] = [
  'skill',
  'agent',
  'plugin',
  'persona',
  'workspace-config',
];

export interface ArtifactRef {
  type: ArtifactType;
  id: string;
  version?: string;
}

/** A fully-resolved leaf artifact (skill/agent/persona) ready to emit. */
interface LeafArtifact {
  type: ArtifactType;
  id: string;
  version: string;
  files: Record<string, string>;
}

/**
 * The built-in baseline installed on every `horus connect`, even when the user
 * manifest is empty:
 *  - the six core Horus reference skills, and
 *  - `plugin:anvil-sdlc-v2` — the full repo-local SDLC suite (11 skills + 8
 *    agents, native git worktrees, no forge_develop). This is the global
 *    default SDLC; it supersedes and fully replaces the retired `local-sdlc`.
 */
export const DEFAULT_GLOBAL_ARTIFACTS: string[] = [
  'skill:horus-anvil',
  'skill:horus-vault',
  'skill:horus-forge',
  'skill:horus-context',
  'skill:capture',
  'skill:triage',
  'plugin:anvil-sdlc-v2',
];

// ── Ref parsing ────────────────────────────────────────────────────────────

/**
 * Parse an artifact ref. Accepts `type:id@version`, `type:id`, or a bare `id`
 * (which defaults to a skill, matching the legacy connect behaviour).
 */
export function parseRef(ref: string): ArtifactRef {
  let type: ArtifactType = 'skill';
  let rest = ref.trim();

  const colon = rest.indexOf(':');
  if (colon !== -1) {
    const maybeType = rest.slice(0, colon);
    if ((ARTIFACT_TYPES as string[]).includes(maybeType)) {
      type = maybeType as ArtifactType;
      rest = rest.slice(colon + 1);
    }
  }

  let id = rest;
  let version: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at > 0) {
    id = rest.slice(0, at);
    version = rest.slice(at + 1);
  }

  return { type, id, version };
}

export function formatRef(ref: ArtifactRef): string {
  return `${ref.type}:${ref.id}`;
}

// ── Registry REST client ─────────────────────────────────────────────────────

function apiBase(controlPlaneUrl: string): string {
  return controlPlaneUrl.replace(/\/+$/, '');
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Highest semver from a list (numeric per-segment comparison). */
function pickLatest(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions
    .slice()
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .pop()!;
}

async function resolveVersion(
  base: string,
  type: string,
  id: string,
  version?: string,
): Promise<string | null> {
  if (version) return version;
  const json = await fetchJson<{ versions?: string[] }>(
    `${base}/api/v1/forge/artifacts/${type}/${id}/versions`,
  );
  return json ? pickLatest(json.versions ?? []) : null;
}

/** Fetch a bundle and decode its base64 files into a `{ filename → content }` map. */
async function fetchBundleFiles(
  base: string,
  type: string,
  id: string,
  version: string,
): Promise<Record<string, string> | null> {
  const json = await fetchJson<{ files?: Record<string, string> }>(
    `${base}/api/v1/forge/artifacts/${type}/${id}/${version}`,
  );
  if (!json?.files) return null;
  const out: Record<string, string> = {};
  for (const [name, b64] of Object.entries(json.files)) {
    out[name] = Buffer.from(b64, 'base64').toString('utf-8');
  }
  return out;
}

/**
 * Recursively resolve a ref into its emittable leaves (skills/agents/personas).
 *
 * The registry's `/deps` endpoint only follows the `references` field, which
 * plugins and workspace-configs do not use to declare their contents — so we
 * expand them ourselves by reading each artifact's metadata.yaml:
 *   plugin           → metadata.skills[] + metadata.agents[]
 *   workspace-config → metadata.plugins[] + skills[] + agents[] + personas[]
 *   skill/agent/persona → leaf (emitted as-is)
 *
 * Container ids are bare (unversioned), so each child resolves to its latest.
 * `seen` de-dupes by canonical `type:id` and guards against cycles.
 */
async function collectLeaves(
  base: string,
  type: ArtifactType,
  id: string,
  version: string | undefined,
  seen: Set<string>,
  out: Map<string, LeafArtifact>,
): Promise<void> {
  const key = `${type}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);

  const resolvedVersion = await resolveVersion(base, type, id, version);
  if (!resolvedVersion) return;

  const files = await fetchBundleFiles(base, type, id, resolvedVersion);
  if (!files) return;

  if (type === 'skill' || type === 'agent' || type === 'persona') {
    out.set(key, { type, id, version: resolvedVersion, files });
    return;
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = (parseYaml(files['metadata.yaml'] ?? '') as Record<string, unknown>) ?? {};
  } catch {
    meta = {};
  }
  const ids = (field: string): string[] =>
    Array.isArray(meta[field]) ? (meta[field] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  if (type === 'plugin') {
    for (const sid of ids('skills')) await collectLeaves(base, 'skill', sid, undefined, seen, out);
    for (const aid of ids('agents')) await collectLeaves(base, 'agent', aid, undefined, seen, out);
  } else if (type === 'workspace-config') {
    for (const pid of ids('plugins')) await collectLeaves(base, 'plugin', pid, undefined, seen, out);
    for (const sid of ids('skills')) await collectLeaves(base, 'skill', sid, undefined, seen, out);
    for (const aid of ids('agents')) await collectLeaves(base, 'agent', aid, undefined, seen, out);
    for (const pid of ids('personas')) await collectLeaves(base, 'persona', pid, undefined, seen, out);
  }
}

// ── Emission ─────────────────────────────────────────────────────────────────

/**
 * Normalise a PERSONA.md into a Claude-Code subagent file. Personas carry only
 * `id`/`name` frontmatter; Claude subagents require `name` + `description`, so
 * we inject a `description` (from metadata.yaml) when missing.
 */
function personaToAgent(personaMd: string, metadataYaml: string | undefined, id: string): string {
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(personaMd);
  let meta: Record<string, unknown> = {};
  if (metadataYaml) {
    try {
      meta = (parseYaml(metadataYaml) as Record<string, unknown>) ?? {};
    } catch {
      meta = {};
    }
  }
  const description =
    (typeof meta.description === 'string' && meta.description) ||
    `${id} persona`;

  if (!fm) {
    // No frontmatter at all — synthesise a complete one.
    return `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\n---\n\n${personaMd}`;
  }

  let front = fm[1];
  const body = fm[2];
  if (!/^name:/m.test(front)) front += `\nname: ${id}`;
  if (!/^description:/m.test(front)) front += `\ndescription: ${JSON.stringify(description)}`;
  return `---\n${front}\n---\n\n${body}`;
}

function emitNode(claudeDir: string, node: LeafArtifact, files: Record<string, string>): string[] {
  const written: string[] = [];
  if (node.type === 'skill') {
    const body = files['SKILL.md'];
    if (!body) return written;
    const p = join(claudeDir, 'skills', node.id, 'SKILL.md');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf-8');
    written.push(p);
  } else if (node.type === 'agent') {
    const body = files['AGENT.md'];
    if (!body) return written;
    const p = join(claudeDir, 'agents', `${node.id}.md`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf-8');
    written.push(p);
  } else if (node.type === 'persona') {
    const body = files['PERSONA.md'];
    if (!body) return written;
    const p = join(claudeDir, 'agents', `${node.id}.md`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, personaToAgent(body, files['metadata.yaml'], node.id), 'utf-8');
    written.push(p);
  }
  return written;
}

// ── Public install API ───────────────────────────────────────────────────────

export interface InstallResult {
  ref: string;
  emitted: { type: ArtifactType; id: string; version: string }[];
  files: string[];
  error?: string;
}

/**
 * Resolve a single ref to its dependency tree and emit all emittable leaves to
 * `claudeDir`. A plugin/workspace-config emits its bundled skills/agents; a
 * bare skill/agent/persona emits itself.
 */
export async function installArtifactGlobally(
  controlPlaneUrl: string,
  ref: string,
  claudeDir: string = join(homedir(), '.claude'),
): Promise<InstallResult> {
  const base = apiBase(controlPlaneUrl);
  const parsed = parseRef(ref);
  const result: InstallResult = { ref: formatRef(parsed), emitted: [], files: [] };

  const leaves = new Map<string, LeafArtifact>();
  await collectLeaves(base, parsed.type, parsed.id, parsed.version, new Set(), leaves);

  if (leaves.size === 0) {
    result.error = `${parsed.type}:${parsed.id} resolved to no installable skills/agents (not published, or empty)`;
    return result;
  }

  for (const leaf of leaves.values()) {
    const written = emitNode(claudeDir, leaf, leaf.files);
    if (written.length > 0) {
      result.emitted.push({ type: leaf.type, id: leaf.id, version: leaf.version });
      result.files.push(...written);
    }
  }

  return result;
}

/** Sync a set of refs to latest, returning per-ref results. */
export async function syncGlobalArtifacts(
  controlPlaneUrl: string,
  refs: string[],
  claudeDir: string = join(homedir(), '.claude'),
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  // De-dupe refs by canonical form before installing.
  const unique = Array.from(new Set(refs.map((r) => formatRef(parseRef(r)))));
  for (const ref of unique) {
    try {
      results.push(await installArtifactGlobally(controlPlaneUrl, ref, claudeDir));
    } catch (err) {
      results.push({ ref, emitted: [], files: [], error: (err as Error).message });
    }
  }
  return results;
}

// ── Manifest (~/Horus/data/config/global-artifacts.json) ─────────────────────

interface GlobalManifest {
  artifacts: string[];
}

export function getManifestPath(): string {
  return join(getHorusDir(), 'data', 'config', 'global-artifacts.json');
}

function readManifest(): GlobalManifest {
  const p = getManifestPath();
  if (!existsSync(p)) return { artifacts: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<GlobalManifest>;
    return { artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [] };
  } catch {
    return { artifacts: [] };
  }
}

function writeManifest(manifest: GlobalManifest): void {
  const p = getManifestPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/** The refs `horus connect` should install: defaults ∪ user manifest. */
export function resolveGlobalRefs(): string[] {
  const manifest = readManifest();
  const all = [...DEFAULT_GLOBAL_ARTIFACTS, ...manifest.artifacts];
  return Array.from(new Set(all.map((r) => formatRef(parseRef(r)))));
}

/** User-added refs only (excludes defaults). */
export function listManifestRefs(): string[] {
  return readManifest().artifacts;
}

/** Add a ref to the manifest. Returns true if newly added. */
export function addManifestRef(ref: string): boolean {
  const canonical = formatRef(parseRef(ref));
  const manifest = readManifest();
  const existing = new Set(manifest.artifacts.map((r) => formatRef(parseRef(r))));
  if (existing.has(canonical)) return false;
  manifest.artifacts.push(canonical);
  writeManifest(manifest);
  return true;
}

/** Remove a ref from the manifest. Returns true if it was present. */
export function removeManifestRef(ref: string): boolean {
  const canonical = formatRef(parseRef(ref));
  const manifest = readManifest();
  const before = manifest.artifacts.length;
  manifest.artifacts = manifest.artifacts.filter((r) => formatRef(parseRef(r)) !== canonical);
  if (manifest.artifacts.length === before) return false;
  writeManifest(manifest);
  return true;
}
