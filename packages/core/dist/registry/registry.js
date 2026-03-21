"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
const errors_js_1 = require("../adapters/errors.js");
/**
 * Search/query interface over a DataAdapter.
 * Handles text matching, tag filtering, and result ranking.
 *
 * @example
 * const registry = new Registry(new FilesystemAdapter('./registry'));
 * const results = await registry.search('developer');
 * const skill = await registry.get({ type: 'skill', id: 'developer', version: '1.0.0' });
 */
class Registry {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    /**
     * Search for artifacts matching the query.
     * Scores: exact id match (100) > name contains (75) > description contains (50) > tag match (25).
     * Results are sorted by score descending.
     *
     * @param query - Text to search for (case-insensitive substring matching)
     * @param type - Optional artifact type filter
     */
    async search(query, type) {
        const types = type ? [type] : ['skill', 'agent', 'plugin', 'workspace-config'];
        const lowerQuery = query.toLowerCase();
        const results = [];
        for (const t of types) {
            const artifacts = await this.adapter.list(t);
            for (const meta of artifacts) {
                const scored = this.score(meta, lowerQuery, t);
                if (scored.score > 0) {
                    results.push(scored);
                }
            }
        }
        return results.sort((a, b) => b.score - a.score);
    }
    /**
     * Get a single artifact bundle by ref.
     * @throws {ArtifactNotFoundError} if not found
     */
    async get(ref) {
        const exists = await this.adapter.exists(ref.type, ref.id);
        if (!exists) {
            throw new errors_js_1.ArtifactNotFoundError(ref.type, ref.id);
        }
        return this.adapter.read(ref.type, ref.id);
    }
    /**
     * List all artifacts, optionally filtered by type.
     * Returns lightweight summaries (no content).
     */
    async list(type) {
        const types = type ? [type] : ['skill', 'agent', 'plugin', 'workspace-config'];
        const summaries = [];
        for (const t of types) {
            const artifacts = await this.adapter.list(t);
            for (const meta of artifacts) {
                summaries.push({
                    ref: { type: t, id: meta.id, version: meta.version },
                    name: meta.name,
                    description: meta.description,
                    tags: meta.tags,
                });
            }
        }
        return summaries;
    }
    /**
     * Publish an artifact bundle to the registry.
     * Delegates to the underlying adapter.
     */
    async publish(type, id, bundle) {
        await this.adapter.write(type, id, bundle);
    }
    score(meta, lowerQuery, type) {
        let score = 0;
        const matchedOn = [];
        if (meta.id === lowerQuery) {
            score += 100;
            matchedOn.push('id');
        }
        else if (meta.id.includes(lowerQuery)) {
            score += 80;
            matchedOn.push('id');
        }
        if (meta.name.toLowerCase() === lowerQuery) {
            score += 75;
            if (!matchedOn.includes('name'))
                matchedOn.push('name');
        }
        else if (meta.name.toLowerCase().includes(lowerQuery)) {
            score += 50;
            if (!matchedOn.includes('name'))
                matchedOn.push('name');
        }
        if (meta.description.toLowerCase().includes(lowerQuery)) {
            score += 25;
            matchedOn.push('description');
        }
        for (const tag of meta.tags) {
            if (tag.toLowerCase().includes(lowerQuery)) {
                score += 15;
                if (!matchedOn.includes('tags'))
                    matchedOn.push('tags');
                break;
            }
        }
        return {
            ref: { type, id: meta.id, version: meta.version },
            meta,
            score,
            matchedOn,
        };
    }
}
exports.Registry = Registry;
//# sourceMappingURL=registry.js.map