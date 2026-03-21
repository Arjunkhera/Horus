"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalClaudeCodeStrategy = void 0;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
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
class GlobalClaudeCodeStrategy {
    target = 'claude-code';
    claudeDir;
    constructor(claudeDir) {
        this.claudeDir = claudeDir ?? path_1.default.join(os_1.default.homedir(), '.claude');
    }
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
            const skillPath = path_1.default.join(this.claudeDir, 'skills', ref.id, 'SKILL.md');
            operations.push({
                path: skillPath,
                content: bundle.content,
                sourceRef: ref,
                operation: 'create',
            });
        }
        else if (ref.type === 'agent') {
            const agentPath = path_1.default.join(this.claudeDir, 'agents', `${ref.id}.md`);
            operations.push({
                path: agentPath,
                content: bundle.content,
                sourceRef: ref,
                operation: 'create',
            });
        }
        // Plugins: dependencies handle skill/agent emission
    }
}
exports.GlobalClaudeCodeStrategy = GlobalClaudeCodeStrategy;
//# sourceMappingURL=global-claude-code-strategy.js.map