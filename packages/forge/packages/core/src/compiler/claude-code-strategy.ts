import type { ResolvedArtifact, FileOperation, PersonaMeta } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';

/**
 * Emits artifacts to Claude Code format (.claude/ directory structure).
 *
 * Skills emit to:   .claude/skills/{id}/SKILL.md + additional files
 * Agents emit to:   .claude/agents/{id}.md
 * Personas emit to: .claude/personas/{id}/PERSONA.md (canonical) AND
 *                   .claude/agents/{id}.md (invocable mirror — personas
 *                   participate as agent-team members in discovery and
 *                   research-council skills, so they must be discoverable
 *                   by Claude Code's subagent loader).
 * Plugins: emits all contained skills and agents
 *
 * @example
 * const strategy = new ClaudeCodeStrategy();
 * const output = strategy.emit(resolvedSkill);
 * // output.operations[0].path === '.claude/skills/developer/SKILL.md'
 */
export class ClaudeCodeStrategy implements EmitStrategy {
  readonly target = 'claude-code' as const;

  emit(artifact: ResolvedArtifact): CompiledOutput {
    const operations: FileOperation[] = [];
    this.emitArtifact(artifact, operations);
    return {
      operations,
      target: this.target,
      artifactRef: artifact.ref,
    };
  }

  private emitArtifact(artifact: ResolvedArtifact, operations: FileOperation[]): void {
    const { ref, bundle } = artifact;

    // Emit dependencies first (depth-first)
    for (const dep of artifact.dependencies) {
      this.emitArtifact(dep, operations);
    }

    if (ref.type === 'skill') {
      // Skills: .claude/skills/{id}/SKILL.md
      const skillPath = `.claude/skills/${ref.id}/SKILL.md`;
      operations.push({
        path: skillPath,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });

      // Additional files listed in metadata
      const meta = bundle.meta as { files?: string[] };
      for (const extraFile of (meta.files ?? [])) {
        // Additional files are referenced by the skill but content comes from the bundle
        // For now, we note them but don't emit (they'd need their own content)
      }
    } else if (ref.type === 'agent') {
      // Agents: .claude/agents/{id}.md
      const agentPath = `.claude/agents/${ref.id}.md`;
      operations.push({
        path: agentPath,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });
    } else if (ref.type === 'persona') {
      // Personas: canonical location + Claude Code agent-mirror.
      //
      // Personas represent agent-team members (stakeholder voices, council
      // participants). Skills invoke them via the Claude Code Agent tool,
      // which only discovers subagents under .claude/agents/<id>.md. We
      // therefore write two files:
      //
      //   1. .claude/personas/{id}/PERSONA.md — canonical, forge-native
      //   2. .claude/agents/{id}.md — invocable mirror with Claude Code
      //      frontmatter synthesised from persona metadata
      const meta = bundle.meta as PersonaMeta;
      const personaPath = `.claude/personas/${ref.id}/PERSONA.md`;
      operations.push({
        path: personaPath,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });

      const agentMirrorPath = `.claude/agents/${ref.id}.md`;
      operations.push({
        path: agentMirrorPath,
        content: buildPersonaAgentMirror(meta, bundle.content),
        sourceRef: ref,
        operation: 'create',
      });
    } else if (ref.type === 'plugin') {
      // Plugins: emit all contained skills and agents
      // Plugin content is metadata-only; individual skills/agents listed in deps
      // Nothing to emit directly — dependencies handle it
    }
  }
}

/**
 * Build the Claude Code agent-mirror content for a persona.
 *
 * The authored PERSONA.md carries its own frontmatter (forge-internal:
 * {id, name}). Claude Code's subagent loader requires {name, description}
 * where `name` matches the filename stem. This helper strips any existing
 * leading frontmatter block and prepends frontmatter synthesised from
 * persona metadata — leaving the persona body (identity, goals, concerns,
 * communication style) intact as the subagent's instructions.
 */
function buildPersonaAgentMirror(meta: PersonaMeta, personaContent: string): string {
  const stripped = personaContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const indentedDescription = meta.description
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n');
  return `---\nname: ${meta.id}\ndescription: >\n${indentedDescription}\n---\n\n${stripped}`;
}
