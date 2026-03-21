import type { ForgeConfig, LockFile, FileOperation, MergeReport, ConflictStrategy } from '../models/index.js';
/**
 * Manages workspace configuration (forge.yaml) and lockfile (forge.lock).
 * Also handles file merge operations with conflict resolution.
 *
 * @example
 * const wm = new WorkspaceManager('/path/to/workspace');
 * const config = await wm.readConfig();
 */
export declare class WorkspaceManager {
    private readonly workspaceRoot;
    constructor(workspaceRoot: string);
    private configPath;
    private lockPath;
    /**
     * Read and validate forge.yaml.
     * @throws {ForgeError} if file missing or invalid
     */
    readConfig(): Promise<ForgeConfig>;
    /**
     * Write ForgeConfig to forge.yaml.
     */
    writeConfig(config: ForgeConfig): Promise<void>;
    /**
     * Read forge.lock. Returns an empty lock if file missing.
     */
    readLock(): Promise<LockFile>;
    /**
     * Write LockFile to forge.lock with current timestamp.
     */
    writeLock(lock: LockFile): Promise<void>;
    /**
     * Scaffold a new Forge workspace (forge init).
     * Creates forge.yaml from template and empty forge.lock.
     * @throws {ForgeError} if forge.yaml already exists
     */
    scaffoldWorkspace(name: string): Promise<void>;
    /**
     * Compute SHA-256 hash of a string.
     */
    computeSha256(content: string): string;
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
    mergeFiles(operations: FileOperation[], lock: LockFile, strategy?: ConflictStrategy): Promise<MergeReport>;
    /**
     * Remove files tracked in forge.lock that are no longer in the current install set.
     */
    cleanUntracked(lock: LockFile, currentFiles: string[]): Promise<string[]>;
    private fileExists;
}
//# sourceMappingURL=workspace-manager.d.ts.map