"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_js_1 = require("../index.js");
(0, vitest_1.describe)('SkillMeta Schema', () => {
    (0, vitest_1.it)('should parse valid skill metadata', () => {
        const valid = {
            id: 'developer',
            name: 'Developer Skill',
            version: '1.0.0',
            description: 'Implements stories',
            type: 'skill',
            tags: ['development', 'sdlc'],
        };
        const result = index_js_1.SkillMetaSchema.parse(valid);
        (0, vitest_1.expect)(result.id).toBe('developer');
        (0, vitest_1.expect)(result.tags).toEqual(['development', 'sdlc']);
    });
    (0, vitest_1.it)('should apply default values for tags and dependencies', () => {
        const minimal = {
            id: 'test-skill',
            name: 'Test',
            version: '1.0.0',
            description: 'A test skill',
            type: 'skill',
        };
        const result = index_js_1.SkillMetaSchema.parse(minimal);
        (0, vitest_1.expect)(result.tags).toEqual([]);
        (0, vitest_1.expect)(result.dependencies).toEqual({});
    });
    (0, vitest_1.it)('should reject invalid semver', () => {
        const invalid = {
            id: 'test',
            name: 'Test',
            version: '1.0',
            description: 'Bad version',
            type: 'skill',
        };
        (0, vitest_1.expect)(() => index_js_1.SkillMetaSchema.parse(invalid)).toThrow();
    });
    (0, vitest_1.it)('should reject non-kebab-case IDs', () => {
        const invalid = {
            id: 'MySkill',
            name: 'Test',
            version: '1.0.0',
            description: 'Bad id',
            type: 'skill',
        };
        (0, vitest_1.expect)(() => index_js_1.SkillMetaSchema.parse(invalid)).toThrow();
    });
    (0, vitest_1.it)('should reject IDs with spaces', () => {
        const invalid = {
            id: 'skill skill',
            name: 'Test',
            version: '1.0.0',
            description: 'Bad id',
            type: 'skill',
        };
        (0, vitest_1.expect)(() => index_js_1.SkillMetaSchema.parse(invalid)).toThrow();
    });
    (0, vitest_1.it)('should accept valid semver variations', () => {
        const versions = ['1.0.0', '2.1.0-beta.1', '0.0.1-rc.1+build.123'];
        for (const version of versions) {
            const data = {
                id: 'test',
                name: 'Test',
                version,
                description: 'Test',
                type: 'skill',
            };
            (0, vitest_1.expect)(() => index_js_1.SkillMetaSchema.parse(data)).not.toThrow();
        }
    });
    (0, vitest_1.it)('should accept optional fields', () => {
        const full = {
            id: 'full-skill',
            name: 'Full Skill',
            version: '1.0.0',
            description: 'Complete metadata',
            type: 'skill',
            author: 'John Doe',
            license: 'MIT',
            tags: ['tag1'],
            dependencies: { 'other-skill': '^1.0.0' },
            files: ['index.ts', 'types.ts'],
            homepage: 'https://example.com',
            repository: 'https://github.com/example/repo',
        };
        const result = index_js_1.SkillMetaSchema.parse(full);
        (0, vitest_1.expect)(result.author).toBe('John Doe');
        (0, vitest_1.expect)(result.license).toBe('MIT');
        (0, vitest_1.expect)(result.files).toEqual(['index.ts', 'types.ts']);
    });
});
(0, vitest_1.describe)('AgentMeta Schema', () => {
    (0, vitest_1.it)('should parse valid agent metadata', () => {
        const valid = {
            id: 'sdlc-agent',
            name: 'SDLC Agent',
            version: '1.0.0',
            description: 'Manages software development lifecycle',
            type: 'agent',
            rootSkill: 'orchestrator',
        };
        const result = index_js_1.AgentMetaSchema.parse(valid);
        (0, vitest_1.expect)(result.id).toBe('sdlc-agent');
        (0, vitest_1.expect)(result.rootSkill).toBe('orchestrator');
    });
    (0, vitest_1.it)('should apply default values', () => {
        const minimal = {
            id: 'test-agent',
            name: 'Test',
            version: '1.0.0',
            description: 'A test agent',
            type: 'agent',
            rootSkill: 'root',
        };
        const result = index_js_1.AgentMetaSchema.parse(minimal);
        (0, vitest_1.expect)(result.tags).toEqual([]);
        (0, vitest_1.expect)(result.skills).toEqual([]);
        (0, vitest_1.expect)(result.dependencies).toEqual({});
    });
    (0, vitest_1.it)('should reject missing rootSkill', () => {
        const invalid = {
            id: 'test-agent',
            name: 'Test',
            version: '1.0.0',
            description: 'Missing root',
            type: 'agent',
        };
        (0, vitest_1.expect)(() => index_js_1.AgentMetaSchema.parse(invalid)).toThrow();
    });
    (0, vitest_1.it)('should accept skills array', () => {
        const valid = {
            id: 'test-agent',
            name: 'Test',
            version: '1.0.0',
            description: 'Test agent',
            type: 'agent',
            rootSkill: 'orchestrator',
            skills: ['developer', 'tester'],
        };
        const result = index_js_1.AgentMetaSchema.parse(valid);
        (0, vitest_1.expect)(result.skills).toEqual(['developer', 'tester']);
    });
});
(0, vitest_1.describe)('PluginMeta Schema', () => {
    (0, vitest_1.it)('should parse valid plugin metadata', () => {
        const valid = {
            id: 'anvil-sdlc',
            name: 'Anvil SDLC Plugin',
            version: '1.0.0',
            description: 'Software development lifecycle tools',
            type: 'plugin',
            skills: ['developer', 'tester'],
            agents: ['sdlc-agent'],
        };
        const result = index_js_1.PluginMetaSchema.parse(valid);
        (0, vitest_1.expect)(result.id).toBe('anvil-sdlc');
        (0, vitest_1.expect)(result.skills).toContain('developer');
    });
    (0, vitest_1.it)('should apply defaults for arrays', () => {
        const minimal = {
            id: 'test-plugin',
            name: 'Test',
            version: '1.0.0',
            description: 'A test plugin',
            type: 'plugin',
        };
        const result = index_js_1.PluginMetaSchema.parse(minimal);
        (0, vitest_1.expect)(result.skills).toEqual([]);
        (0, vitest_1.expect)(result.agents).toEqual([]);
    });
    (0, vitest_1.it)('should reject non-literal type', () => {
        const invalid = {
            id: 'test-plugin',
            name: 'Test',
            version: '1.0.0',
            description: 'Wrong type',
            type: 'skill',
        };
        (0, vitest_1.expect)(() => index_js_1.PluginMetaSchema.parse(invalid)).toThrow();
    });
});
(0, vitest_1.describe)('ForgeConfig Schema', () => {
    (0, vitest_1.it)('should parse valid config with defaults', () => {
        const config = {
            name: 'my-workspace',
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        (0, vitest_1.expect)(result.name).toBe('my-workspace');
        (0, vitest_1.expect)(result.version).toBe('0.1.0');
        (0, vitest_1.expect)(result.target).toBe('claude-code');
        (0, vitest_1.expect)(result.registries).toEqual([]);
        (0, vitest_1.expect)(result.outputDir).toBe('.');
    });
    (0, vitest_1.it)('should parse filesystem registry', () => {
        const config = {
            name: 'my-workspace',
            registries: [
                {
                    type: 'filesystem',
                    name: 'local',
                    path: './registry',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        (0, vitest_1.expect)(result.registries).toHaveLength(1);
        const reg = result.registries[0];
        if (reg.type === 'filesystem') {
            (0, vitest_1.expect)(reg.path).toBe('./registry');
        }
    });
    (0, vitest_1.it)('should parse git registry with defaults', () => {
        const config = {
            name: 'my-workspace',
            registries: [
                {
                    type: 'git',
                    name: 'remote',
                    url: 'https://github.com/example/registry.git',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        (0, vitest_1.expect)(reg.type).toBe('git');
        if (reg.type === 'git') {
            (0, vitest_1.expect)(reg.branch).toBe('main');
            (0, vitest_1.expect)(reg.path).toBe('registry');
        }
    });
    (0, vitest_1.it)('should parse git registry with custom values', () => {
        const config = {
            name: 'my-workspace',
            registries: [
                {
                    type: 'git',
                    name: 'remote',
                    url: 'https://github.com/example/registry.git',
                    branch: 'develop',
                    path: 'custom-registry',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        if (reg.type === 'git') {
            (0, vitest_1.expect)(reg.branch).toBe('develop');
            (0, vitest_1.expect)(reg.path).toBe('custom-registry');
        }
    });
    (0, vitest_1.it)('should parse http registry', () => {
        const config = {
            name: 'my-workspace',
            registries: [
                {
                    type: 'http',
                    name: 'api',
                    url: 'https://api.example.com/registry',
                    token: 'secret-token',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        if (reg.type === 'http') {
            (0, vitest_1.expect)(reg.token).toBe('secret-token');
        }
    });
    (0, vitest_1.it)('should accept all target enum values', () => {
        for (const target of ['claude-code', 'cursor', 'plugin']) {
            const config = {
                name: 'test',
                target,
            };
            (0, vitest_1.expect)(() => index_js_1.ForgeConfigSchema.parse(config)).not.toThrow();
        }
    });
    (0, vitest_1.it)('should parse artifacts with all types', () => {
        const config = {
            name: 'test',
            artifacts: {
                skills: { 'my-skill': 'skill:my-skill@1.0.0' },
                agents: { 'my-agent': 'agent:my-agent@1.0.0' },
                plugins: { 'my-plugin': 'plugin:my-plugin@1.0.0' },
            },
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        (0, vitest_1.expect)(result.artifacts.skills).toHaveProperty('my-skill');
        (0, vitest_1.expect)(result.artifacts.agents).toHaveProperty('my-agent');
        (0, vitest_1.expect)(result.artifacts.plugins).toHaveProperty('my-plugin');
    });
    (0, vitest_1.it)('should reject invalid registry type', () => {
        const config = {
            name: 'test',
            registries: [
                {
                    type: 'unknown',
                    name: 'bad',
                    url: 'https://example.com',
                },
            ],
        };
        (0, vitest_1.expect)(() => index_js_1.ForgeConfigSchema.parse(config)).toThrow();
    });
});
(0, vitest_1.describe)('LockFile Schema', () => {
    (0, vitest_1.it)('should parse valid lockfile', () => {
        const lock = {
            version: '1',
            lockedAt: new Date().toISOString(),
            artifacts: {},
        };
        const result = index_js_1.LockFileSchema.parse(lock);
        (0, vitest_1.expect)(result.version).toBe('1');
    });
    (0, vitest_1.it)('should parse lockfile with artifacts', () => {
        const now = new Date().toISOString();
        const lock = {
            version: '1',
            lockedAt: now,
            artifacts: {
                'developer@1.0.0': {
                    id: 'developer',
                    type: 'skill',
                    version: '1.0.0',
                    registry: 'local',
                    sha256: 'a'.repeat(64),
                    files: ['index.ts'],
                    resolvedAt: now,
                },
            },
        };
        const result = index_js_1.LockFileSchema.parse(lock);
        (0, vitest_1.expect)(result.artifacts).toHaveProperty('developer@1.0.0');
    });
    (0, vitest_1.it)('should reject invalid SHA-256', () => {
        const now = new Date().toISOString();
        const lock = {
            version: '1',
            lockedAt: now,
            artifacts: {
                'test@1.0.0': {
                    id: 'test',
                    type: 'skill',
                    version: '1.0.0',
                    registry: 'local',
                    sha256: 'not-valid-sha',
                    resolvedAt: now,
                },
            },
        };
        (0, vitest_1.expect)(() => index_js_1.LockFileSchema.parse(lock)).toThrow();
    });
    (0, vitest_1.it)('should accept valid SHA-256 (64 hex chars)', () => {
        const now = new Date().toISOString();
        // Create a valid 64-character hex string (SHA-256)
        const validSha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        const lock = {
            version: '1',
            lockedAt: now,
            artifacts: {
                'test@1.0.0': {
                    id: 'test',
                    type: 'skill',
                    version: '1.0.0',
                    registry: 'local',
                    sha256: validSha,
                    resolvedAt: now,
                },
            },
        };
        const result = index_js_1.LockFileSchema.parse(lock);
        (0, vitest_1.expect)(result.artifacts['test@1.0.0'].sha256).toBe(validSha);
    });
    (0, vitest_1.it)('should apply file defaults', () => {
        const now = new Date().toISOString();
        const lock = {
            version: '1',
            lockedAt: now,
            artifacts: {
                'test@1.0.0': {
                    id: 'test',
                    type: 'skill',
                    version: '1.0.0',
                    registry: 'local',
                    sha256: 'a'.repeat(64),
                    resolvedAt: now,
                },
            },
        };
        const result = index_js_1.LockFileSchema.parse(lock);
        (0, vitest_1.expect)(result.artifacts['test@1.0.0'].files).toEqual([]);
    });
});
(0, vitest_1.describe)('SemVer Schema', () => {
    (0, vitest_1.it)('should accept valid semver strings', () => {
        const valid = ['1.0.0', '2.1.0', '0.0.1', '10.20.30'];
        for (const version of valid) {
            (0, vitest_1.expect)(() => index_js_1.SemVerSchema.parse(version)).not.toThrow();
        }
    });
    (0, vitest_1.it)('should accept semver with prerelease', () => {
        const valid = ['1.0.0-alpha', '1.0.0-beta.1', '1.0.0-rc.1', '2.0.0-0'];
        for (const version of valid) {
            (0, vitest_1.expect)(() => index_js_1.SemVerSchema.parse(version)).not.toThrow();
        }
    });
    (0, vitest_1.it)('should accept semver with build metadata', () => {
        const valid = ['1.0.0+build', '1.0.0+build.1', '1.0.0+20130313144700'];
        for (const version of valid) {
            (0, vitest_1.expect)(() => index_js_1.SemVerSchema.parse(version)).not.toThrow();
        }
    });
    (0, vitest_1.it)('should accept semver with prerelease and build', () => {
        (0, vitest_1.expect)(() => index_js_1.SemVerSchema.parse('1.0.0-beta+build')).not.toThrow();
    });
    (0, vitest_1.it)('should reject invalid formats', () => {
        const invalid = ['1.0', '1', 'v1.0.0', '1.0.0.0', 'not-a-version'];
        for (const version of invalid) {
            (0, vitest_1.expect)(() => index_js_1.SemVerSchema.parse(version)).toThrow();
        }
    });
});
(0, vitest_1.describe)('Discriminated Union - RegistryConfig', () => {
    (0, vitest_1.it)('should correctly discriminate filesystem registry', () => {
        const config = {
            name: 'test',
            registries: [
                {
                    type: 'filesystem',
                    name: 'local',
                    path: '/some/path',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        (0, vitest_1.expect)(reg.type).toBe('filesystem');
        if (reg.type === 'filesystem') {
            (0, vitest_1.expect)(reg.path).toBe('/some/path');
        }
    });
    (0, vitest_1.it)('should correctly discriminate git registry', () => {
        const config = {
            name: 'test',
            registries: [
                {
                    type: 'git',
                    name: 'remote',
                    url: 'https://github.com/example/repo.git',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        (0, vitest_1.expect)(reg.type).toBe('git');
        if (reg.type === 'git') {
            (0, vitest_1.expect)('url' in reg).toBe(true);
            (0, vitest_1.expect)('branch' in reg).toBe(true);
        }
    });
    (0, vitest_1.it)('should correctly discriminate http registry', () => {
        const config = {
            name: 'test',
            registries: [
                {
                    type: 'http',
                    name: 'api',
                    url: 'https://api.example.com',
                },
            ],
        };
        const result = index_js_1.ForgeConfigSchema.parse(config);
        const reg = result.registries[0];
        (0, vitest_1.expect)(reg.type).toBe('http');
        if (reg.type === 'http') {
            (0, vitest_1.expect)('url' in reg).toBe(true);
        }
    });
});
//# sourceMappingURL=models.test.js.map