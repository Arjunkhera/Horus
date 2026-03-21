"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const mcp_settings_writer_js_1 = require("../mcp-settings-writer.js");
(0, vitest_1.describe)('updateClaudeMcpServers', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-mcp-settings-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('creates settings.local.json with mcpServers and default mcp__* permission', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers.anvil).toEqual({
            type: 'http',
            url: 'http://localhost:8100/mcp',
        });
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*');
    });
    (0, vitest_1.it)('preserves existing mcpServers entries', async () => {
        const settingsDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(settingsDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(settingsDir, 'settings.local.json'), JSON.stringify({
            mcpServers: { existing: { type: 'http', url: 'http://localhost:9999/mcp' } },
        }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(settingsDir, 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers.existing.url).toBe('http://localhost:9999/mcp');
        (0, vitest_1.expect)(settings.mcpServers.anvil.url).toBe('http://localhost:8100/mcp');
    });
    (0, vitest_1.it)('preserves existing permissions and adds defaults if missing', async () => {
        const settingsDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(settingsDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(settingsDir, 'settings.local.json'), JSON.stringify({
            permissions: { allow: ['Bash(*)'], deny: ['Bash(rm *)'] },
        }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'vault', url: 'http://localhost:8300' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(settingsDir, 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions.allow).toContain('Bash(*)');
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*');
        (0, vitest_1.expect)(settings.permissions.deny).toEqual(['Bash(rm *)']);
    });
    (0, vitest_1.it)('does not duplicate entries if already present', async () => {
        const settingsDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(settingsDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(settingsDir, 'settings.local.json'), JSON.stringify({
            permissions: { allow: ['mcp__*'] },
        }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(settingsDir, 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        const count = settings.permissions.allow.filter((x) => x === 'mcp__*').length;
        (0, vitest_1.expect)(count).toBe(1);
    });
    (0, vitest_1.it)('skips writing when server list is empty', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([], tmpDir);
        const exists = await fs_1.promises.access(path_1.default.join(tmpDir, '.claude', 'settings.local.json'))
            .then(() => true)
            .catch(() => false);
        (0, vitest_1.expect)(exists).toBe(false);
    });
    (0, vitest_1.it)('writes multiple servers in a single call', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([
            { name: 'anvil', url: 'http://localhost:8100' },
            { name: 'vault', url: 'http://localhost:8300' },
            { name: 'forge', url: 'http://localhost:8200' },
        ], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(Object.keys(settings.mcpServers)).toEqual(['anvil', 'vault', 'forge']);
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*');
    });
    (0, vitest_1.it)('applies full claude_permissions from config (allow + deny)', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir, undefined, {
            allow: ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)', 'mcp__*'],
            deny: ['Bash(rm *)', 'Bash(rmdir *)'],
        });
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions.allow).toEqual(vitest_1.expect.arrayContaining(['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)', 'mcp__*']));
        (0, vitest_1.expect)(settings.permissions.deny).toEqual(vitest_1.expect.arrayContaining(['Bash(rm *)', 'Bash(rmdir *)']));
    });
    (0, vitest_1.it)('merges config permissions with existing without duplicates', async () => {
        const settingsDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(settingsDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(settingsDir, 'settings.local.json'), JSON.stringify({
            permissions: { allow: ['Bash(*)', 'mcp__*'], deny: ['Bash(rm *)'] },
        }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir, undefined, {
            allow: ['Bash(*)', 'Edit(*)', 'mcp__*'],
            deny: ['Bash(rm *)', 'Bash(rmdir *)'],
        });
        const raw = await fs_1.promises.readFile(path_1.default.join(settingsDir, 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        // No duplicates
        const bashCount = settings.permissions.allow.filter((x) => x === 'Bash(*)').length;
        (0, vitest_1.expect)(bashCount).toBe(1);
        const mcpCount = settings.permissions.allow.filter((x) => x === 'mcp__*').length;
        (0, vitest_1.expect)(mcpCount).toBe(1);
        const rmCount = settings.permissions.deny.filter((x) => x === 'Bash(rm *)').length;
        (0, vitest_1.expect)(rmCount).toBe(1);
        // New entries added
        (0, vitest_1.expect)(settings.permissions.allow).toContain('Edit(*)');
        (0, vitest_1.expect)(settings.permissions.deny).toContain('Bash(rmdir *)');
    });
    (0, vitest_1.it)('uses default mcp__* when no claudePermissions provided', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir, undefined, undefined);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions.allow).toEqual(['mcp__*']);
        (0, vitest_1.expect)(settings.permissions.deny).toBeUndefined();
    });
});
//# sourceMappingURL=mcp-settings-writer.test.js.map