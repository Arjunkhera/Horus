import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  ForgeConfig,
  LockFile,
  FileOperation,
  MergeReport,
  ConflictStrategy,
  ConflictRecord,
} from '../models/index.js';
import { ForgeConfigSchema, LockFileSchema } from '../models/index.js';
import { ForgeError } from '../adapters/errors.js';

const FORGE_YAML = 'forge.yaml';
const FORGE_LOCK = 'forge.lock';

const FORGE_YAML_TEMPLATE = `# Forge workspace configuration
name: {name}
version: '0.1.0'
target: claude-code

registries:
  - type: filesystem
    name: local
    path: ./registry

artifacts:
  skills: {}
  agents: {}
  plugins: {}
`;

const FORGE_LOCK_TEMPLATE: LockFile = {
  version: '1',
  lockedAt: new Date().toISOString(),
  artifacts: {},
};

/**
 * Manages workspace configuration (forge.yaml) and lockfile (forge.lock).
 * Also handles file merge operations with conflict resolution.
 *
 * @example
 * const wm = new WorkspaceManager('/path/to/workspace');
 * const config = await wm.readConfig();
 */
export class WorkspaceManager {
  constructor(private readonly workspaceRoot: string) {}

  private configPath(): string {
    return path.join(this.workspaceRoot, FORGE_YAML);
  }

  private lockPath(): string {
    return path.join(this.workspaceRoot, FORGE_LOCK);
  }

  /**
   * Read and validate forge.yaml.
   * @throws {ForgeError} if file missing or invalid
   */
  async readConfig(): Promise<ForgeConfig> {
    const filePath = this.configPath();
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new ForgeError(
          'CONFIG_NOT_FOUND',
          `forge.yaml not found at ${filePath}`,
          `Run 'forge init <name>' to create a new workspace`,
          filePath,
        );
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err: any) {
      throw new ForgeError(
        'CONFIG_PARSE_ERROR',
        `Failed to parse forge.yaml at ${filePath}: ${err.message}`,
        `Check that ${filePath} is valid YAML`,
        filePath,
      );
    }

    const result = ForgeConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ForgeError(
        'CONFIG_INVALID',
        `Invalid forge.yaml at ${filePath}: ${result.error.errors[0]?.message}`,
        `Check the forge.yaml schema — required fields: name, registries`,
        filePath,
      );
    }
    return result.data;
  }

  /**
   * Write ForgeConfig to forge.yaml.
   */
  async writeConfig(config: ForgeConfig): Promise<void> {
    const filePath = this.configPath();
    await fs.writeFile(filePath, stringifyYaml(config), 'utf-8');
  }

  /**
   * Read forge.lock. Returns an empty lock if file missing.
   */
  async readLock(): Promise<LockFile> {
    const filePath = this.lockPath();
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return LockFileSchema.parse(FORGE_LOCK_TEMPLATE);
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err: any) {
      throw new ForgeError(
        'LOCK_PARSE_ERROR',
        `Failed to parse forge.lock at ${filePath}: ${err.message}`,
        `Delete forge.lock and run 'forge install' to regenerate it`,
        filePath,
      );
    }

    const result = LockFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new ForgeError(
        'LOCK_INVALID',
        `Invalid forge.lock at ${filePath}: ${result.error.errors[0]?.message}`,
        `Delete forge.lock and run 'forge install' to regenerate it`,
        filePath,
      );
    }
    return result.data;
  }

  /**
   * Write LockFile to forge.lock with current timestamp.
   */
  async writeLock(lock: LockFile): Promise<void> {
    const filePath = this.lockPath();
    const updated: LockFile = { ...lock, lockedAt: new Date().toISOString() };
    await fs.writeFile(filePath, stringifyYaml(updated), 'utf-8');
  }

  /**
   * Scaffold a new Forge workspace (forge init).
   * Creates forge.yaml from template and empty forge.lock.
   * @throws {ForgeError} if forge.yaml already exists
   */
  async scaffoldWorkspace(name: string): Promise<void> {
    const configPath = this.configPath();

    // Check if already exists
    try {
      await fs.access(configPath);
      throw new ForgeError(
        'WORKSPACE_EXISTS',
        `forge.yaml already exists at ${configPath}`,
        `Remove forge.yaml if you want to reinitialize, or run 'forge add' to add artifacts`,
        configPath,
      );
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    await fs.mkdir(this.workspaceRoot, { recursive: true });

    // Write config from template
    const configContent = FORGE_YAML_TEMPLATE.replace('{name}', name);
    await fs.writeFile(configPath, configContent, 'utf-8');

    // Write empty lockfile
    const lock: LockFile = {
      version: '1',
      lockedAt: new Date().toISOString(),
      artifacts: {},
    };
    await fs.writeFile(this.lockPath(), stringifyYaml(lock), 'utf-8');
  }

  /**
   * Compute SHA-256 hash of a string.
   */
  computeSha256(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * Merge FileOperation[] into the workspace, respecting conflict strategy and lockfile.
   *
   * Conflict resolution flowchart:
   * 1. If file tracked in lockfile → safe to overwrite (Forge owns it)
   * 2. If file exists but NOT in lockfile → apply ConflictStrategy:
   *    - overwrite: write anyway
   *    - skip: don't write, log to skipped
   *    - backup: copy to .bak, then write
   *    - prompt: treated as skip (interactive resolution handled elsewhere)
   */
  async mergeFiles(
    operations: FileOperation[],
    lock: LockFile,
    strategy: ConflictStrategy = 'backup',
  ): Promise<MergeReport> {
    const report: MergeReport = {
      written: [],
      skipped: [],
      backed_up: [],
      conflicts: [],
    };

    // Build set of Forge-owned paths from lockfile
    const forgeOwned = new Set<string>();
    for (const artifact of Object.values(lock.artifacts)) {
      for (const f of artifact.files) {
        forgeOwned.add(f);
      }
    }

    for (const op of operations) {
      const absPath = path.join(this.workspaceRoot, op.path);
      const exists = await this.fileExists(absPath);

      if (!exists) {
        // New file — write directly
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, op.content, 'utf-8');
        report.written.push(op.path);
        continue;
      }

      if (forgeOwned.has(op.path)) {
        // Forge owns this file — safe overwrite
        await fs.writeFile(absPath, op.content, 'utf-8');
        report.written.push(op.path);
        continue;
      }

      // Conflict: file exists but user may have modified it
      const conflict: ConflictRecord = {
        path: op.path,
        strategy,
        resolution: strategy === 'overwrite' ? 'overwrite' : strategy === 'backup' ? 'backup' : 'skip',
      };
      report.conflicts.push(conflict);

      if (strategy === 'overwrite') {
        await fs.writeFile(absPath, op.content, 'utf-8');
        report.written.push(op.path);
      } else if (strategy === 'backup') {
        const backupPath = absPath + '.bak';
        await fs.copyFile(absPath, backupPath);
        await fs.writeFile(absPath, op.content, 'utf-8');
        report.backed_up.push(op.path + '.bak');
        report.written.push(op.path);
      } else {
        // skip or prompt → skip
        report.skipped.push(op.path);
      }
    }

    return report;
  }

  /**
   * Remove files tracked in forge.lock that are no longer in the current install set.
   */
  async cleanUntracked(lock: LockFile, currentFiles: string[]): Promise<string[]> {
    const currentSet = new Set(currentFiles);
    const removed: string[] = [];

    for (const artifact of Object.values(lock.artifacts)) {
      for (const f of artifact.files) {
        if (!currentSet.has(f)) {
          const absPath = path.join(this.workspaceRoot, f);
          try {
            await fs.unlink(absPath);
            removed.push(f);
          } catch (err: any) {
            if (err.code !== 'ENOENT') {
              console.warn(`[WorkspaceManager] Could not remove ${absPath}: ${err.message}`);
            }
          }
        }
      }
    }

    return removed;
  }

  private async fileExists(absPath: string): Promise<boolean> {
    try {
      await fs.access(absPath);
      return true;
    } catch {
      return false;
    }
  }
}
