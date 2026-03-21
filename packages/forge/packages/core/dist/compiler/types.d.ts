import type { ResolvedArtifact, FileOperation } from '../models/index.js';
import type { Target } from '../models/index.js';
/**
 * Output of a compiler emit operation.
 */
export interface CompiledOutput {
    operations: FileOperation[];
    target: Target;
    artifactRef: {
        type: string;
        id: string;
        version: string;
    };
}
/**
 * Strategy for emitting artifacts to a specific runtime format.
 * @example
 * const strategy = new ClaudeCodeStrategy();
 * const output = strategy.emit(resolvedArtifact);
 */
export interface EmitStrategy {
    readonly target: Target;
    emit(artifact: ResolvedArtifact): CompiledOutput;
}
//# sourceMappingURL=types.d.ts.map