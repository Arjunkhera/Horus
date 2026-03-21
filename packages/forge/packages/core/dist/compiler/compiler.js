"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Compiler = void 0;
const errors_js_1 = require("../adapters/errors.js");
/**
 * Compiles resolved artifacts to runtime-specific file operations.
 * Uses a strategy pattern — register EmitStrategy implementations per target.
 *
 * @example
 * const compiler = new Compiler();
 * compiler.register(new ClaudeCodeStrategy());
 * const output = compiler.emit(artifact, 'claude-code');
 */
class Compiler {
    strategies = new Map();
    /**
     * Register an emit strategy for a target.
     */
    register(strategy) {
        this.strategies.set(strategy.target, strategy);
    }
    /**
     * Emit a single artifact to the given target.
     * @throws {UnsupportedTargetError} if no strategy for target
     */
    emit(artifact, target) {
        const strategy = this.strategies.get(target);
        if (!strategy) {
            throw new errors_js_1.UnsupportedTargetError(target);
        }
        return strategy.emit(artifact);
    }
    /**
     * Emit multiple artifacts, deduplicating file operations by path.
     * Later operations for the same path override earlier ones.
     */
    emitAll(artifacts, target) {
        const allOps = new Map();
        for (const artifact of artifacts) {
            const output = this.emit(artifact, target);
            for (const op of output.operations) {
                allOps.set(op.path, op);
            }
        }
        return Array.from(allOps.values());
    }
}
exports.Compiler = Compiler;
//# sourceMappingURL=compiler.js.map