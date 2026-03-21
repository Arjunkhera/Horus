import type { ResolvedArtifact } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';
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
export declare class ClaudeCodeStrategy implements EmitStrategy {
    readonly target: "claude-code";
    emit(artifact: ResolvedArtifact): CompiledOutput;
    private emitArtifact;
}
//# sourceMappingURL=claude-code-strategy.d.ts.map