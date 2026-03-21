import type { ResolvedArtifact, FileOperation } from '../models/index.js';
import type { Target } from '../models/index.js';
import type { EmitStrategy, CompiledOutput } from './types.js';
import { UnsupportedTargetError } from '../adapters/errors.js';

/**
 * Compiles resolved artifacts to runtime-specific file operations.
 * Uses a strategy pattern — register EmitStrategy implementations per target.
 *
 * @example
 * const compiler = new Compiler();
 * compiler.register(new ClaudeCodeStrategy());
 * const output = compiler.emit(artifact, 'claude-code');
 */
export class Compiler {
  private readonly strategies = new Map<Target, EmitStrategy>();

  /**
   * Register an emit strategy for a target.
   */
  register(strategy: EmitStrategy): void {
    this.strategies.set(strategy.target, strategy);
  }

  /**
   * Emit a single artifact to the given target.
   * @throws {UnsupportedTargetError} if no strategy for target
   */
  emit(artifact: ResolvedArtifact, target: Target): CompiledOutput {
    const strategy = this.strategies.get(target);
    if (!strategy) {
      throw new UnsupportedTargetError(target);
    }
    return strategy.emit(artifact);
  }

  /**
   * Emit multiple artifacts, deduplicating file operations by path.
   * Later operations for the same path override earlier ones.
   */
  emitAll(artifacts: ResolvedArtifact[], target: Target): FileOperation[] {
    const allOps = new Map<string, FileOperation>();
    for (const artifact of artifacts) {
      const output = this.emit(artifact, target);
      for (const op of output.operations) {
        allOps.set(op.path, op);
      }
    }
    return Array.from(allOps.values());
  }
}
