"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CursorStrategy = void 0;
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
function toMdcContent(meta, body) {
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
class CursorStrategy {
    target = 'cursor';
    emit(artifact) {
        const operations = [];
        this.emitArtifact(artifact, operations);
        return {
            operations,
            target: this.target,
            artifactRef: artifact.ref,
        };
    }
    emitArtifact(artifact, operations) {
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
        }
        else if (ref.type === 'agent') {
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
        }
        else if (ref.type === 'plugin') {
            // Plugins: emit all contained skills and agents
            // Nothing to emit directly — dependencies handle it
        }
    }
}
exports.CursorStrategy = CursorStrategy;
//# sourceMappingURL=cursor-strategy.js.map