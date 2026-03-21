"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveRepoIndex = saveRepoIndex;
exports.loadRepoIndex = loadRepoIndex;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const repo_index_js_1 = require("../models/repo-index.js");
/**
 * Save a RepoIndex to disk as JSON.
 * Creates the directory if it doesn't exist.
 */
async function saveRepoIndex(index, indexPath) {
    const dir = path_1.default.dirname(indexPath);
    await fs_1.promises.mkdir(dir, { recursive: true });
    await fs_1.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}
/**
 * Load a RepoIndex from disk.
 * Returns null if the file doesn't exist.
 * Returns null and logs a warning if the file is malformed.
 */
async function loadRepoIndex(indexPath) {
    try {
        const raw = await fs_1.promises.readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return repo_index_js_1.RepoIndexSchema.parse(parsed);
    }
    catch (err) {
        if (err?.code === 'ENOENT')
            return null;
        console.warn(`[Forge] Warning: Could not parse repo index at ${indexPath}: ${err.message}`);
        return null;
    }
}
//# sourceMappingURL=repo-index-store.js.map