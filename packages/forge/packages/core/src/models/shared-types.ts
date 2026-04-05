import type { SkillMeta } from './skill-meta.js';
import type { AgentMeta } from './agent-meta.js';
import type { PluginMeta } from './plugin-meta.js';
import type { WorkspaceConfigMeta } from './workspace-config-meta.js';

/**
 * The type of a Forge artifact.
 */
export type ArtifactType = 'skill' | 'agent' | 'plugin' | 'workspace-config';

/**
 * A reference to an artifact: type:id@version
 * @example
 * const ref: ArtifactRef = { type: 'skill', id: 'developer', version: '^1.0.0' };
 */
export interface ArtifactRef {
  type: ArtifactType;
  id: string;
  version: string;
}

/**
 * The metadata of any artifact (union).
 */
export type ArtifactMeta = SkillMeta | AgentMeta | PluginMeta | WorkspaceConfigMeta;

/**
 * A full artifact with metadata + raw content.
 * @example
 * const bundle: ArtifactBundle = {
 *   meta: skillMeta,
 *   content: '# Developer Skill\n...',
 *   contentPath: 'SKILL.md'
 * };
 */
export interface ArtifactBundle {
  meta: ArtifactMeta;
  /** Raw string content of SKILL.md / AGENT.md — never parsed, injected as-is */
  content: string;
  contentPath: string;
}

/**
 * A search result from the registry.
 */
export interface SearchResult {
  ref: ArtifactRef;
  meta: ArtifactMeta;
  score: number;
  matchedOn: Array<'id' | 'name' | 'description' | 'tags'>;
}

/**
 * An artifact that has been fully resolved with all dependencies.
 */
export interface ResolvedArtifact {
  ref: ArtifactRef;
  bundle: ArtifactBundle;
  dependencies: ResolvedArtifact[];
}

/**
 * A file write operation produced by the compiler.
 */
export interface FileOperation {
  path: string;
  content: string;
  sourceRef: ArtifactRef;
  /** Whether this is a new file or an update */
  operation: 'create' | 'update';
}

/**
 * Report returned after a successful forge install.
 */
export interface InstallReport {
  installed: ArtifactRef[];
  filesWritten: string[];
  conflicts: ConflictRecord[];
  duration: number;
}

/**
 * A conflict between a Forge-managed file and a user-modified file.
 */
export interface ConflictRecord {
  path: string;
  strategy: ConflictStrategy;
  resolution: 'overwrite' | 'skip' | 'backup';
}

/**
 * How to handle conflicts when merging compiled files.
 */
export type ConflictStrategy = 'overwrite' | 'skip' | 'backup' | 'prompt';

/**
 * Report returned after a merge operation.
 */
export interface MergeReport {
  written: string[];
  skipped: string[];
  backed_up: string[];
  conflicts: ConflictRecord[];
}

/**
 * Summary of a single artifact (lightweight, for list views).
 */
export interface ArtifactSummary {
  ref: ArtifactRef;
  name: string;
  description: string;
  tags: string[];
}
