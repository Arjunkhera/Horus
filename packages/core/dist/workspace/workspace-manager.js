"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceManager = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const yaml_1 = require("yaml");
const index_js_1 = require("../models/index.js");
const errors_js_1 = require("../adapters/errors.js");
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
const FORGE_LOCK_TEMPLATE = {
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
class WorkspaceManager {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    configPath() {
        return path_1.default.join(this.workspaceRoot, FORGE_YAML);
    }
    lockPath() {
        return path_1.default.join(this.workspaceRoot, FORGE_LOCK);
    }
    /**
     * Read and validate forge.yaml.
     * @throws {ForgeError} if file missing or invalid
     */
    async readConfig() {
        const filePath = this.configPath();
        let raw;
        try {
            raw = await fs_1.promises.readFile(filePath, 'utf-8');
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                throw new errors_js_1.ForgeError('CONFIG_NOT_FOUND', `forge.yaml not found at ${filePath}`, `Run 'forge init <name>' to create a new workspace`, filePath);
            }
            throw err;
        }
        let parsed;
        try {
            parsed = (0, yaml_1.parse)(raw);
        }
        catch (err) {
            throw new errors_js_1.ForgeError('CONFIG_PARSE_ERROR', `Failed to parse forge.yaml at ${filePath}: ${err.message}`, `Check that ${filePath} is valid YAML`, filePath);
        }
        const result = index_js_1.ForgeConfigSchema.safeParse(parsed);
        if (!result.success) {
            throw new errors_js_1.ForgeError('CONFIG_INVALID', `Invalid forge.yaml at ${filePath}: ${result.error.errors[0]?.message}`, `Check the forge.yaml schema — required fields: name, registries`, filePath);
        }
        return result.data;
    }
    /**
     * Write ForgeConfig to forge.yaml.
     */
    async writeConfig(config) {
        const filePath = this.configPath();
        await fs_1.promises.writeFile(filePath, (0, yaml_1.stringify)(config), 'utf-8');
    }
    /**
     * Read forge.lock. Returns an empty lock if file missing.
     */
    async readLock() {
        const filePath = this.lockPath();
        let raw;
        try {
            raw = await fs_1.promises.readFile(filePath, 'utf-8');
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                return index_js_1.LockFileSchema.parse(FORGE_LOCK_TEMPLATE);
            }
            throw err;
        }
        let parsed;
        try {
            parsed = (0, yaml_1.parse)(raw);
        }
        catch (err) {
            throw new errors_js_1.ForgeError('LOCK_PARSE_ERROR', `Failed to parse forge.lock at ${filePath}: ${err.message}`, `Delete forge.lock and run 'forge install' to regenerate it`, filePath);
        }
        const result = index_js_1.LockFileSchema.safeParse(parsed);
        if (!result.success) {
            throw new errors_js_1.ForgeError('LOCK_INVALID', `Invalid forge.lock at ${filePath}: ${result.error.errors[0]?.message}`, `Delete forge.lock and run 'forge install' to regenerate it`, filePath);
        }
        return result.data;
    }
    /**
     * Write LockFile to forge.lock with current timestamp.
     */
    async writeLock(lock) {
        const filePath = this.lockPath();
        const updated = { ...lock, lockedAt: new Date().toISOString() };
        await fs_1.promises.writeFile(filePath, (0, yaml_1.stringify)(updated), 'utf-8');
    }
    /**
     * Scaffold a new Forge workspace (forge init).
     * Creates forge.yaml from template and empty forge.lock.
     * @throws {ForgeError} if forge.yaml already exists
     */
    async scaffoldWorkspace(name) {
        const configPath = this.configPath();
        // Check if already exists
        try {
            await fs_1.promises.access(configPath);
            throw new errors_js_1.ForgeError('WORKSPACE_EXISTS', `forge.yaml already exists at ${configPath}`, `Remove forge.yaml if you want to reinitialize, or run 'forge add' to add artifacts`, configPath);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
        await fs_1.promises.mkdir(this.workspaceRoot, { recursive: true });
        // Write config from template
        const configContent = FORGE_YAML_TEMPLATE.replace('{name}', name);
        await fs_1.promises.writeFile(configPath, configContent, 'utf-8');
        // Write empty lockfile
        const lock = {
            version: '1',
            lockedAt: new Date().toISOString(),
            artifacts: {},
        };
        await fs_1.promises.writeFile(this.lockPath(), (0, yaml_1.stringify)(lock), 'utf-8');
    }
    /**
     * Compute SHA-256 hash of a string.
     */
    computeSha256(content) {
        return (0, crypto_1.createHash)('sha256').update(content, 'utf-8').digest('hex');
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
    async mergeFiles(operations, lock, strategy = 'backup') {
        const report = {
            written: [],
            skipped: [],
            backed_up: [],
            conflicts: [],
        };
        // Build set of Forge-owned paths from lockfile
        const forgeOwned = new Set();
        for (const artifact of Object.values(lock.artifacts)) {
            for (const f of artifact.files) {
                forgeOwned.add(f);
            }
        }
        for (const op of operations) {
            const absPath = path_1.default.join(this.workspaceRoot, op.path);
            const exists = await this.fileExists(absPath);
            if (!exists) {
                // New file — write directly
                await fs_1.promises.mkdir(path_1.default.dirname(absPath), { recursive: true });
                await fs_1.promises.writeFile(absPath, op.content, 'utf-8');
                report.written.push(op.path);
                continue;
            }
            if (forgeOwned.has(op.path)) {
                // Forge owns this file — safe overwrite
                await fs_1.promises.writeFile(absPath, op.content, 'utf-8');
                report.written.push(op.path);
                continue;
            }
            // Conflict: file exists but user may have modified it
            const conflict = {
                path: op.path,
                strategy,
                resolution: strategy === 'overwrite' ? 'overwrite' : strategy === 'backup' ? 'backup' : 'skip',
            };
            report.conflicts.push(conflict);
            if (strategy === 'overwrite') {
                await fs_1.promises.writeFile(absPath, op.content, 'utf-8');
                report.written.push(op.path);
            }
            else if (strategy === 'backup') {
                const backupPath = absPath + '.bak';
                await fs_1.promises.copyFile(absPath, backupPath);
                await fs_1.promises.writeFile(absPath, op.content, 'utf-8');
                report.backed_up.push(op.path + '.bak');
                report.written.push(op.path);
            }
            else {
                // skip or prompt → skip
                report.skipped.push(op.path);
            }
        }
        return report;
    }
    /**
     * Remove files tracked in forge.lock that are no longer in the current install set.
     */
    async cleanUntracked(lock, currentFiles) {
        const currentSet = new Set(currentFiles);
        const removed = [];
        for (const artifact of Object.values(lock.artifacts)) {
            for (const f of artifact.files) {
                if (!currentSet.has(f)) {
                    const absPath = path_1.default.join(this.workspaceRoot, f);
                    try {
                        await fs_1.promises.unlink(absPath);
                        removed.push(f);
                    }
                    catch (err) {
                        if (err.code !== 'ENOENT') {
                            console.warn(`[WorkspaceManager] Could not remove ${absPath}: ${err.message}`);
                        }
                    }
                }
            }
        }
        return removed;
    }
    async fileExists(absPath) {
        try {
            await fs_1.promises.access(absPath);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.WorkspaceManager = WorkspaceManager;
//# sourceMappingURL=workspace-manager.js.map