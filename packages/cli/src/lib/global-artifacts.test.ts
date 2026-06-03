import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Redirect the manifest into a throwaway temp dir by mocking getHorusDir.
let HORUS_TMP = '';
vi.mock('./config.js', () => ({
  getHorusDir: () => HORUS_TMP,
}));

import {
  parseRef,
  formatRef,
  DEFAULT_GLOBAL_ARTIFACTS,
  resolveGlobalRefs,
  listManifestRefs,
  addManifestRef,
  removeManifestRef,
  getManifestPath,
} from './global-artifacts.js';

describe('parseRef', () => {
  it('parses type:id@version', () => {
    expect(parseRef('plugin:local-sdlc@1.2.0')).toEqual({
      type: 'plugin',
      id: 'local-sdlc',
      version: '1.2.0',
    });
  });

  it('parses type:id without version', () => {
    expect(parseRef('skill:horus-anvil')).toEqual({
      type: 'skill',
      id: 'horus-anvil',
      version: undefined,
    });
  });

  it('defaults a bare id to a skill (legacy connect behaviour)', () => {
    expect(parseRef('horus-context')).toEqual({
      type: 'skill',
      id: 'horus-context',
      version: undefined,
    });
  });

  it('handles every known artifact type', () => {
    expect(parseRef('agent:sdlc-release').type).toBe('agent');
    expect(parseRef('persona:tech-lead').type).toBe('persona');
    expect(parseRef('workspace-config:finance').type).toBe('workspace-config');
  });

  it('treats an unknown prefix as part of a bare skill id', () => {
    // "foo:bar" — foo is not a known type, so the whole thing is a skill id.
    expect(parseRef('foo:bar')).toEqual({ type: 'skill', id: 'foo:bar', version: undefined });
  });
});

describe('formatRef', () => {
  it('drops the version to produce a canonical type:id', () => {
    expect(formatRef(parseRef('plugin:local-sdlc@9.9.9'))).toBe('plugin:local-sdlc');
  });
});

describe('manifest', () => {
  beforeEach(() => {
    HORUS_TMP = mkdtempSync(join(tmpdir(), 'horus-global-'));
  });

  afterEach(() => {
    if (HORUS_TMP && existsSync(HORUS_TMP)) rmSync(HORUS_TMP, { recursive: true, force: true });
  });

  it('starts empty and resolves to just the defaults', () => {
    expect(listManifestRefs()).toEqual([]);
    expect(resolveGlobalRefs().sort()).toEqual([...DEFAULT_GLOBAL_ARTIFACTS].sort());
  });

  it('ships the full SDLC suite as a built-in default', () => {
    // `horus connect` installs the SDLC globally with no prior `global install`.
    expect(DEFAULT_GLOBAL_ARTIFACTS).toContain('plugin:anvil-sdlc-v2');
    expect(resolveGlobalRefs()).toContain('plugin:anvil-sdlc-v2');
  });

  it('adds a ref (canonicalised, version stripped) and persists it', () => {
    expect(addManifestRef('plugin:local-sdlc@1.0.0')).toBe(true);
    expect(listManifestRefs()).toEqual(['plugin:local-sdlc']);
    expect(existsSync(getManifestPath())).toBe(true);
    const onDisk = JSON.parse(readFileSync(getManifestPath(), 'utf-8'));
    expect(onDisk.artifacts).toEqual(['plugin:local-sdlc']);
  });

  it('does not double-add the same artifact at a different version', () => {
    expect(addManifestRef('plugin:local-sdlc@1.0.0')).toBe(true);
    expect(addManifestRef('plugin:local-sdlc@2.0.0')).toBe(false);
    expect(listManifestRefs()).toEqual(['plugin:local-sdlc']);
  });

  it('unions defaults with the manifest, de-duped', () => {
    addManifestRef('plugin:local-sdlc');
    addManifestRef('skill:horus-anvil'); // already a default — must not duplicate
    const refs = resolveGlobalRefs();
    expect(refs).toContain('plugin:local-sdlc');
    expect(refs.filter((r) => r === 'skill:horus-anvil')).toHaveLength(1);
  });

  it('removes a ref', () => {
    addManifestRef('persona:tech-lead');
    expect(removeManifestRef('persona:tech-lead')).toBe(true);
    expect(listManifestRefs()).toEqual([]);
  });

  it('returns false when removing an absent ref', () => {
    expect(removeManifestRef('agent:does-not-exist')).toBe(false);
  });
});
