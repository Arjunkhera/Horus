"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilesystemAdapter = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const yaml_1 = require("yaml");
const index_js_1 = require("../models/index.js");
const errors_js_1 = require("./errors.js");
// Directory names for each artifact type
const TYPE_DIRS = {
    skill: 'skills',
    agent: 'agents',
    plugin: 'plugins',
    'workspace-config': 'workspace-configs',
};
// Content file names for each type
const CONTENT_FILES = {
    skill: 'SKILL.md',
    agent: 'AGENT.md',
    plugin: 'PLUGIN.md',
    'workspace-config': 'WORKSPACE.md',
};
// Zod schemas for each type
const SCHEMAS = {
    skill: index_js_1.SkillMetaSchema,
    agent: index_js_1.AgentMetaSchema,
    plugin: index_js_1.PluginMetaSchema,
    'workspace-config': index_js_1.WorkspaceConfigMetaSchema,
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
class FilesystemAdapter {
    root;
    constructor(root) {
        this.root = root;
    }
    typeDir(type) {
        return path_1.default.join(this.root, TYPE_DIRS[type]);
    }
    artifactDir(type, id) {
        return path_1.default.join(this.typeDir(type), id);
    }
    async list(type) {
        const dir = this.typeDir(type);
        let entries;
        try {
            const dirents = await fs_1.promises.readdir(dir, { withFileTypes: true });
            entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                // Warn but don't throw — empty registry is valid
                console.warn(`[FilesystemAdapter] Registry directory not found: ${dir}. Returning empty list.`);
                return [];
            }
            throw err;
        }
        const results = [];
        for (const id of entries) {
            const metaPath = path_1.default.join(this.artifactDir(type, id), 'metadata.yaml');
            try {
                const raw = await fs_1.promises.readFile(metaPath, 'utf-8');
                const parsed = (0, yaml_1.parse)(raw);
                const schema = SCHEMAS[type];
                const result = schema.safeParse(parsed);
                if (!result.success) {
                    console.error(`[FilesystemAdapter] Skipping ${metaPath}: invalid metadata — ${result.error.errors[0]?.message}. ` +
                        `Fix the metadata.yaml file and re-run.`);
                    continue;
                }
                results.push(result.data);
            }
            catch (err) {
                console.error(`[FilesystemAdapter] Skipping ${id}: could not read ${metaPath} — ${err.message}. ` +
                    `Ensure the file exists and is valid YAML.`);
            }
        }
        return results;
    }
    async read(type, id) {
        const artifactDir = this.artifactDir(type, id);
        const metaPath = path_1.default.join(artifactDir, 'metadata.yaml');
        const contentFile = CONTENT_FILES[type];
        const contentPath = path_1.default.join(artifactDir, contentFile);
        // Read metadata
        let raw;
        try {
            raw = await fs_1.promises.readFile(metaPath, 'utf-8');
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                throw new errors_js_1.ArtifactNotFoundError(type, id, artifactDir);
            }
            throw err;
        }
        const parsed = (0, yaml_1.parse)(raw);
        const schema = SCHEMAS[type];
        const result = schema.safeParse(parsed);
        if (!result.success) {
            throw new errors_js_1.InvalidMetadataError(metaPath, result.error.errors[0]?.message ?? 'schema validation failed');
        }
        // Read content (SKILL.md / AGENT.md / WORKSPACE.md) — opaque, never parsed
        let content = '';
        try {
            content = await fs_1.promises.readFile(contentPath, 'utf-8');
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
            // Content file optional for plugins and workspace-configs
        }
        return {
            meta: result.data,
            content,
            contentPath: contentFile,
        };
    }
    async exists(type, id) {
        const metaPath = path_1.default.join(this.artifactDir(type, id), 'metadata.yaml');
        try {
            await fs_1.promises.access(metaPath);
            return true;
        }
        catch {
            return false;
        }
    }
    async write(type, id, bundle) {
        const artifactDir = this.artifactDir(type, id);
        await fs_1.promises.mkdir(artifactDir, { recursive: true });
        const metaPath = path_1.default.join(artifactDir, 'metadata.yaml');
        await fs_1.promises.writeFile(metaPath, (0, yaml_1.stringify)(bundle.meta), 'utf-8');
        if (bundle.content) {
            const contentPath = path_1.default.join(artifactDir, CONTENT_FILES[type]);
            await fs_1.promises.writeFile(contentPath, bundle.content, 'utf-8');
        }
    }
    async readResourceFile(type, id, relativePath) {
        const filePath = path_1.default.join(this.artifactDir(type, id), relativePath);
        try {
            return await fs_1.promises.readFile(filePath, 'utf-8');
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
}
exports.FilesystemAdapter = FilesystemAdapter;
//# sourceMappingURL=filesystem-adapter.js.map