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
const registry_js_1 = require("../registry.js");
const filesystem_adapter_js_1 = require("../../adapters/filesystem-adapter.js");
const errors_js_1 = require("../../adapters/errors.js");
(0, vitest_1.describe)('Registry', () => {
    let tmpDir;
    let registry;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-registry-test-'));
        registry = new registry_js_1.Registry(new filesystem_adapter_js_1.FilesystemAdapter(tmpDir));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    async function createSkill(id, overrides = {}) {
        const dir = path_1.default.join(tmpDir, 'skills', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        const meta = {
            id,
            name: overrides.name ?? `Skill ${id}`,
            version: '1.0.0',
            description: overrides.description ?? `Description for ${id}`,
            type: 'skill',
            tags: overrides.tags ?? [],
            ...overrides,
        };
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)(meta));
        await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# ${id}`);
    }
    (0, vitest_1.describe)('search()', () => {
        (0, vitest_1.it)('returns empty array when nothing matches', async () => {
            await createSkill('developer');
            const results = await registry.search('nonexistent');
            (0, vitest_1.expect)(results).toHaveLength(0);
        });
        (0, vitest_1.it)('finds by exact id match with highest score', async () => {
            await createSkill('developer');
            await createSkill('tester');
            const results = await registry.search('developer');
            (0, vitest_1.expect)(results[0].ref.id).toBe('developer');
            (0, vitest_1.expect)(results[0].matchedOn).toContain('id');
        });
        (0, vitest_1.it)('finds by name substring match', async () => {
            await createSkill('dev', { name: 'Developer Skill' });
            const results = await registry.search('developer');
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].matchedOn).toContain('name');
        });
        (0, vitest_1.it)('finds by description substring match', async () => {
            await createSkill('dev', { description: 'Implements stories and writes tests' });
            const results = await registry.search('stories');
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].matchedOn).toContain('description');
        });
        (0, vitest_1.it)('finds by tag match', async () => {
            await createSkill('dev', { tags: ['development', 'sdlc'] });
            const results = await registry.search('sdlc');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(results[0].matchedOn).toContain('tags');
        });
        (0, vitest_1.it)('ranks exact id match higher than substring match', async () => {
            await createSkill('dev');
            await createSkill('developer');
            const results = await registry.search('dev');
            // 'dev' has exact id match, 'developer' has substring id match
            (0, vitest_1.expect)(results[0].ref.id).toBe('dev');
        });
        (0, vitest_1.it)('filters by type', async () => {
            await createSkill('dev');
            // Create an agent too
            const agentDir = path_1.default.join(tmpDir, 'agents', 'dev-agent');
            await fs_1.promises.mkdir(agentDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(agentDir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: 'dev-agent', name: 'Dev Agent', version: '1.0.0',
                description: 'Development agent', type: 'agent', rootSkill: 'dev', tags: []
            }));
            const results = await registry.search('dev', 'skill');
            (0, vitest_1.expect)(results.every(r => r.ref.type === 'skill')).toBe(true);
        });
        (0, vitest_1.it)('returns results sorted by score descending', async () => {
            await createSkill('dev', { name: 'dev', description: 'dev related' }); // many matches
            await createSkill('tester', { description: 'dev integration' }); // just description
            const results = await registry.search('dev');
            (0, vitest_1.expect)(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
        });
    });
    (0, vitest_1.describe)('get()', () => {
        (0, vitest_1.it)('returns bundle for existing artifact', async () => {
            await createSkill('developer');
            const bundle = await registry.get({ type: 'skill', id: 'developer', version: '1.0.0' });
            (0, vitest_1.expect)(bundle.meta.id).toBe('developer');
        });
        (0, vitest_1.it)('throws ArtifactNotFoundError for missing artifact', async () => {
            await (0, vitest_1.expect)(registry.get({ type: 'skill', id: 'nonexistent', version: '1.0.0' })).rejects.toThrow(errors_js_1.ArtifactNotFoundError);
        });
    });
    (0, vitest_1.describe)('list()', () => {
        (0, vitest_1.it)('returns empty list when no artifacts', async () => {
            const summaries = await registry.list();
            (0, vitest_1.expect)(summaries).toHaveLength(0);
        });
        (0, vitest_1.it)('returns summaries for all artifact types', async () => {
            await createSkill('dev');
            const agentDir = path_1.default.join(tmpDir, 'agents', 'my-agent');
            await fs_1.promises.mkdir(agentDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(agentDir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: 'my-agent', name: 'My Agent', version: '1.0.0',
                description: 'An agent', type: 'agent', rootSkill: 'dev', tags: []
            }));
            const summaries = await registry.list();
            (0, vitest_1.expect)(summaries).toHaveLength(2);
        });
        (0, vitest_1.it)('filters by type when specified', async () => {
            await createSkill('dev');
            const summaries = await registry.list('skill');
            (0, vitest_1.expect)(summaries).toHaveLength(1);
            (0, vitest_1.expect)(summaries[0].ref.type).toBe('skill');
        });
        (0, vitest_1.it)('summaries include name, description, tags', async () => {
            await createSkill('dev', { name: 'Developer', description: 'Implements stories', tags: ['sdlc'] });
            const summaries = await registry.list('skill');
            (0, vitest_1.expect)(summaries[0].name).toBe('Developer');
            (0, vitest_1.expect)(summaries[0].description).toBe('Implements stories');
            (0, vitest_1.expect)(summaries[0].tags).toContain('sdlc');
        });
    });
    (0, vitest_1.describe)('publish()', () => {
        (0, vitest_1.it)('writes artifact to adapter', async () => {
            const bundle = {
                meta: { id: 'new-skill', name: 'New Skill', version: '1.0.0', description: 'Test', type: 'skill', tags: [], dependencies: {}, files: [] },
                content: '# New Skill',
                contentPath: 'SKILL.md',
            };
            await registry.publish('skill', 'new-skill', bundle);
            const exists = await new filesystem_adapter_js_1.FilesystemAdapter(tmpDir).exists('skill', 'new-skill');
            (0, vitest_1.expect)(exists).toBe(true);
        });
    });
});
//# sourceMappingURL=registry.test.js.map