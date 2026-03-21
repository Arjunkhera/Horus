import { describe, it, expect } from 'vitest';
import { Compiler } from '../compiler.js';
import { ClaudeCodeStrategy } from '../claude-code-strategy.js';
import { UnsupportedTargetError } from '../../adapters/errors.js';
import type { ResolvedArtifact } from '../../models/index.js';

// Fixture helpers
function makeSkillArtifact(id: string, content = `# Skill ${id}`): ResolvedArtifact {
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

function makeAgentArtifact(id: string, content = `# Agent ${id}`): ResolvedArtifact {
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

describe('ClaudeCodeStrategy', () => {
  const strategy = new ClaudeCodeStrategy();

  it('emits skill to .claude/skills/{id}/SKILL.md', () => {
    const artifact = makeSkillArtifact('developer');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe('.claude/skills/developer/SKILL.md');
    expect(output.operations[0]!.content).toBe('# Skill developer');
    expect(output.operations[0]!.sourceRef.id).toBe('developer');
  });

  it('emits agent to .claude/agents/{id}.md', () => {
    const artifact = makeAgentArtifact('my-agent');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe('.claude/agents/my-agent.md');
  });

  it('emits dependencies before the artifact itself', () => {
    const dep = makeSkillArtifact('dep-skill');
    const main = { ...makeSkillArtifact('main-skill'), dependencies: [dep] };
    const output = strategy.emit(main);
    const paths = output.operations.map(o => o.path);
    expect(paths.indexOf('.claude/skills/dep-skill/SKILL.md')).toBeLessThan(
      paths.indexOf('.claude/skills/main-skill/SKILL.md')
    );
  });

  it('preserves SKILL.md content verbatim (opaque)', () => {
    const opaqueContent = '# Skill\n---\n{{template}} stuff\nkey: value';
    const artifact = makeSkillArtifact('opaque', opaqueContent);
    const output = strategy.emit(artifact);
    expect(output.operations[0]!.content).toBe(opaqueContent);
  });

  it('includes sourceRef in operations', () => {
    const artifact = makeSkillArtifact('dev');
    const output = strategy.emit(artifact);
    expect(output.operations[0]!.sourceRef).toEqual({ type: 'skill', id: 'dev', version: '1.0.0' });
  });
});

describe('Compiler', () => {
  it('throws UnsupportedTargetError for unknown target', () => {
    const compiler = new Compiler();
    const artifact = makeSkillArtifact('dev');
    expect(() => compiler.emit(artifact, 'claude-code')).toThrow(UnsupportedTargetError);
  });

  it('delegates to registered strategy', () => {
    const compiler = new Compiler();
    compiler.register(new ClaudeCodeStrategy());
    const artifact = makeSkillArtifact('dev');
    const output = compiler.emit(artifact, 'claude-code');
    expect(output.operations).toHaveLength(1);
  });

  it('emitAll deduplicates by path (last wins)', () => {
    const compiler = new Compiler();
    compiler.register(new ClaudeCodeStrategy());
    const a1 = makeSkillArtifact('dev');
    const a2 = { ...makeSkillArtifact('dev'), bundle: { ...makeSkillArtifact('dev').bundle, content: 'updated' } };
    const ops = compiler.emitAll([a1, a2], 'claude-code');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.content).toBe('updated');
  });

  it('emitAll returns all ops for distinct artifacts', () => {
    const compiler = new Compiler();
    compiler.register(new ClaudeCodeStrategy());
    const ops = compiler.emitAll([makeSkillArtifact('a'), makeSkillArtifact('b')], 'claude-code');
    expect(ops).toHaveLength(2);
  });
});
