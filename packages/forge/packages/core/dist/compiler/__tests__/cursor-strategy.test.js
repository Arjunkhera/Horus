"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const compiler_js_1 = require("../compiler.js");
const cursor_strategy_js_1 = require("../cursor-strategy.js");
// Fixture helpers
function makeSkillArtifact(id, content = `# Skill ${id}`) {
    return {
        ref: { type: 'skill', id, version: '1.0.0' },
        bundle: {
            meta: { id, name: `Skill ${id}`, version: '1.0.0', description: `Test skill ${id}`, type: 'skill', tags: [], dependencies: {}, files: [] },
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
            meta: { id, name: `Agent ${id}`, version: '1.0.0', description: `Test agent ${id}`, type: 'agent', rootSkill: 'root', tags: [], dependencies: {}, skills: [] },
            content,
            contentPath: 'AGENT.md',
        },
        dependencies: [],
    };
}
(0, vitest_1.describe)('CursorStrategy', () => {
    const strategy = new cursor_strategy_js_1.CursorStrategy();
    (0, vitest_1.it)('emits skill to .cursor/rules/{id}.mdc', () => {
        const artifact = makeSkillArtifact('developer');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe('.cursor/rules/developer.mdc');
        (0, vitest_1.expect)(output.operations[0].sourceRef.id).toBe('developer');
    });
    (0, vitest_1.it)('emits agent to .cursor/rules/{id}.mdc', () => {
        const artifact = makeAgentArtifact('my-agent');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe('.cursor/rules/my-agent.mdc');
    });
    (0, vitest_1.it)('wraps content in MDC frontmatter', () => {
        const artifact = makeSkillArtifact('developer');
        const output = strategy.emit(artifact);
        const content = output.operations[0].content;
        (0, vitest_1.expect)(content).toContain('---\n');
        (0, vitest_1.expect)(content).toContain('description: Test skill developer');
        (0, vitest_1.expect)(content).toContain('globs:');
        (0, vitest_1.expect)(content).toContain('alwaysApply: true');
        (0, vitest_1.expect)(content).toContain('# Skill developer');
    });
    (0, vitest_1.it)('uses description from metadata for frontmatter', () => {
        const artifact = makeSkillArtifact('dev');
        const output = strategy.emit(artifact);
        const content = output.operations[0].content;
        (0, vitest_1.expect)(content).toMatch(/^---\ndescription: Test skill dev\nglobs:\nalwaysApply: true\n---\n\n# Skill dev$/);
    });
    (0, vitest_1.it)('emits dependencies before the artifact itself', () => {
        const dep = makeSkillArtifact('dep-skill');
        const main = { ...makeSkillArtifact('main-skill'), dependencies: [dep] };
        const output = strategy.emit(main);
        const paths = output.operations.map(o => o.path);
        (0, vitest_1.expect)(paths.indexOf('.cursor/rules/dep-skill.mdc')).toBeLessThan(paths.indexOf('.cursor/rules/main-skill.mdc'));
    });
    (0, vitest_1.it)('includes sourceRef in operations', () => {
        const artifact = makeSkillArtifact('dev');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.operations[0].sourceRef).toEqual({ type: 'skill', id: 'dev', version: '1.0.0' });
    });
    (0, vitest_1.it)('sets target to cursor', () => {
        (0, vitest_1.expect)(strategy.target).toBe('cursor');
        const artifact = makeSkillArtifact('dev');
        const output = strategy.emit(artifact);
        (0, vitest_1.expect)(output.target).toBe('cursor');
    });
});
(0, vitest_1.describe)('Compiler with CursorStrategy', () => {
    (0, vitest_1.it)('delegates to CursorStrategy for cursor target', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new cursor_strategy_js_1.CursorStrategy());
        const artifact = makeSkillArtifact('dev');
        const output = compiler.emit(artifact, 'cursor');
        (0, vitest_1.expect)(output.operations).toHaveLength(1);
        (0, vitest_1.expect)(output.operations[0].path).toBe('.cursor/rules/dev.mdc');
    });
    (0, vitest_1.it)('emitAll deduplicates by path (last wins)', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new cursor_strategy_js_1.CursorStrategy());
        const a1 = makeSkillArtifact('dev');
        const a2 = { ...makeSkillArtifact('dev'), bundle: { ...makeSkillArtifact('dev').bundle, content: 'updated' } };
        const ops = compiler.emitAll([a1, a2], 'cursor');
        (0, vitest_1.expect)(ops).toHaveLength(1);
        (0, vitest_1.expect)(ops[0].content).toContain('updated');
    });
    (0, vitest_1.it)('emitAll returns all ops for distinct artifacts', () => {
        const compiler = new compiler_js_1.Compiler();
        compiler.register(new cursor_strategy_js_1.CursorStrategy());
        const ops = compiler.emitAll([makeSkillArtifact('a'), makeSkillArtifact('b')], 'cursor');
        (0, vitest_1.expect)(ops).toHaveLength(2);
    });
});
//# sourceMappingURL=cursor-strategy.test.js.map