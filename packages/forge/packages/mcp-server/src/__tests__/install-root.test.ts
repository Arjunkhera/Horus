import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { resolveInstallRoot } from '../index.js';

describe('resolveInstallRoot — forge_add / forge_install target resolution', () => {
  const origEnv = process.env.FORGE_WORKSPACES_PATH;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.FORGE_WORKSPACES_PATH;
    else process.env.FORGE_WORKSPACES_PATH = origEnv;
  });

  it('uses an explicit absolute path as-is (highest precedence)', () => {
    expect(resolveInstallRoot({ path: '/srv/project' })).toBe('/srv/project');
  });

  it('resolves a relative path against cwd', () => {
    expect(resolveInstallRoot({ path: 'sub/dir' })).toBe(path.resolve(process.cwd(), 'sub/dir'));
  });

  it('path wins over workspaceId when both are given', () => {
    expect(resolveInstallRoot({ path: '/srv/project', workspaceId: 'ws-1' })).toBe('/srv/project');
  });

  it('maps workspaceId under FORGE_WORKSPACES_PATH when set', () => {
    process.env.FORGE_WORKSPACES_PATH = '/horus/workspaces';
    expect(resolveInstallRoot({ workspaceId: 'ws-1' })).toBe('/horus/workspaces/ws-1');
  });

  it('falls back to /data/workspaces for workspaceId when env unset', () => {
    delete process.env.FORGE_WORKSPACES_PATH;
    expect(resolveInstallRoot({ workspaceId: 'ws-1' })).toBe('/data/workspaces/ws-1');
  });

  it('defaults to cwd when neither path nor workspaceId is given', () => {
    expect(resolveInstallRoot({})).toBe(process.cwd());
  });

  it('treats empty/whitespace strings as absent', () => {
    delete process.env.FORGE_WORKSPACES_PATH;
    expect(resolveInstallRoot({ path: '   ', workspaceId: '' })).toBe(process.cwd());
  });
});
