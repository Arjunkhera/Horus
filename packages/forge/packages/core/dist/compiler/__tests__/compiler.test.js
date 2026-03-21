"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const compiler_js_1 = require("../compiler.js");
const claude_code_strategy_js_1 = require("../claude-code-strategy.js");
const errors_js_1 = require("../../adapters/errors.js");
// Fixture helpers
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
(0, vitest_1.describe)('ClaudeCodeStrategy', () => {
    const strategy = new claude_code_strategy_js_1.ClaudeCodeStrategy();
    (0, vitest_1.it)('emits skill to .claude/skills/{id}/SKILL.md', () => {
        const artifact = makeSkillArtifact('developer');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe('.claude/skills/developer/SKILL.md');
        (0, vitest_1.expect)(output.operations[0].content).toBe('# Skill developer');
        (0, vitest_1.expect)(output.operations[0].sourceRef.id).toBe('developer');
    });
    (0, vitest_1.it)('emits agent to .claude/agents/{id}.md', () => {
        const artifact = makeAgentArtifact('my-agent');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe('.claude/agents/my-agent.md');
    });
    (0, vitest_1.it)('emits dependencies before the artifact itself', () => {
        const dep = makeSkillArtifact('dep-skill');
        const main = { ...makeSkillArtifact('main-skill'), dependencies: [dep] };
        const output = strategy.emit(main);
        const paths = output.operations.map(o => o.path);
        (0, vitest_1.expect)(paths.indexOf('.claude/skills/dep-skill/SKILL.md')).toBeLessThan(paths.indexOf('.claude/skills/main-skill/SKILL.md'));
    });
    (0, vitest_1.it)('preserves SKILL.md content verbatim (opaque)', () => {
        const opaqueContent = '# Skill\n---\n{{template}} stuff\nkey: value';
        const artifact = makeSkillArtifact('opaque', opaqueContent);
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations[0].content).toBe(opaqueContent);
    });
    (0, vitest_1.it)('includes sourceRef in operations', () => {
        const artifact = makeSkillArtifact('dev');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations[0].sourceRef).toEqual({ type: 'skill', id: 'dev', version: '1.0.0' });
    });
});
(0, vitest_1.describe)('Compiler', () => {
    (0, vitest_1.it)('throws UnsupportedTargetError for unknown target', () => {
        const compiler = new compiler_js_1.Compiler();
        const artifact = makeSkillArtifact('dev');
        (0, vitest_1.expect)(() => compiler.emit(artifact, 'claude-code')).toThrow(errors_js_1.UnsupportedTargetError);
    });
    (0, vitest_1.it)('delegates to registered strategy', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new claude_code_strategy_js_1.ClaudeCodeStrategy());
        const artifact = makeSkillArtifact('dev');
        const output = compiler.emit(artifact, 'claude-code');
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
    });
    (0, vitest_1.it)('emitAll deduplicates by path (last wins)', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new claude_code_strategy_js_1.ClaudeCodeStrategy());
        const a1 = makeSkillArtifact('dev');
        const a2 = { ...makeSkillArtifact('dev'), bundle: { ...makeSkillArtifact('dev').bundle, content: 'updated' } };
        const ops = compiler.emitAll([a1, a2], 'claude-code');
        (0, vitest_1.expect)(ops).toHaveLength(1);
        (0, vitest_1.expect)(ops[0].content).toBe('updated');
    });
    (0, vitest_1.it)('emitAll returns all ops for distinct artifacts', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new claude_code_strategy_js_1.ClaudeCodeStrategy());
        const ops = compiler.emitAll([makeSkillArtifact('a'), makeSkillArtifact('b')], 'claude-code');
        (0, vitest_1.expect)(ops).toHaveLength(2);
    });
});
//# sourceMappingURL=compiler.test.js.map