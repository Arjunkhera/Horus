import { describe, it, expect } from 'vitest';
import { setNestedValue, getNestedValue } from '../config-helpers.js';

describe('Config Helpers', () => {
  describe('setNestedValue()', () => {
    it('sets a simple value', () => {
      const obj: any = {};
      setNestedValue(obj, 'workspace.mount_path', '~/my-workspaces');
      expect(obj.workspace.mount_path).toBe('~/my-workspaces');
    });

    it('sets a numeric value', () => {
      const obj: any = {};
      setNestedValue(obj, 'workspace.retention_days', '60');
      expect(obj.workspace.retention_days).toBe(60);
    });

    it('sets a boolean true value', () => {
      const obj: any = {};
      setNestedValue(obj, 'some.flag', 'true');
      expect(obj.some.flag).toBe(true);
    });

    it('sets a boolean false value', () => {
      const obj: any = {};
      setNestedValue(obj, 'some.flag', 'false');
      expect(obj.some.flag).toBe(false);
    });

    it('sets an array from comma-separated string', () => {
      const obj: any = {};
      setNestedValue(obj, 'repos.scan_paths', '~/Repos,~/Projects');
      expect(obj.repos.scan_paths).toEqual(['~/Repos', '~/Projects']);
    });

    it('trims whitespace in arrays', () => {
      const obj: any = {};
      setNestedValue(obj, 'repos.scan_paths', '~/Repos, ~/Projects, /absolute');
      expect(obj.repos.scan_paths).toEqual(['~/Repos', '~/Projects', '/absolute']);
    });

    it('creates nested objects as needed', () => {
      const obj: any = {};
      setNestedValue(obj, 'mcp_endpoints.anvil.url', 'http://localhost:3002');
      expect(obj.mcp_endpoints.anvil.url).toBe('http://localhost:3002');
    });

    it('overwrites existing values', () => {
      const obj: any = { workspace: { mount_path: '/old/path' } };
      setNestedValue(obj, 'workspace.mount_path', '~/new-path');
      expect(obj.workspace.mount_path).toBe('~/new-path');
    });

    it('handles single-part paths', () => {
      const obj: any = {};
      setNestedValue(obj, 'simple', 'value');
      expect(obj.simple).toBe('value');
    });

    it('preserves sibling properties', () => {
      const obj: any = { other: 'data' };
      setNestedValue(obj, 'workspace.mount_path', '~/path');
      expect(obj.other).toBe('data');
      expect(obj.workspace.mount_path).toBe('~/path');
    });

    it('handles zero as a number', () => {
      const obj: any = {};
      setNestedValue(obj, 'count', '0');
      expect(obj.count).toBe(0);
      expect(typeof obj.count).toBe('number');
    });

    it('handles empty string as string value', () => {
      const obj: any = {};
      setNestedValue(obj, 'value', '');
      expect(obj.value).toBe('');
    });
  });

  describe('getNestedValue()', () => {
    it('gets a simple value', () => {
      const obj = { workspace: { mount_path: '~/path' } };
      expect(getNestedValue(obj, 'workspace.mount_path')).toBe('~/path');
    });

    it('gets a nested value', () => {
      const obj = { a: { b: { c: 'value' } } };
      expect(getNestedValue(obj, 'a.b.c')).toBe('value');
    });

    it('returns undefined for missing path', () => {
      const obj = { workspace: {} };
      expect(getNestedValue(obj, 'workspace.missing')).toBeUndefined();
    });

    it('returns undefined for deeply missing path', () => {
      const obj = { workspace: { mount_path: '~/path' } };
      expect(getNestedValue(obj, 'workspace.mount_path.nested')).toBeUndefined();
    });

    it('handles single-part paths', () => {
      const obj = { simple: 'value' };
      expect(getNestedValue(obj, 'simple')).toBe('value');
    });

    it('returns undefined for null intermediate values', () => {
      const obj: any = { workspace: null };
      expect(getNestedValue(obj, 'workspace.mount_path')).toBeUndefined();
    });
  });
});
