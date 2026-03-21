import { describe, it, expect } from 'vitest';
import { Compiler } from '../compiler.js';
import { CursorStrategy } from '../cursor-strategy.js';
import type { ResolvedArtifact } from '../../models/index.js';

// Fixture helpers
function makeSkillArtifact(id: string, content = `# Skill ${id}`): ResolvedArtifact {
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

function makeAgentArtifact(id: string, content = `# Agent ${id}`): ResolvedArtifact {
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

describe('CursorStrategy', () => {
  const strategy = new CursorStrategy();

  it('emits skill to .cursor/rules/{id}.mdc', () => {
    const artifact = makeSkillArtifact('developer');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe('.cursor/rules/developer.mdc');
    expect(output.operations[0]!.sourceRef.id).toBe('developer');
  });

  it('emits agent to .cursor/rules/{id}.mdc', () => {
    const artifact = makeAgentArtifact('my-agent');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe('.cursor/rules/my-agent.mdc');
  });

  it('wraps content in MDC frontmatter', () => {
    const artifact = makeSkillArtifact('developer');
    const output = strategy.emit(artifact);
    const content = output.operations[0]!.content;
    expect(content).toContain('---\n');
    expect(content).toContain('description: Test skill developer');
    expect(content).toContain('globs:');
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('# Skill developer');
  });

  it('uses description from metadata for frontmatter', () => {
    const artifact = makeSkillArtifact('dev');
    const output = strategy.emit(artifact);
    const content = output.operations[0]!.content;
    expect(content).toMatch(/^---\ndescription: Test skill dev\nglobs:\nalwaysApply: true\n---\n\n# Skill dev$/);
  });

  it('emits dependencies before the artifact itself', () => {
    const dep = makeSkillArtifact('dep-skill');
    const main = { ...makeSkillArtifact('main-skill'), dependencies: [dep] };
    const output = strategy.emit(main);
    const paths = output.operations.map(o => o.path);
    expect(paths.indexOf('.cursor/rules/dep-skill.mdc')).toBeLessThan(
      paths.indexOf('.cursor/rules/main-skill.mdc')
    );
  });

  it('includes sourceRef in operations', () => {
    const artifact = makeSkillArtifact('dev');
    const output = strategy.emit(artifact);
    expect(output.operations[0]!.sourceRef).toEqual({ type: 'skill', id: 'dev', version: '1.0.0' });
  });

  it('sets target to cursor', () => {
    expect(strategy.target).toBe('cursor');
    const artifact = makeSkillArtifact('dev');
    const output = strategy.emit(artifact);
    expect(output.target).toBe('cursor');
  });
});

describe('Compiler with CursorStrategy', () => {
  it('delegates to CursorStrategy for cursor target', () => {
    const compiler = new Compiler();
    compiler.register(new CursorStrategy());
    const artifact = makeSkillArtifact('dev');
    const output = compiler.emit(artifact, 'cursor');
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe('.cursor/rules/dev.mdc');
  });

  it('emitAll deduplicates by path (last wins)', () => {
    const compiler = new Compiler();
    compiler.register(new CursorStrategy());
    const a1 = makeSkillArtifact('dev');
    const a2 = { ...makeSkillArtifact('dev'), bundle: { ...makeSkillArtifact('dev').bundle, content: 'updated' } };
    const ops = compiler.emitAll([a1, a2], 'cursor');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.content).toContain('updated');
  });

  it('emitAll returns all ops for distinct artifacts', () => {
    const compiler = new Compiler();
    compiler.register(new CursorStrategy());
    const ops = compiler.emitAll([makeSkillArtifact('a'), makeSkillArtifact('b')], 'cursor');
    expect(ops).toHaveLength(2);
  });
});
