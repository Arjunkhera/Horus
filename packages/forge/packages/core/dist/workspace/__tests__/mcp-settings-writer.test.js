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
    (0, vitest_1.it)('creates settings.local.json with mcpServers and default mcp__*__* permission', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers.anvil).toEqual({
            type: 'http',
            url: 'http://localhost:8100/mcp',
        });
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*__*');
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
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*__*');
        (0, vitest_1.expect)(settings.permissions.deny).toEqual(['Bash(rm *)']);
    });
    (0, vitest_1.it)('does not duplicate entries if already present', async () => {
        const settingsDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(settingsDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(settingsDir, 'settings.local.json'), JSON.stringify({
            permissions: { allow: ['mcp__*__*'] },
        }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(settingsDir, 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        const count = settings.permissions.allow.filter((x) => x === 'mcp__*__*').length;
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
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*__*');
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
    (0, vitest_1.it)('uses default mcp__*__* when no claudePermissions provided', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir, undefined, undefined);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions.allow).toEqual(['mcp__*__*']);
        (0, vitest_1.expect)(settings.permissions.deny).toBeUndefined();
    });
});
(0, vitest_1.describe)('updateClaudeMcpServers — settings.json (project-level shared)', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-mcp-shared-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('creates settings.json with permissions block', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*__*');
    });
    (0, vitest_1.it)('does not write mcpServers or hooks to settings.json', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir, undefined, {
            allow: ['mcp__*__*', 'Bash(*)'],
            deny: ['Bash(rm *)'],
        });
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers).toBeUndefined();
        (0, vitest_1.expect)(settings.hooks).toBeUndefined();
        (0, vitest_1.expect)(settings.permissions.allow).toEqual(vitest_1.expect.arrayContaining(['mcp__*__*', 'Bash(*)']));
        (0, vitest_1.expect)(settings.permissions.deny).toEqual(['Bash(rm *)']);
    });
    (0, vitest_1.it)('merges into existing settings.json without overwriting other keys', async () => {
        const claudeDir = path_1.default.join(tmpDir, '.claude');
        await fs_1.promises.mkdir(claudeDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(claudeDir, 'settings.json'), JSON.stringify({ model: 'sonnet', permissions: { allow: ['Read(*)'] } }));
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(claudeDir, 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.model).toBe('sonnet');
        (0, vitest_1.expect)(settings.permissions.allow).toContain('Read(*)');
        (0, vitest_1.expect)(settings.permissions.allow).toContain('mcp__*__*');
    });
    (0, vitest_1.it)('does not duplicate permissions in settings.json on repeated calls', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.claude', 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);
        const count = settings.permissions.allow.filter((x) => x === 'mcp__*__*').length;
        (0, vitest_1.expect)(count).toBe(1);
    });
    (0, vitest_1.it)('skips creating settings.json when server list is empty', async () => {
        await (0, mcp_settings_writer_js_1.updateClaudeMcpServers)([], tmpDir);
        const exists = await fs_1.promises.access(path_1.default.join(tmpDir, '.claude', 'settings.json'))
            .then(() => true)
            .catch(() => false);
        (0, vitest_1.expect)(exists).toBe(false);
    });
});
(0, vitest_1.describe)('updateCursorMcpServers', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cursor-mcp-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('creates .cursor/mcp.json with mcpServers using url-only format', async () => {
        await (0, mcp_settings_writer_js_1.updateCursorMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.cursor', 'mcp.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers.anvil).toEqual({
            url: 'http://localhost:8100/mcp',
        });
        // Cursor format should NOT have 'type' field
        (0, vitest_1.expect)(settings.mcpServers.anvil.type).toBeUndefined();
    });
    (0, vitest_1.it)('preserves existing mcpServers entries', async () => {
        const cursorDir = path_1.default.join(tmpDir, '.cursor');
        await fs_1.promises.mkdir(cursorDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(cursorDir, 'mcp.json'), JSON.stringify({
            mcpServers: { existing: { url: 'http://localhost:9999/mcp' } },
        }));
        await (0, mcp_settings_writer_js_1.updateCursorMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(cursorDir, 'mcp.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.mcpServers.existing.url).toBe('http://localhost:9999/mcp');
        (0, vitest_1.expect)(settings.mcpServers.anvil.url).toBe('http://localhost:8100/mcp');
    });
    (0, vitest_1.it)('skips writing when server list is empty', async () => {
        await (0, mcp_settings_writer_js_1.updateCursorMcpServers)([], tmpDir);
        const exists = await fs_1.promises.access(path_1.default.join(tmpDir, '.cursor', 'mcp.json'))
            .then(() => true)
            .catch(() => false);
        (0, vitest_1.expect)(exists).toBe(false);
    });
    (0, vitest_1.it)('writes multiple servers in a single call', async () => {
        await (0, mcp_settings_writer_js_1.updateCursorMcpServers)([
            { name: 'anvil', url: 'http://localhost:8100' },
            { name: 'vault', url: 'http://localhost:8300' },
            { name: 'forge', url: 'http://localhost:8200' },
        ], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.cursor', 'mcp.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(Object.keys(settings.mcpServers)).toEqual(['anvil', 'vault', 'forge']);
        // No permissions section in Cursor format
        (0, vitest_1.expect)(settings.permissions).toBeUndefined();
    });
    (0, vitest_1.it)('does not include permissions (Cursor has no permission model)', async () => {
        await (0, mcp_settings_writer_js_1.updateCursorMcpServers)([{ name: 'anvil', url: 'http://localhost:8100' }], tmpDir);
        const raw = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.cursor', 'mcp.json'), 'utf-8');
        const settings = JSON.parse(raw);
        (0, vitest_1.expect)(settings.permissions).toBeUndefined();
        (0, vitest_1.expect)(settings.hooks).toBeUndefined();
    });
});
//# sourceMappingURL=mcp-settings-writer.test.js.map