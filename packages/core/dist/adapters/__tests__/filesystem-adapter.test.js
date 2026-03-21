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
const filesystem_adapter_js_1 = require("../filesystem-adapter.js");
const errors_js_1 = require("../errors.js");
(0, vitest_1.describe)('FilesystemAdapter', () => {
    let tmpDir;
    let adapter;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-test-'));
        adapter = new filesystem_adapter_js_1.FilesystemAdapter(tmpDir);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    // Helper to create a skill fixture
    async function createSkillFixture(id, overrides = {}) {
        const dir = path_1.default.join(tmpDir, 'skills', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        const meta = {
            id,
            name: `Skill ${id}`,
            version: '1.0.0',
            description: 'A test skill',
            type: 'skill',
            ...overrides,
        };
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)(meta));
        await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# Skill ${id}\nSome content.`);
    }
    // Helper to create an agent fixture
    async function createAgentFixture(id, overrides = {}) {
        const dir = path_1.default.join(tmpDir, 'agents', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        const meta = {
            id,
            name: `Agent ${id}`,
            version: '1.0.0',
            description: 'A test agent',
            type: 'agent',
            rootSkill: 'orchestrator',
            ...overrides,
        };
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)(meta));
        await fs_1.promises.writeFile(path_1.default.join(dir, 'AGENT.md'), `# Agent ${id}\nSome content.`);
    }
    // Helper to create a plugin fixture
    async function createPluginFixture(id, overrides = {}) {
        const dir = path_1.default.join(tmpDir, 'plugins', id);
        await fs_1.promises.mkdir(dir, { recursive: true });
        const meta = {
            id,
            name: `Plugin ${id}`,
            version: '1.0.0',
            description: 'A test plugin',
            type: 'plugin',
            ...overrides,
        };
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)(meta));
    }
    (0, vitest_1.describe)('list()', () => {
        (0, vitest_1.it)('returns empty array when directory does not exist', async () => {
            const results = await adapter.list('skill');
            (0, vitest_1.expect)(results).toEqual([]);
        });
        (0, vitest_1.it)('returns parsed metadata for valid skills', async () => {
            await createSkillFixture('developer');
            await createSkillFixture('tester');
            const results = await adapter.list('skill');
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('developer');
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('tester');
        });
        (0, vitest_1.it)('returns parsed metadata for valid agents', async () => {
            await createAgentFixture('orchestrator');
            await createAgentFixture('delegator');
            const results = await adapter.list('agent');
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('orchestrator');
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('delegator');
        });
        (0, vitest_1.it)('returns parsed metadata for valid plugins', async () => {
            await createPluginFixture('anvil-sdlc');
            await createPluginFixture('debug-suite');
            const results = await adapter.list('plugin');
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('anvil-sdlc');
            (0, vitest_1.expect)(results.map((r) => r.id)).toContain('debug-suite');
        });
        (0, vitest_1.it)('skips and logs error for malformed metadata.yaml', async () => {
            await createSkillFixture('valid-skill');
            // Create invalid entry
            const badDir = path_1.default.join(tmpDir, 'skills', 'bad-skill');
            await fs_1.promises.mkdir(badDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(badDir, 'metadata.yaml'), 'not: valid: yaml: [[[');
            const results = await adapter.list('skill');
            // Should still return the valid one
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].id).toBe('valid-skill');
        });
        (0, vitest_1.it)('skips entries with validation errors', async () => {
            await createSkillFixture('valid-skill');
            // Create entry missing required field (name)
            const badDir = path_1.default.join(tmpDir, 'skills', 'incomplete-skill');
            await fs_1.promises.mkdir(badDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(badDir, 'metadata.yaml'), (0, yaml_1.stringify)({ id: 'incomplete-skill', version: '1.0.0', type: 'skill' }));
            const results = await adapter.list('skill');
            // Should still return only the valid one
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].id).toBe('valid-skill');
        });
    });
    (0, vitest_1.describe)('read()', () => {
        (0, vitest_1.it)('reads a full artifact bundle with metadata and content', async () => {
            await createSkillFixture('developer');
            const bundle = await adapter.read('skill', 'developer');
            (0, vitest_1.expect)(bundle.meta.id).toBe('developer');
            (0, vitest_1.expect)(bundle.content).toContain('# Skill developer');
            (0, vitest_1.expect)(bundle.contentPath).toBe('SKILL.md');
        });
        (0, vitest_1.it)('reads an agent bundle with AGENT.md content', async () => {
            await createAgentFixture('orchestrator');
            const bundle = await adapter.read('agent', 'orchestrator');
            (0, vitest_1.expect)(bundle.meta.id).toBe('orchestrator');
            (0, vitest_1.expect)(bundle.content).toContain('# Agent orchestrator');
            (0, vitest_1.expect)(bundle.contentPath).toBe('AGENT.md');
        });
        (0, vitest_1.it)('reads a plugin bundle without requiring content file', async () => {
            await createPluginFixture('anvil-sdlc');
            const bundle = await adapter.read('plugin', 'anvil-sdlc');
            (0, vitest_1.expect)(bundle.meta.id).toBe('anvil-sdlc');
            (0, vitest_1.expect)(bundle.content).toBe('');
            (0, vitest_1.expect)(bundle.contentPath).toBe('PLUGIN.md');
        });
        (0, vitest_1.it)('throws ArtifactNotFoundError when artifact does not exist', async () => {
            await (0, vitest_1.expect)(adapter.read('skill', 'nonexistent')).rejects.toThrow(errors_js_1.ArtifactNotFoundError);
        });
        (0, vitest_1.it)('treats SKILL.md as opaque string — does not parse it', async () => {
            await createSkillFixture('opaque');
            const dir = path_1.default.join(tmpDir, 'skills', 'opaque');
            const rawContent = '# Some {{template}} content\n---\nkey: value\n---';
            await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), rawContent);
            const bundle = await adapter.read('skill', 'opaque');
            (0, vitest_1.expect)(bundle.content).toBe(rawContent);
        });
        (0, vitest_1.it)('throws InvalidMetadataError for invalid metadata', async () => {
            const dir = path_1.default.join(tmpDir, 'skills', 'bad');
            await fs_1.promises.mkdir(dir, { recursive: true });
            // Missing required fields
            await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({ id: 'bad', type: 'skill' }));
            await (0, vitest_1.expect)(adapter.read('skill', 'bad')).rejects.toThrow(errors_js_1.InvalidMetadataError);
        });
        (0, vitest_1.it)('preserves special characters and formatting in content', async () => {
            await createSkillFixture('special');
            const dir = path_1.default.join(tmpDir, 'skills', 'special');
            const specialContent = `# Header
\`\`\`typescript
interface Foo {
  bar: string;
  baz: number;
}
\`\`\`

Some text with "quotes" and 'apostrophes'.
Tabs:	here	and	there.
`;
            await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), specialContent);
            const bundle = await adapter.read('skill', 'special');
            (0, vitest_1.expect)(bundle.content).toBe(specialContent);
        });
    });
    (0, vitest_1.describe)('exists()', () => {
        (0, vitest_1.it)('returns true when artifact exists', async () => {
            await createSkillFixture('developer');
            (0, vitest_1.expect)(await adapter.exists('skill', 'developer')).toBe(true);
        });
        (0, vitest_1.it)('returns false when artifact does not exist', async () => {
            (0, vitest_1.expect)(await adapter.exists('skill', 'nonexistent')).toBe(false);
        });
        (0, vitest_1.it)('returns true for agent that exists', async () => {
            await createAgentFixture('orchestrator');
            (0, vitest_1.expect)(await adapter.exists('agent', 'orchestrator')).toBe(true);
        });
        (0, vitest_1.it)('returns true for plugin that exists', async () => {
            await createPluginFixture('anvil-sdlc');
            (0, vitest_1.expect)(await adapter.exists('plugin', 'anvil-sdlc')).toBe(true);
        });
    });
    (0, vitest_1.describe)('write()', () => {
        (0, vitest_1.it)('creates artifact directory and writes metadata and content', async () => {
            const bundle = {
                meta: {
                    id: 'new-skill',
                    name: 'New Skill',
                    version: '1.0.0',
                    description: 'Test',
                    type: 'skill',
                    tags: [],
                    dependencies: {},
                    files: [],
                },
                content: '# New Skill\nHello.',
                contentPath: 'SKILL.md',
            };
            await adapter.write('skill', 'new-skill', bundle);
            (0, vitest_1.expect)(await adapter.exists('skill', 'new-skill')).toBe(true);
            const readBack = await adapter.read('skill', 'new-skill');
            (0, vitest_1.expect)(readBack.meta.id).toBe('new-skill');
            (0, vitest_1.expect)(readBack.content).toBe('# New Skill\nHello.');
        });
        (0, vitest_1.it)('writes agent with AGENT.md', async () => {
            const bundle = {
                meta: {
                    id: 'new-agent',
                    name: 'New Agent',
                    version: '1.0.0',
                    description: 'Test',
                    type: 'agent',
                    rootSkill: 'orchestrator',
                    tags: [],
                    skills: [],
                    dependencies: {},
                },
                content: '# New Agent\nHello.',
                contentPath: 'AGENT.md',
            };
            await adapter.write('agent', 'new-agent', bundle);
            (0, vitest_1.expect)(await adapter.exists('agent', 'new-agent')).toBe(true);
            const readBack = await adapter.read('agent', 'new-agent');
            (0, vitest_1.expect)(readBack.meta.id).toBe('new-agent');
            (0, vitest_1.expect)(readBack.content).toBe('# New Agent\nHello.');
        });
        (0, vitest_1.it)('writes plugin without content file', async () => {
            const bundle = {
                meta: {
                    id: 'new-plugin',
                    name: 'New Plugin',
                    version: '1.0.0',
                    description: 'Test',
                    type: 'plugin',
                    tags: [],
                    skills: [],
                    agents: [],
                },
                content: '',
                contentPath: 'PLUGIN.md',
            };
            await adapter.write('plugin', 'new-plugin', bundle);
            (0, vitest_1.expect)(await adapter.exists('plugin', 'new-plugin')).toBe(true);
            const readBack = await adapter.read('plugin', 'new-plugin');
            (0, vitest_1.expect)(readBack.meta.id).toBe('new-plugin');
        });
        (0, vitest_1.it)('overwrites existing artifact', async () => {
            await createSkillFixture('overwrite-test');
            const bundle = {
                meta: {
                    id: 'overwrite-test',
                    name: 'Updated Name',
                    version: '2.0.0',
                    description: 'Updated description',
                    type: 'skill',
                    tags: ['updated'],
                    dependencies: {},
                    files: [],
                },
                content: '# Updated\nNew content',
                contentPath: 'SKILL.md',
            };
            await adapter.write('skill', 'overwrite-test', bundle);
            const readBack = await adapter.read('skill', 'overwrite-test');
            (0, vitest_1.expect)(readBack.meta.name).toBe('Updated Name');
            (0, vitest_1.expect)(readBack.meta.version).toBe('2.0.0');
            (0, vitest_1.expect)(readBack.content).toBe('# Updated\nNew content');
        });
        (0, vitest_1.it)('creates nested directories as needed', async () => {
            const bundle = {
                meta: {
                    id: 'nested-skill',
                    name: 'Nested Skill',
                    version: '1.0.0',
                    description: 'Test',
                    type: 'skill',
                    tags: [],
                    dependencies: {},
                    files: [],
                },
                content: '# Nested',
                contentPath: 'SKILL.md',
            };
            // Start with empty directory
            await adapter.write('skill', 'nested-skill', bundle);
            const exists = await adapter.exists('skill', 'nested-skill');
            (0, vitest_1.expect)(exists).toBe(true);
        });
    });
    (0, vitest_1.describe)('multiple artifact types', () => {
        (0, vitest_1.it)('maintains separate directories for skills and agents', async () => {
            await createSkillFixture('multi-test');
            await createAgentFixture('multi-test');
            const skills = await adapter.list('skill');
            const agents = await adapter.list('agent');
            (0, vitest_1.expect)(skills).toHaveLength(1);
            (0, vitest_1.expect)(agents).toHaveLength(1);
            (0, vitest_1.expect)(skills[0].id).toBe('multi-test');
            (0, vitest_1.expect)(agents[0].id).toBe('multi-test');
        });
        (0, vitest_1.it)('reads correct artifact even with same ID in different types', async () => {
            await createSkillFixture('shared-id');
            await createAgentFixture('shared-id');
            const skill = await adapter.read('skill', 'shared-id');
            const agent = await adapter.read('agent', 'shared-id');
            (0, vitest_1.expect)(skill.meta.type).toBe('skill');
            (0, vitest_1.expect)(agent.meta.type).toBe('agent');
            (0, vitest_1.expect)(skill.contentPath).toBe('SKILL.md');
            (0, vitest_1.expect)(agent.contentPath).toBe('AGENT.md');
        });
    });
});
//# sourceMappingURL=filesystem-adapter.test.js.map