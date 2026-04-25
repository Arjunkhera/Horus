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

function makePersonaArtifact(
  id: string,
  options: { description?: string; content?: string } = {}
): ResolvedArtifact {
  const description = options.description ?? `Persona ${id} description`;
  const content =
    options.content ??
    `---\nid: ${id}\nname: Persona ${id}\n---\n\n# Persona ${id}\n\nPersona body`;
  return {
    ref: { type: 'persona', id, version: '1.0.0' },
    bundle: {
      meta: { id, name: `Persona ${id}`, version: '1.0.0', description, type: 'persona', tags: [] },
      content,
      contentPath: 'PERSONA.md',
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

  it('emits persona to both canonical path and invocable agent-mirror', () => {
    const artifact = makePersonaArtifact('skeptic', {
      description: 'Devil\'s advocate who rigorously challenges assumptions.',
    });
    const output = strategy.emit(artifact);
    const paths = output.operations.map((o) => o.path);
    expect(paths).toContain('.claude/personas/skeptic/PERSONA.md');
    expect(paths).toContain('.claude/agents/skeptic.md');
    expect(output.operations).toHaveLength(2);
  });

  it('persona canonical emission preserves PERSONA.md content verbatim', () => {
    const authored =
      '---\nid: skeptic\nname: Skeptic\n---\n\n# Skeptic\n\nChallenges assumptions.';
    const artifact = makePersonaArtifact('skeptic', { content: authored });
    const output = strategy.emit(artifact);
    const canonical = output.operations.find(
      (o) => o.path === '.claude/personas/skeptic/PERSONA.md'
    );
    expect(canonical?.content).toBe(authored);
  });

  it('persona agent-mirror strips original frontmatter and uses meta.id + description', () => {
    const authored =
      '---\nid: skeptic\nname: Skeptic\n---\n\n# Skeptic\n\nChallenges assumptions.';
    const artifact = makePersonaArtifact('skeptic', {
      description: 'Devil\'s advocate who challenges weak reasoning.',
      content: authored,
    });
    const output = strategy.emit(artifact);
    const mirror = output.operations.find((o) => o.path === '.claude/agents/skeptic.md');
    expect(mirror).toBeDefined();
    expect(mirror!.content).toMatch(/^---\nname: skeptic\n/);
    expect(mirror!.content).toContain(
      "description: >\n  Devil's advocate who challenges weak reasoning."
    );
    // Body retained, original frontmatter stripped
    expect(mirror!.content).toContain('# Skeptic');
    expect(mirror!.content).toContain('Challenges assumptions.');
    expect(mirror!.content).not.toContain('id: skeptic\nname: Skeptic');
  });

  it('persona agent-mirror tolerates missing original frontmatter', () => {
    const artifact = makePersonaArtifact('plain', {
      content: '# Plain persona\n\nNo frontmatter here.',
      description: 'A persona without authored frontmatter.',
    });
    const output = strategy.emit(artifact);
    const mirror = output.operations.find((o) => o.path === '.claude/agents/plain.md');
    expect(mirror!.content).toMatch(/^---\nname: plain\ndescription: >\n  A persona without/);
    expect(mirror!.content).toContain('# Plain persona');
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
