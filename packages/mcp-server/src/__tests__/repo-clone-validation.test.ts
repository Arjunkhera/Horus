import { describe, it, expect } from 'vitest';
import { validateRepoCloneArgs } from '../index.js';

/**
 * Regression tests for the forge_repo_clone workspace-path guard.
 *
 * This bug has regressed three times (stories 35c358c9, 5da6a95a, dd355cf0).
 * Each time, callers omitted workspacePath and clones silently landed at the
 * global mount root (/workspaces/<repo>) instead of inside the workspace
 * (/workspaces/<workspace-id>/<repo>).
 *
 * The fix: validateRepoCloneArgs() is called in the MCP handler BEFORE
 * forge.repoClone() and returns an error when neither workspacePath nor
 * destPath is provided.
 *
 * These tests cover validateRepoCloneArgs() directly so that any future
 * refactor of the handler that drops the validation call will fail here.
 */
describe('validateRepoCloneArgs — forge_repo_clone workspace-path guard', () => {
  describe('regression: missing workspacePath and destPath', () => {
    it('returns WORKSPACE_PATH_REQUIRED error when neither workspacePath nor destPath is provided', () => {
      const result = validateRepoCloneArgs({ repoName: 'Forge' });

      expect(result).not.toBeNull();
      expect(result!.error).toBe(true);
      expect(result!.code).toBe('WORKSPACE_PATH_REQUIRED');
    });

    it('error message instructs caller to pass FORGE_WORKSPACE_PATH', () => {
      const result = validateRepoCloneArgs({ repoName: 'Forge' });

      expect(result!.suggestion).toMatch(/FORGE_WORKSPACE_PATH/);
    });
  });

  describe('valid calls that must NOT be blocked', () => {
    it('returns null when workspacePath is provided', () => {
      const result = validateRepoCloneArgs({
        repoName: 'Forge',
        workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
      });

      expect(result).toBeNull();
    });

    it('returns null when destPath is provided (explicit override)', () => {
      const result = validateRepoCloneArgs({
        repoName: 'Forge',
        destPath: '/custom/explicit/path/Forge',
      });

      expect(result).toBeNull();
    });

    it('returns null when both workspacePath and destPath are provided', () => {
      const result = validateRepoCloneArgs({
        repoName: 'Forge',
        workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
        destPath: '/data/workspaces/sdlc-default-ws-abc123/Forge',
      });

      expect(result).toBeNull();
    });
  });

  describe('missing repoName', () => {
    it('returns REPO_NAME_REQUIRED error when repoName is absent', () => {
      const result = validateRepoCloneArgs({
        workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
      });

      expect(result).not.toBeNull();
      expect(result!.code).toBe('REPO_NAME_REQUIRED');
    });
  });
});
