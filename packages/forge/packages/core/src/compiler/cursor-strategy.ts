import type { ResolvedArtifact, FileOperation } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';

/**
 * Converts artifact metadata into Cursor MDC frontmatter.
 *
 * MDC format:
 * ```
 * ---
 * description: Short description
 * globs:
 * alwaysApply: true
 * ---
 * ```
 */
function toMdcContent(
  meta: { name?: string; description?: string },
  body: string,
): string {
  const description = meta.description ?? meta.name ?? '';
  const frontmatter = [
    '---',
    `description: ${description}`,
    'globs:',
    'alwaysApply: true',
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${body}`;
}

/**
 * Emits artifacts to Cursor format (.cursor/ directory structure).
 *
 * Skills emit to:   .cursor/rules/{id}.mdc      (always-on context)
 *                   .cursor/skills/{id}/SKILL.md (on-demand, structured instructions)
 * Agents emit to:   .cursor/rules/{id}.mdc
 *                   .cursor/agents/{id}.md
 * Plugins: emits all contained skills and agents via dependencies
 *
 * @example
 * const strategy = new CursorStrategy();
 * const output = strategy.emit(resolvedSkill);
 * // output.operations[0].path === '.cursor/rules/developer.mdc'
 * // output.operations[1].path === '.cursor/skills/developer/SKILL.md'
 */
export class CursorStrategy implements EmitStrategy {
  readonly target = 'cursor' as const;

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
      // Emit as Cursor rule (always-on context)
      operations.push({
        path: `.cursor/rules/${ref.id}.mdc`,
        content: toMdcContent(bundle.meta, bundle.content),
        sourceRef: ref,
        operation: 'create',
      });
      // Emit as Cursor skill (on-demand, structured instructions)
      operations.push({
        path: `.cursor/skills/${ref.id}/SKILL.md`,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });
    } else if (ref.type === 'agent') {
      // Emit as Cursor rule (always-on context)
      operations.push({
        path: `.cursor/rules/${ref.id}.mdc`,
        content: toMdcContent(bundle.meta, bundle.content),
        sourceRef: ref,
        operation: 'create',
      });
      // Emit as Cursor agent
      operations.push({
        path: `.cursor/agents/${ref.id}.md`,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });
    } else if (ref.type === 'plugin') {
      // Plugins: emit all contained skills and agents
      // Nothing to emit directly — dependencies handle it
    }
  }
}
