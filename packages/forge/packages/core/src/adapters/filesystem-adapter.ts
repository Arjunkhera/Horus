import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import * as semver from 'semver';
import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
} from '../models/index.js';
import { ArtifactNotFoundError, InvalidMetadataError } from './errors.js';

// Directory names for each artifact type
const TYPE_DIRS: Record<ArtifactType, string> = {
  skill: 'skills',
  agent: 'agents',
  plugin: 'plugins',
  persona: 'personas',
  'workspace-config': 'workspace-configs',
};

// Content file names for each type
const CONTENT_FILES: Record<ArtifactType, string> = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  plugin: 'PLUGIN.md',
  persona: 'PERSONA.md',
  'workspace-config': 'WORKSPACE.md',
};

// Zod schemas for each type
const SCHEMAS = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  persona: PersonaMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

/**
 * Parse an artifact ID that may contain a version suffix.
 * e.g., "sdlc-developer@1.1.0" -> { id: "sdlc-developer", version: "1.1.0" }
 * e.g., "sdlc-developer" -> { id: "sdlc-developer", version: undefined }
 */
function parseVersionedId(rawId: string): { id: string; version: string | undefined } {
  const atIdx = rawId.lastIndexOf('@');
  if (atIdx > 0) {
    const possibleVersion = rawId.slice(atIdx + 1);
    if (semver.valid(possibleVersion)) {
      return { id: rawId.slice(0, atIdx), version: possibleVersion };
    }
  }
  return { id: rawId, version: undefined };
}

/**
 * Filesystem-based DataAdapter. Reads artifacts from a local directory tree.
 *
 * Supports two directory layouts:
 *
 * Flat (legacy):
 *   {root}/skills/{id}/metadata.yaml + SKILL.md
 *
 * Versioned:
 *   {root}/skills/{id}/{version}/metadata.yaml + SKILL.md
 *
 * Layout is auto-detected per artifact directory. If subdirectories are
 * valid semver names, the versioned layout is used. Otherwise, falls back
 * to the flat layout.
 *
 * Artifact IDs can include a version suffix: "my-skill@1.2.0".
 * Without a version suffix, the latest (highest semver) version is used.
 *
 * @example
 * const adapter = new FilesystemAdapter('./registry');
 * const skills = await adapter.list('skill');
 * const specific = await adapter.read('skill', 'developer@1.1.0');
 */
export class FilesystemAdapter implements DataAdapter {
  constructor(private readonly root: string) {}

  private typeDir(type: ArtifactType): string {
    return path.join(this.root, TYPE_DIRS[type]);
  }

  private artifactDir(type: ArtifactType, id: string): string {
    return path.join(this.typeDir(type), id);
  }

  /**
   * Detect whether an artifact directory uses versioned layout.
   * Returns sorted (descending) list of semver version strings if versioned,
   * or null if flat/legacy layout.
   */
  private async detectVersions(artifactDir: string): Promise<string[] | null> {
    // Check if metadata.yaml exists directly (flat layout)
    try {
      await fs.access(path.join(artifactDir, 'metadata.yaml'));
      return null; // Flat layout — metadata.yaml at top level
    } catch {
      // No direct metadata.yaml — check for versioned subdirectories
    }

    let entries: string[];
    try {
      const dirents = await fs.readdir(artifactDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return null;
    }

    const versions: string[] = [];
    for (const name of entries) {
      if (semver.valid(name) !== null) {
        versions.push(name);
      }
    }

    if (versions.length === 0) return null;

    // Sort descending — highest version first
    return versions.sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * Resolve the directory that contains metadata.yaml for a given artifact,
   * taking into account versioned vs flat layout and optional version suffix.
   */
  private async resolveArtifactPath(
    type: ArtifactType,
    rawId: string
  ): Promise<{ dir: string; id: string }> {
    const { id, version: requestedVersion } = parseVersionedId(rawId);
    const baseDir = this.artifactDir(type, id);
    const versions = await this.detectVersions(baseDir);

    if (versions === null) {
      // Flat layout — ignore version suffix, use base dir
      return { dir: baseDir, id };
    }

    // Versioned layout
    if (requestedVersion) {
      return { dir: path.join(baseDir, requestedVersion), id };
    }

    // No version requested — use latest (first in descending-sorted list)
    const latest = versions[0];
    if (!latest) {
      return { dir: baseDir, id }; // Fallback: no versions found, try flat
    }
    return { dir: path.join(baseDir, latest), id };
  }

  /**
   * Read and validate metadata from a specific directory.
   */
  private async readMetaFromDir(
    type: ArtifactType,
    dir: string
  ): Promise<ArtifactMeta | null> {
    const metaPath = path.join(dir, 'metadata.yaml');
    let raw: string;
    try {
      raw = await fs.readFile(metaPath, 'utf-8');
    } catch {
      return null;
    }
    const parsed = parseYaml(raw);
    const schema = SCHEMAS[type];
    const result = schema.safeParse(parsed);
    if (!result.success) return null;
    return result.data as ArtifactMeta;
  }

  async list(type: ArtifactType): Promise<ArtifactMeta[]> {
    const dir = this.typeDir(type);
    let entries: string[];

    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Warn but don't throw — empty registry is valid
        console.warn(
          `[FilesystemAdapter] Registry directory not found: ${dir}. Returning empty list.`
        );
        return [];
      }
      throw err;
    }

    const results: ArtifactMeta[] = [];
    for (const id of entries) {
      const baseDir = this.artifactDir(type, id);
      const versions = await this.detectVersions(baseDir);

      let metaDir: string;
      if (versions !== null && versions.length > 0) {
        // Versioned layout — read from highest version
        metaDir = path.join(baseDir, versions[0]!);
      } else {
        // Flat layout
        metaDir = baseDir;
      }

      const metaPath = path.join(metaDir, 'metadata.yaml');
      try {
        const raw = await fs.readFile(metaPath, 'utf-8');
        const parsed = parseYaml(raw);
        const schema = SCHEMAS[type];
        const result = schema.safeParse(parsed);
        if (!result.success) {
          console.error(
            `[FilesystemAdapter] Skipping ${metaPath}: invalid metadata — ${result.error.errors[0]?.message}. ` +
              `Fix the metadata.yaml file and re-run.`
          );
          continue;
        }
        results.push(result.data as ArtifactMeta);
      } catch (err: any) {
        console.error(
          `[FilesystemAdapter] Skipping ${id}: could not read ${metaPath} — ${err.message}. ` +
            `Ensure the file exists and is valid YAML.`
        );
      }
    }
    return results;
  }

  async read(type: ArtifactType, rawId: string): Promise<ArtifactBundle> {
    const { dir: artifactDir, id } = await this.resolveArtifactPath(type, rawId);
    const metaPath = path.join(artifactDir, 'metadata.yaml');
    const contentFile = CONTENT_FILES[type];
    const contentPath = path.join(artifactDir, contentFile);

    // Read metadata
    let raw: string;
    try {
      raw = await fs.readFile(metaPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new ArtifactNotFoundError(type, rawId, artifactDir);
      }
      throw err;
    }

    const parsed = parseYaml(raw);
    const schema = SCHEMAS[type];
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new InvalidMetadataError(
        metaPath,
        result.error.errors[0]?.message ?? 'schema validation failed'
      );
    }

    // Read content (SKILL.md / AGENT.md / WORKSPACE.md) — opaque, never parsed
    let content = '';
    try {
      content = await fs.readFile(contentPath, 'utf-8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      // Content file optional for plugins and workspace-configs
    }

    return {
      meta: result.data as ArtifactMeta,
      content,
      contentPath: contentFile,
    };
  }

  async exists(type: ArtifactType, rawId: string): Promise<boolean> {
    const { id, version: requestedVersion } = parseVersionedId(rawId);
    const baseDir = this.artifactDir(type, id);
    const versions = await this.detectVersions(baseDir);

    if (versions === null) {
      // Flat layout — check for metadata.yaml directly
      const metaPath = path.join(baseDir, 'metadata.yaml');
      try {
        await fs.access(metaPath);
        return true;
      } catch {
        return false;
      }
    }

    // Versioned layout
    if (requestedVersion) {
      // Check specific version
      const metaPath = path.join(baseDir, requestedVersion, 'metadata.yaml');
      try {
        await fs.access(metaPath);
        return true;
      } catch {
        return false;
      }
    }

    // No specific version — any version existing means the artifact exists
    return versions.length > 0;
  }

  async write(type: ArtifactType, rawId: string, bundle: ArtifactBundle): Promise<void> {
    const { id } = parseVersionedId(rawId);
    const version = bundle.meta.version;

    // Determine target directory based on existing layout:
    // - If the artifact already uses versioned layout, write to version subdir
    // - If the artifact already uses flat layout (metadata.yaml at root), overwrite in place
    // - If the artifact doesn't exist yet, use flat layout (backward compatible)
    const baseDir = this.artifactDir(type, id);
    const existingVersions = await this.detectVersions(baseDir);

    let targetDir: string;
    if (existingVersions !== null) {
      // Already versioned layout — write to version subdir
      targetDir = path.join(baseDir, version);
    } else {
      // Flat layout (existing or new) — write to base dir
      targetDir = baseDir;
    }

    await fs.mkdir(targetDir, { recursive: true });

    const metaPath = path.join(targetDir, 'metadata.yaml');
    await fs.writeFile(metaPath, stringifyYaml(bundle.meta), 'utf-8');

    if (bundle.content) {
      const contentPath = path.join(targetDir, CONTENT_FILES[type]);
      await fs.writeFile(contentPath, bundle.content, 'utf-8');
    }
  }

  async readResourceFile(type: ArtifactType, rawId: string, relativePath: string): Promise<string | null> {
    const { dir } = await this.resolveArtifactPath(type, rawId);
    const filePath = path.join(dir, relativePath);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * List all available semver versions for a specific artifact.
   * Returns versions sorted descending (highest first).
   * Returns empty array for flat layout artifacts or nonexistent artifacts.
   */
  async listVersions(type: ArtifactType, rawId: string): Promise<string[]> {
    const { id } = parseVersionedId(rawId);
    const baseDir = this.artifactDir(type, id);
    const versions = await this.detectVersions(baseDir);
    return versions ?? [];
  }
}
