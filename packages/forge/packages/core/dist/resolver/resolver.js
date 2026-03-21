"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Resolver = void 0;
const semver_1 = __importDefault(require("semver"));
const errors_js_1 = require("../adapters/errors.js");
/**
 * Resolves artifact references recursively, handling dependencies,
 * circular dependency detection, and in-memory caching.
 *
 * @example
 * const resolver = new Resolver(registry);
 * const resolved = await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
 * console.log(resolved.dependencies.map(d => d.ref.id));
 */
class Resolver {
    registry;
    /** In-memory cache for this install run: key = "type:id" */
    cache = new Map();
    /** Track resolution in-progress for circular detection: keys in the call stack */
    inProgress = new Set();
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * Reset resolver state (call between install runs).
     */
    reset() {
        this.cache.clear();
        this.inProgress.clear();
    }
    /**
     * Resolve a single artifact reference, including all its dependencies.
     * @throws {CircularDependencyError} if a dependency cycle is detected
     * @throws {VersionMismatchError} if no version satisfies the range
     * @throws {ArtifactNotFoundError} if artifact doesn't exist
     */
    async resolve(ref, callStack = []) {
        const cacheKey = `${ref.type}:${ref.id}`;
        // Return cached result
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        // Circular dependency check
        if (this.inProgress.has(cacheKey)) {
            const cycle = [...callStack, cacheKey];
            throw new errors_js_1.CircularDependencyError(cycle);
        }
        // Mark as in-progress
        this.inProgress.add(cacheKey);
        try {
            // Fetch from registry
            const bundle = await this.registry.get(ref);
            // Validate version if it's a range (not a wildcard)
            if (ref.version && ref.version !== '*' && ref.version !== 'latest') {
                const metaVersion = bundle.meta.version;
                const satisfied = semver_1.default.satisfies(metaVersion, ref.version);
                if (!satisfied) {
                    throw new errors_js_1.VersionMismatchError(ref.id, ref.version, [metaVersion]);
                }
            }
            // Resolve dependencies
            const deps = this.extractDependencies(bundle.meta);
            const resolvedDeps = [];
            for (const dep of deps) {
                const resolvedDep = await this.resolve(dep, [...callStack, cacheKey]);
                resolvedDeps.push(resolvedDep);
            }
            const resolved = {
                ref,
                bundle,
                dependencies: resolvedDeps,
            };
            // Cache the result
            this.cache.set(cacheKey, resolved);
            return resolved;
        }
        finally {
            this.inProgress.delete(cacheKey);
        }
    }
    /**
     * Batch resolve a list of artifact refs in dependency order.
     * Returns deduplicated list with dependencies first.
     */
    async resolveAll(refs) {
        const resolved = [];
        const seen = new Set();
        for (const ref of refs) {
            const r = await this.resolve(ref);
            this.collectOrdered(r, resolved, seen);
        }
        return resolved;
    }
    collectOrdered(artifact, output, seen) {
        // Dependencies first (depth-first)
        for (const dep of artifact.dependencies) {
            this.collectOrdered(dep, output, seen);
        }
        const key = `${artifact.ref.type}:${artifact.ref.id}`;
        if (!seen.has(key)) {
            seen.add(key);
            output.push(artifact);
        }
    }
    extractDependencies(meta) {
        const deps = [];
        if ('dependencies' in meta && meta.dependencies) {
            for (const [id, version] of Object.entries(meta.dependencies)) {
                // Try to infer type from id prefix (e.g., "agent:sdlc") or default to skill
                let type = 'skill';
                let resolvedId = id;
                if (id.startsWith('agent:')) {
                    type = 'agent';
                    resolvedId = id.slice(6);
                }
                else if (id.startsWith('plugin:')) {
                    type = 'plugin';
                    resolvedId = id.slice(7);
                }
                else if (id.startsWith('skill:')) {
                    resolvedId = id.slice(6);
                }
                deps.push({ type, id: resolvedId, version });
            }
        }
        // For agents: also resolve their listed skills
        if (meta.type === 'agent' && 'skills' in meta && Array.isArray(meta.skills)) {
            for (const skillId of meta.skills) {
                if (!deps.find(d => d.id === skillId)) {
                    deps.push({ type: 'skill', id: skillId, version: '*' });
                }
            }
        }
        // For plugins: resolve their listed skills
        if (meta.type === 'plugin' && 'skills' in meta && Array.isArray(meta.skills)) {
            for (const skillId of meta.skills) {
                if (!deps.find(d => d.id === skillId)) {
                    deps.push({ type: 'skill', id: skillId, version: '*' });
                }
            }
        }
        // For workspace-configs: resolve referenced plugins and skills
        if (meta.type === 'workspace-config' && 'plugins' in meta && Array.isArray(meta.plugins)) {
            for (const pluginId of meta.plugins) {
                if (!deps.find(d => d.id === pluginId)) {
                    deps.push({ type: 'plugin', id: pluginId, version: '*' });
                }
            }
        }
        if (meta.type === 'workspace-config' && 'skills' in meta && Array.isArray(meta.skills)) {
            for (const skillId of meta.skills) {
                if (!deps.find(d => d.id === skillId)) {
                    deps.push({ type: 'skill', id: skillId, version: '*' });
                }
            }
        }
        return deps;
    }
}
exports.Resolver = Resolver;
//# sourceMappingURL=resolver.js.map