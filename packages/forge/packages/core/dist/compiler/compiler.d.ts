import type { ResolvedArtifact, FileOperation } from '../models/index.js';
import type { Target } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';
/**
 * Compiles resolved artifacts to runtime-specific file operations.
 * Uses a strategy pattern — register EmitStrategy implementations per target.
 *
 * @example
 * const compiler = new Compiler();
 * compiler.register(new ClaudeCodeStrategy());
 * const output = compiler.emit(artifact, 'claude-code');
 */
export declare class Compiler {
    private readonly strategies;
    /**
     * Register an emit strategy for a target.
     */
    register(strategy: EmitStrategy): void;
    /**
     * Emit a single artifact to the given target.
     * @throws {UnsupportedTargetError} if no strategy for target
     */
    emit(artifact: ResolvedArtifact, target: Target): CompiledOutput;
    /**
     * Emit multiple artifacts, deduplicating file operations by path.
     * Later operations for the same path override earlier ones.
     */
    emitAll(artifacts: ResolvedArtifact[], target: Target): FileOperation[];
}
//# sourceMappingURL=compiler.d.ts.map