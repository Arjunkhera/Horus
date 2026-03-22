import type { ResolvedArtifact } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';
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
export declare class CursorStrategy implements EmitStrategy {
    readonly target: "cursor";
    emit(artifact: ResolvedArtifact): CompiledOutput;
    private emitArtifact;
}
//# sourceMappingURL=cursor-strategy.d.ts.map