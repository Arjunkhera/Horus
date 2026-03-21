"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCodeStrategy = void 0;
/**
 * Emits artifacts to Claude Code format (.claude/ directory structure).
 *
 * Skills emit to:   .claude/skills/{id}/SKILL.md + additional files
 * Agents emit to:   .claude/agents/{id}.md
 * Plugins: emits all contained skills and agents
 *
 * @example
 * const strategy = new ClaudeCodeStrategy();
 * const output = strategy.emit(resolvedSkill);
 * // output.operations[0].path === '.claude/skills/developer/SKILL.md'
 */
class ClaudeCodeStrategy {
    target = 'claude-code';
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
            // Skills: .claude/skills/{id}/SKILL.md
            const skillPath = `.claude/skills/${ref.id}/SKILL.md`;
            operations.push({
                path: skillPath,
                content: bundle.content,
                sourceRef: ref,
                operation: 'create',
            });
            // Additional files listed in metadata
            const meta = bundle.meta;
            for (const extraFile of (meta.files ?? [])) {
                // Additional files are referenced by the skill but content comes from the bundle
                // For now, we note them but don't emit (they'd need their own content)
            }
        }
        else if (ref.type === 'agent') {
            // Agents: .claude/agents/{id}.md
            const agentPath = `.claude/agents/${ref.id}.md`;
            operations.push({
                path: agentPath,
                content: bundle.content,
                sourceRef: ref,
                operation: 'create',
            });
        }
        else if (ref.type === 'plugin') {
            // Plugins: emit all contained skills and agents
            // Plugin content is metadata-only; individual skills/agents listed in deps
            // Nothing to emit directly — dependencies handle it
        }
    }
}
exports.ClaudeCodeStrategy = ClaudeCodeStrategy;
//# sourceMappingURL=claude-code-strategy.js.map