"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const yaml_1 = require("yaml");
const resolver_js_1 = require("../resolver.js");
const registry_js_1 = require("../../registry/registry.js");
const filesystem_adapter_js_1 = require("../../adapters/filesystem-adapter.js");
const errors_js_1 = require("../../adapters/errors.js");
(0, vitest_1.describe)('Resolver', () => {
    let tmpDir;
    let resolver;
    let registry;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-resolver-test-'));
        registry = new registry_js_1.Registry(new filesystem_adapter_js_1.FilesystemAdapter(tmpDir));
        resolver = new resolver_js_1.Resolver(registry);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    async function createSkill(id, deps = {}, tags = []) {
        const dir = path_1.default.join(tmpDir, 'skills', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({
            id, name: `Skill ${id}`, version: '1.0.0',
            description: `The ${id} skill`, type: 'skill', tags, dependencies: deps, files: []
        }));
        await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# ${id}`);
    }
    async function createPlugin(id, skills = [], agents = []) {
        const dir = path_1.default.join(tmpDir, 'plugins', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({
            id, name: `Plugin ${id}`, version: '1.0.0',
            description: `The ${id} plugin`, type: 'plugin', skills, agents,
        }));
    }
    (0, vitest_1.describe)('resolve() — basic cases', () => {
        (0, vitest_1.it)('resolves an artifact with no dependencies', async () => {
            await createSkill('developer');
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
            (0, vitest_1.expect)(result.ref.id).toBe('developer');
            (0, vitest_1.expect)(result.dependencies).toHaveLength(0);
        });
        (0, vitest_1.it)('throws ArtifactNotFoundError for missing artifact', async () => {
            await (0, vitest_1.expect)(resolver.resolve({ type: 'skill', id: 'nonexistent', version: '1.0.0' })).rejects.toThrow(errors_js_1.ArtifactNotFoundError);
        });
        (0, vitest_1.it)('returns cached result on second resolve', async () => {
            await createSkill('developer');
            resolver.reset();
            const spy = vitest_1.vi.spyOn(registry, 'get');
            await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
            await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
            // get() should only be called once (second is from cache)
            (0, vitest_1.expect)(spy).toHaveBeenCalledTimes(1);
        });
    });
    (0, vitest_1.describe)('resolve() — linear dependencies', () => {
        (0, vitest_1.it)('resolves a linear dependency chain (A → B)', async () => {
            await createSkill('b-skill');
            await createSkill('a-skill', { 'b-skill': '1.0.0' });
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
            (0, vitest_1.expect)(result.dependencies).toHaveLength(1);
            (0, vitest_1.expect)(result.dependencies[0].ref.id).toBe('b-skill');
        });
        (0, vitest_1.it)('resolves a 3-level chain (A → B → C)', async () => {
            await createSkill('c-skill');
            await createSkill('b-skill', { 'c-skill': '1.0.0' });
            await createSkill('a-skill', { 'b-skill': '1.0.0' });
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
            (0, vitest_1.expect)(result.dependencies[0].ref.id).toBe('b-skill');
            (0, vitest_1.expect)(result.dependencies[0].dependencies[0].ref.id).toBe('c-skill');
        });
    });
    (0, vitest_1.describe)('resolve() — diamond dependencies', () => {
        (0, vitest_1.it)('handles diamond deps (A → B,C; B → D; C → D) — D resolved once', async () => {
            await createSkill('d-skill');
            await createSkill('b-skill', { 'd-skill': '1.0.0' });
            await createSkill('c-skill', { 'd-skill': '1.0.0' });
            await createSkill('a-skill', { 'b-skill': '1.0.0', 'c-skill': '1.0.0' });
            resolver.reset();
            const spy = vitest_1.vi.spyOn(registry, 'get');
            await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
            // d-skill should only be fetched once due to caching
            const dCalls = spy.mock.calls.filter(c => c[0].id === 'd-skill');
            (0, vitest_1.expect)(dCalls).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('resolve() — circular dependencies', () => {
        (0, vitest_1.it)('throws CircularDependencyError for A → A', async () => {
            await createSkill('a-skill', { 'a-skill': '1.0.0' });
            resolver.reset();
            await (0, vitest_1.expect)(resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })).rejects.toThrow(errors_js_1.CircularDependencyError);
        });
        (0, vitest_1.it)('throws CircularDependencyError for A → B → A', async () => {
            await createSkill('b-skill', { 'a-skill': '1.0.0' });
            await createSkill('a-skill', { 'b-skill': '1.0.0' });
            resolver.reset();
            await (0, vitest_1.expect)(resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })).rejects.toThrow(errors_js_1.CircularDependencyError);
        });
    });
    (0, vitest_1.describe)('resolve() — version matching', () => {
        (0, vitest_1.it)('accepts exact version match', async () => {
            await createSkill('versioned');
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '1.0.0' });
            (0, vitest_1.expect)(result.ref.id).toBe('versioned');
        });
        (0, vitest_1.it)('accepts semver range ^1.0.0', async () => {
            await createSkill('versioned');
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '^1.0.0' });
            (0, vitest_1.expect)(result.ref.id).toBe('versioned');
        });
        (0, vitest_1.it)('throws VersionMismatchError when range not satisfied', async () => {
            await createSkill('versioned'); // version 1.0.0
            resolver.reset();
            await (0, vitest_1.expect)(resolver.resolve({ type: 'skill', id: 'versioned', version: '>=2.0.0' })).rejects.toThrow(errors_js_1.VersionMismatchError);
        });
        (0, vitest_1.it)('accepts wildcard (*) without version check', async () => {
            await createSkill('versioned');
            resolver.reset();
            const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '*' });
            (0, vitest_1.expect)(result.ref.id).toBe('versioned');
        });
    });
    (0, vitest_1.describe)('resolveAll()', () => {
        (0, vitest_1.it)('returns artifacts in dependency order', async () => {
            await createSkill('dep');
            await createSkill('main', { 'dep': '1.0.0' });
            resolver.reset();
            const results = await resolver.resolveAll([
                { type: 'skill', id: 'main', version: '1.0.0' }
            ]);
            const ids = results.map(r => r.ref.id);
            (0, vitest_1.expect)(ids.indexOf('dep')).toBeLessThan(ids.indexOf('main'));
        });
        (0, vitest_1.it)('deduplicates artifacts', async () => {
            await createSkill('shared');
            resolver.reset();
            const results = await resolver.resolveAll([
                { type: 'skill', id: 'shared', version: '1.0.0' },
                { type: 'skill', id: 'shared', version: '1.0.0' },
            ]);
            (0, vitest_1.expect)(results).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('resolve() — plugin skill extraction', () => {
        (0, vitest_1.it)('resolves skills listed in a plugin as dependencies', async () => {
            await createSkill('developer');
            await createSkill('tester');
            await createPlugin('my-plugin', ['developer', 'tester']);
            resolver.reset();
            const result = await resolver.resolve({ type: 'plugin', id: 'my-plugin', version: '*' });
            const depIds = result.dependencies.map(d => d.ref.id);
            (0, vitest_1.expect)(depIds).toContain('developer');
            (0, vitest_1.expect)(depIds).toContain('tester');
        });
        (0, vitest_1.it)('includes plugin skills in resolveAll output', async () => {
            await createSkill('developer');
            await createSkill('tester');
            await createPlugin('my-plugin', ['developer', 'tester']);
            resolver.reset();
            const results = await resolver.resolveAll([
                { type: 'plugin', id: 'my-plugin', version: '*' },
            ]);
            const ids = results.map(r => r.ref.id);
            (0, vitest_1.expect)(ids).toContain('developer');
            (0, vitest_1.expect)(ids).toContain('tester');
            (0, vitest_1.expect)(ids).toContain('my-plugin');
        });
        (0, vitest_1.it)('resolves plugin skills before the plugin itself', async () => {
            await createSkill('developer');
            await createPlugin('my-plugin', ['developer']);
            resolver.reset();
            const results = await resolver.resolveAll([
                { type: 'plugin', id: 'my-plugin', version: '*' },
            ]);
            const ids = results.map(r => r.ref.id);
            (0, vitest_1.expect)(ids.indexOf('developer')).toBeLessThan(ids.indexOf('my-plugin'));
        });
        (0, vitest_1.it)('deduplicates skills shared between plugin and direct refs', async () => {
            await createSkill('developer');
            await createPlugin('my-plugin', ['developer']);
            resolver.reset();
            const results = await resolver.resolveAll([
                { type: 'plugin', id: 'my-plugin', version: '*' },
                { type: 'skill', id: 'developer', version: '*' },
            ]);
            const developerEntries = results.filter(r => r.ref.id === 'developer');
            (0, vitest_1.expect)(developerEntries).toHaveLength(1);
        });
        (0, vitest_1.it)('handles plugin with no skills gracefully', async () => {
            await createPlugin('empty-plugin', []);
            resolver.reset();
            const result = await resolver.resolve({ type: 'plugin', id: 'empty-plugin', version: '*' });
            (0, vitest_1.expect)(result.dependencies).toHaveLength(0);
        });
    });
});
//# sourceMappingURL=resolver.test.js.map