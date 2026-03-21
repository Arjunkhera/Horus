import { describe, it, expect } from 'vitest';
import path from 'path';
import { GlobalClaudeCodeStrategy } from '../global-claude-code-strategy.js';
import type { ResolvedArtifact } from '../../models/index.js';

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

function makePluginArtifact(id: string, skills: ResolvedArtifact[]): ResolvedArtifact {
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

describe('GlobalClaudeCodeStrategy', () => {
  const testClaudeDir = '/test/home/.claude';
  const strategy = new GlobalClaudeCodeStrategy(testClaudeDir);

  it('emits skill to absolute ~/.claude/skills/{id}/SKILL.md', () => {
    const artifact = makeSkillArtifact('horus-anvil');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe(
      path.join(testClaudeDir, 'skills', 'horus-anvil', 'SKILL.md')
    );
    expect(output.operations[0]!.content).toBe('# Skill horus-anvil');
  });

  it('emits agent to absolute ~/.claude/agents/{id}.md', () => {
    const artifact = makeAgentArtifact('test-agent');
    const output = strategy.emit(artifact);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0]!.path).toBe(
      path.join(testClaudeDir, 'agents', 'test-agent.md')
    );
  });

  it('emits plugin dependencies (skills) depth-first', () => {
    const skill1 = makeSkillArtifact('skill-a');
    const skill2 = makeSkillArtifact('skill-b');
    const plugin = makePluginArtifact('test-plugin', [skill1, skill2]);

    const output = strategy.emit(plugin);
    expect(output.operations).toHaveLength(2);

    const paths = output.operations.map(o => o.path);
    expect(paths).toContain(path.join(testClaudeDir, 'skills', 'skill-a', 'SKILL.md'));
    expect(paths).toContain(path.join(testClaudeDir, 'skills', 'skill-b', 'SKILL.md'));
  });

  it('does not emit anything directly for plugin (only dependencies)', () => {
    const plugin = makePluginArtifact('empty-plugin', []);
    const output = strategy.emit(plugin);
    expect(output.operations).toHaveLength(0);
  });

  it('preserves content verbatim', () => {
    const content = '---\nname: test\n---\n\n# Complex\n{{template}}';
    const artifact = makeSkillArtifact('opaque', content);
    const output = strategy.emit(artifact);
    expect(output.operations[0]!.content).toBe(content);
  });

  it('includes correct artifactRef in output', () => {
    const artifact = makeSkillArtifact('test');
    const output = strategy.emit(artifact);
    expect(output.artifactRef).toEqual({ type: 'skill', id: 'test', version: '1.0.0' });
  });
});
