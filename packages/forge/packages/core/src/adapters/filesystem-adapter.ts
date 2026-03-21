import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  WorkspaceConfigMetaSchema,
} from '../models/index.js';
import { ArtifactNotFoundError, InvalidMetadataError } from './errors.js';

// Directory names for each artifact type
const TYPE_DIRS: Record<ArtifactType, string> = {
  skill: 'skills',
  agent: 'agents',
  plugin: 'plugins',
  'workspace-config': 'workspace-configs',
};

// Content file names for each type
const CONTENT_FILES: Record<ArtifactType, string> = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  plugin: 'PLUGIN.md',
  'workspace-config': 'WORKSPACE.md',
};

// Zod schemas for each type
const SCHEMAS = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

/**
 * Filesystem-based DataAdapter. Reads artifacts from a local directory tree.
 *
 * Expected layout:
 *   {root}/skills/{id}/metadata.yaml + SKILL.md
 *   {root}/agents/{id}/metadata.yaml + AGENT.md
 *   {root}/plugins/{id}/metadata.yaml
 *   {root}/workspace-configs/{id}/metadata.yaml + WORKSPACE.md (optional)
 *
 * @example
 * const adapter = new FilesystemAdapter('./registry');
 * const skills = await adapter.list('skill');
 */
export class FilesystemAdapter implements DataAdapter {
  constructor(private readonly root: string) {}

  private typeDir(type: ArtifactType): string {
    return path.join(this.root, TYPE_DIRS[type]);
  }

  private artifactDir(type: ArtifactType, id: string): string {
    return path.join(this.typeDir(type), id);
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
      const metaPath = path.join(this.artifactDir(type, id), 'metadata.yaml');
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

  async read(type: ArtifactType, id: string): Promise<ArtifactBundle> {
    const artifactDir = this.artifactDir(type, id);
    const metaPath = path.join(artifactDir, 'metadata.yaml');
    const contentFile = CONTENT_FILES[type];
    const contentPath = path.join(artifactDir, contentFile);

    // Read metadata
    let raw: string;
    try {
      raw = await fs.readFile(metaPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new ArtifactNotFoundError(type, id, artifactDir);
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

  async exists(type: ArtifactType, id: string): Promise<boolean> {
    const metaPath = path.join(this.artifactDir(type, id), 'metadata.yaml');
    try {
      await fs.access(metaPath);
      return true;
    } catch {
      return false;
    }
  }

  async write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void> {
    const artifactDir = this.artifactDir(type, id);
    await fs.mkdir(artifactDir, { recursive: true });

    const metaPath = path.join(artifactDir, 'metadata.yaml');
    await fs.writeFile(metaPath, stringifyYaml(bundle.meta), 'utf-8');

    if (bundle.content) {
      const contentPath = path.join(artifactDir, CONTENT_FILES[type]);
      await fs.writeFile(contentPath, bundle.content, 'utf-8');
    }
  }

  async readResourceFile(type: ArtifactType, id: string, relativePath: string): Promise<string | null> {
    const filePath = path.join(this.artifactDir(type, id), relativePath);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
}
