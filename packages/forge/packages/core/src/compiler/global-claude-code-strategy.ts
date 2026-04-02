import os from 'os';
import path from 'path';
import type { ResolvedArtifact, FileOperation } from '../models/index.js';
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
export class GlobalClaudeCodeStrategy implements EmitStrategy {
  readonly target = 'claude-code' as const;

  private readonly claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), '.claude');
  }

  emit(artifact: ResolvedArtifact): CompiledOutput {
    const operations: FileOperation[] = [];
    this.emitArtifact(artifact, operations);
    return {
      operations,
      target: this.target,
      artifactRef: artifact.ref,
    };
  }

  private emitArtifact(artifact: ResolvedArtifact, operations: FileOperation[]): void {
    const { ref, bundle } = artifact;

    // Emit dependencies first (depth-first)
    for (const dep of artifact.dependencies) {
      this.emitArtifact(dep, operations);
    }

    if (ref.type === 'skill') {
      const skillPath = path.join(this.claudeDir, 'skills', ref.id, 'SKILL.md');
      operations.push({
        path: skillPath,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });
    } else if (ref.type === 'agent') {
      const agentPath = path.join(this.claudeDir, 'agents', `${ref.id}.md`);
      operations.push({
        path: agentPath,
        content: bundle.content,
        sourceRef: ref,
        operation: 'create',
      });
    }
    // Personas: no-op for global strategy — personas are workspace-scoped
    // Plugins: dependencies handle skill/agent emission
  }
}
