"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const claude_md_writer_js_1 = require("../claude-md-writer.js");
(0, vitest_1.describe)('upsertManagedSection', () => {
    (0, vitest_1.it)('inserts into empty/undefined content', () => {
        const result = (0, claude_md_writer_js_1.upsertManagedSection)(undefined, 'horus-core', '# Rules');
        (0, vitest_1.expect)(result).toBe('<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n');
    });
    (0, vitest_1.it)('inserts into empty string', () => {
        const result = (0, claude_md_writer_js_1.upsertManagedSection)('', 'horus-core', '# Rules');
        (0, vitest_1.expect)(result).toBe('<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n');
    });
    (0, vitest_1.it)('appends to existing content', () => {
        const existing = '# My CLAUDE.md\n\nSome existing content.\n';
        const result = (0, claude_md_writer_js_1.upsertManagedSection)(existing, 'horus-core', '# Rules');
        (0, vitest_1.expect)(result).toContain('# My CLAUDE.md');
        (0, vitest_1.expect)(result).toContain('<!-- forge:global:horus-core:start -->');
        (0, vitest_1.expect)(result).toContain('# Rules');
        (0, vitest_1.expect)(result).toContain('<!-- forge:global:horus-core:end -->');
    });
    (0, vitest_1.it)('appends to existing content without trailing newline', () => {
        const existing = '# My CLAUDE.md';
        const result = (0, claude_md_writer_js_1.upsertManagedSection)(existing, 'horus-core', '# Rules');
        (0, vitest_1.expect)(result).toContain('# My CLAUDE.md');
        (0, vitest_1.expect)(result).toContain('<!-- forge:global:horus-core:start -->');
    });
    (0, vitest_1.it)('replaces existing fenced section', () => {
        const existing = [
            '# My CLAUDE.md',
            '',
            '<!-- forge:global:horus-core:start -->',
            '# Old Rules',
            '<!-- forge:global:horus-core:end -->',
            '',
            'Other content.',
        ].join('\n');
        const result = (0, claude_md_writer_js_1.upsertManagedSection)(existing, 'horus-core', '# New Rules');
        (0, vitest_1.expect)(result).toContain('# New Rules');
        (0, vitest_1.expect)(result).not.toContain('# Old Rules');
        (0, vitest_1.expect)(result).toContain('Other content.');
    });
    (0, vitest_1.it)('handles multiple plugin sections independently', () => {
        let content = (0, claude_md_writer_js_1.upsertManagedSection)('', 'plugin-a', 'A rules');
        content = (0, claude_md_writer_js_1.upsertManagedSection)(content, 'plugin-b', 'B rules');
        (0, vitest_1.expect)(content).toContain('<!-- forge:global:plugin-a:start -->');
        (0, vitest_1.expect)(content).toContain('A rules');
        (0, vitest_1.expect)(content).toContain('<!-- forge:global:plugin-b:start -->');
        (0, vitest_1.expect)(content).toContain('B rules');
    });
    (0, vitest_1.it)('is idempotent (same content produces same result)', () => {
        const first = (0, claude_md_writer_js_1.upsertManagedSection)('', 'horus-core', '# Rules');
        const second = (0, claude_md_writer_js_1.upsertManagedSection)(first, 'horus-core', '# Rules');
        (0, vitest_1.expect)(second).toBe(first);
    });
});
(0, vitest_1.describe)('removeManagedSection', () => {
    (0, vitest_1.it)('removes an existing fenced section', () => {
        const content = [
            '# My CLAUDE.md',
            '',
            '<!-- forge:global:horus-core:start -->',
            '# Rules',
            '<!-- forge:global:horus-core:end -->',
            '',
            'Other content.',
        ].join('\n');
        const result = (0, claude_md_writer_js_1.removeManagedSection)(content, 'horus-core');
        (0, vitest_1.expect)(result).not.toContain('<!-- forge:global:horus-core:start -->');
        (0, vitest_1.expect)(result).not.toContain('# Rules');
        (0, vitest_1.expect)(result).toContain('# My CLAUDE.md');
        (0, vitest_1.expect)(result).toContain('Other content.');
    });
    (0, vitest_1.it)('returns content as-is when section not found', () => {
        const content = '# My CLAUDE.md\n';
        const result = (0, claude_md_writer_js_1.removeManagedSection)(content, 'nonexistent');
        (0, vitest_1.expect)(result).toBe('# My CLAUDE.md\n');
    });
    (0, vitest_1.it)('returns empty string when removing the only section', () => {
        const content = '<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n';
        const result = (0, claude_md_writer_js_1.removeManagedSection)(content, 'horus-core');
        (0, vitest_1.expect)(result).toBe('');
    });
    (0, vitest_1.it)('preserves other plugin sections when removing one', () => {
        let content = (0, claude_md_writer_js_1.upsertManagedSection)('', 'plugin-a', 'A rules');
        content = (0, claude_md_writer_js_1.upsertManagedSection)(content, 'plugin-b', 'B rules');
        const result = (0, claude_md_writer_js_1.removeManagedSection)(content, 'plugin-a');
        (0, vitest_1.expect)(result).not.toContain('A rules');
        (0, vitest_1.expect)(result).toContain('B rules');
    });
});
//# sourceMappingURL=claude-md-writer.test.js.map