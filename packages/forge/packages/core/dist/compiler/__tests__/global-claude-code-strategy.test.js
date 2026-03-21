"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path_1 = __importDefault(require("path"));
const global_claude_code_strategy_js_1 = require("../global-claude-code-strategy.js");
function makeSkillArtifact(id, content = `# Skill ${id}`) {
    return {
        ref: { type: 'skill', id, version: '1.0.0' },
        bundle: {
            meta: { id, name: `Skill ${id}`, version: '1.0.0', description: 'Test skill', type: 'skill', tags: [], dependencies: {}, files: [] },
            content,
            contentPath: 'SKILL.md',
        },
        dependencies: [],
    };
}
function makeAgentArtifact(id, content = `# Agent ${id}`) {
    return {
        ref: { type: 'agent', id, version: '1.0.0' },
        bundle: {
            meta: { id, name: `Agent ${id}`, version: '1.0.0', description: 'Test agent', type: 'agent', rootSkill: 'root', tags: [], dependencies: {}, skills: [] },
            content,
            contentPath: 'AGENT.md',
        },
        dependencies: [],
    };
}
function makePluginArtifact(id, skills) {
    return {
        ref: { type: 'plugin', id, version: '1.0.0' },
        bundle: {
            meta: { id, name: `Plugin ${id}`, version: '1.0.0', description: 'Test plugin', type: 'plugin', tags: [], skills: skills.map(s => s.ref.id), agents: [] },
            content: '',
            contentPath: 'PLUGIN.md',
        },
        dependencies: skills,
    };
}
(0, vitest_1.describe)('GlobalClaudeCodeStrategy', () => {
    const testClaudeDir = '/test/home/.claude';
    const strategy = new global_claude_code_strategy_js_1.GlobalClaudeCodeStrategy(testClaudeDir);
    (0, vitest_1.it)('emits skill to absolute ~/.claude/skills/{id}/SKILL.md', () => {
        const artifact = makeSkillArtifact('horus-anvil');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe(path_1.default.join(testClaudeDir, 'skills', 'horus-anvil', 'SKILL.md'));
        (0, vitest_1.expect)(output.operations[0].content).toBe('# Skill horus-anvil');
    });
    (0, vitest_1.it)('emits agent to absolute ~/.claude/agents/{id}.md', () => {
        const artifact = makeAgentArtifact('test-agent');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe(path_1.default.join(testClaudeDir, 'agents', 'test-agent.md'));
    });
    (0, vitest_1.it)('emits plugin dependencies (skills) depth-first', () => {
        const skill1 = makeSkillArtifact('skill-a');
        const skill2 = makeSkillArtifact('skill-b');
        const plugin = makePluginArtifact('test-plugin', [skill1, skill2]);
        const output = strategy.emit(plugin);
        (0, vitest_1.expect)(output.operations).toHaveLength(2);
        const paths = output.operations.map(o => o.path);
        (0, vitest_1.expect)(paths).toContain(path_1.default.join(testClaudeDir, 'skills', 'skill-a', 'SKILL.md'));
        (0, vitest_1.expect)(paths).toContain(path_1.default.join(testClaudeDir, 'skills', 'skill-b', 'SKILL.md'));
    });
    (0, vitest_1.it)('does not emit anything directly for plugin (only dependencies)', () => {
        const plugin = makePluginArtifact('empty-plugin', []);
        const output = strategy.emit(plugin);
        (0, vitest_1.expect)(output.operations).toHaveLength(0);
    });
    (0, vitest_1.it)('preserves content verbatim', () => {
        const content = '---\nname: test\n---\n\n# Complex\n{{template}}';
        const artifact = makeSkillArtifact('opaque', content);
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations[0].content).toBe(content);
    });
    (0, vitest_1.it)('includes correct artifactRef in output', () => {
        const artifact = makeSkillArtifact('test');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.artifactRef).toEqual({ type: 'skill', id: 'test', version: '1.0.0' });
    });
});
//# sourceMappingURL=global-claude-code-strategy.test.js.map