import type { ResolvedArtifact } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';
/**
 * Emits artifacts to the global Claude Code user directory (~/.claude/).
 *
 * Unlike ClaudeCodeStrategy (which uses relative workspace paths),
 * this strategy emits to absolute paths under the user's home directory:
 *   Skills → ~/.claude/skills/{id}/SKILL.md
 *   Agents → ~/.claude/agents/{id}.md
 *   Plugins → emit contained skills and agents (plugin content is metadata-only)
 *
 * Used by `forge global install` to install plugins at the user level.
 */
export declare class GlobalClaudeCodeStrategy implements EmitStrategy {
    readonly target: "claude-code";
    private readonly claudeDir;
    constructor(claudeDir?: string);
    emit(artifact: ResolvedArtifact): CompiledOutput;
    private emitArtifact;
}
//# sourceMappingURL=global-claude-code-strategy.d.ts.map