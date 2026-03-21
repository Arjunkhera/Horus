import { describe, it, expect, vi } from 'vitest';
import { CompositeAdapter } from '../composite-adapter.js';
import type { DataAdapter } from '../types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../../models/index.js';
import { AllAdaptersFailedError } from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers — mock adapters
// ---------------------------------------------------------------------------

function mockMeta(id: string, type: ArtifactType = 'skill'): ArtifactMeta {
  return {
    id,
    name: `${id} name`,
    version: '1.0.0',
    description: `The ${id} artifact`,
    type,
    tags: [],
    dependencies: {},
    files: [],
  } as ArtifactMeta;
}

function mockBundle(id: string, type: ArtifactType = 'skill'): ArtifactBundle {
  return {
    meta: mockMeta(id, type),
    content: `# ${id}\nContent for ${id}`,
    contentPath: 'SKILL.md',
  };
}

function createMockAdapter(
  artifacts: Map<string, ArtifactBundle>,
  name = 'MockAdapter',
): DataAdapter {
  const adapter: DataAdapter = {
    async list(type: ArtifactType): Promise<ArtifactMeta[]> {
      const results: ArtifactMeta[] = [];
      for (const bundle of artifacts.values()) {
        if (bundle.meta.type === type) results.push(bundle.meta);
      }
      return results;
    },
    async read(type: ArtifactType, id: string): Promise<ArtifactBundle> {
      const bundle = artifacts.get(`${type}:${id}`);
      if (!bundle) throw new Error(`Not found: ${type}:${id}`);
      return bundle;
    },
    async exists(type: ArtifactType, id: string): Promise<boolean> {
      return artifacts.has(`${type}:${id}`);
    },
    async write(_type: ArtifactType, _id: string, _bundle: ArtifactBundle): Promise<void> {
      // no-op for mock
    },
  };

  // Give the mock adapter a recognisable name for error messages
  Object.defineProperty(adapter.constructor, 'name', { value: name });
  return adapter;
}

function createFailingAdapter(adapterName = 'FailingAdapter'): DataAdapter {
  // Create a unique class per name so constructor.name is distinct
  class NamedFailingAdapter implements DataAdapter {
    async list(): Promise<ArtifactMeta[]> {
      throw new Error(`${adapterName} list failure`);
    }
    async read(): Promise<ArtifactBundle> {
      throw new Error(`${adapterName} read failure`);
    }
    async exists(): Promise<boolean> {
      throw new Error(`${adapterName} exists failure`);
    }
    async write(): Promise<void> {
      throw new Error(`${adapterName} write failure`);
    }
  }
  Object.defineProperty(NamedFailingAdapter, 'name', { value: adapterName });
  return new NamedFailingAdapter();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompositeAdapter', () => {
  describe('constructor', () => {
    it('requires at least one adapter', () => {
      expect(() => new CompositeAdapter({ adapters: [] })).toThrow(
        'CompositeAdapter requires at least one adapter'
      );
    });

    it('rejects out-of-bounds writableIndex', () => {
      const adapter = createMockAdapter(new Map());
      expect(
        () => new CompositeAdapter({ adapters: [adapter], writableIndex: 5 })
      ).toThrow('writableIndex 5 is out of bounds');
    });

    it('accepts valid writableIndex', () => {
      const a1 = createMockAdapter(new Map());
      const a2 = createMockAdapter(new Map());
      expect(
        () => new CompositeAdapter({ adapters: [a1, a2], writableIndex: 1 })
      ).not.toThrow();
    });
  });

  describe('list()', () => {
    it('merges results from all adapters', async () => {
      const a1 = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const a2 = createMockAdapter(
        new Map([['skill:test', mockBundle('test')]])
      );
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      const results = await composite.list('skill');
      const ids = results.map((r) => r.id);
      expect(ids).toContain('dev');
      expect(ids).toContain('test');
      expect(results).toHaveLength(2);
    });

    it('deduplicates by id — higher priority adapter wins', async () => {
      const highPriBundle = mockBundle('shared');
      highPriBundle.meta = {
        ...highPriBundle.meta,
        description: 'from-high-priority',
      } as ArtifactMeta;

      const lowPriBundle = mockBundle('shared');
      lowPriBundle.meta = {
        ...lowPriBundle.meta,
        description: 'from-low-priority',
      } as ArtifactMeta;

      const a1 = createMockAdapter(new Map([['skill:shared', highPriBundle]]));
      const a2 = createMockAdapter(new Map([['skill:shared', lowPriBundle]]));
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      const results = await composite.list('skill');
      expect(results).toHaveLength(1);
      expect(results[0]!.description).toBe('from-high-priority');
    });

    it('skips failing adapter and returns results from others', async () => {
      const failing = createFailingAdapter('BadAdapter');
      const good = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const composite = new CompositeAdapter({ adapters: [failing, good] });

      const results = await composite.list('skill');
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('dev');
    });

    it('returns empty array when all adapters fail', async () => {
      const f1 = createFailingAdapter('Fail1');
      const f2 = createFailingAdapter('Fail2');
      const composite = new CompositeAdapter({ adapters: [f1, f2] });

      const results = await composite.list('skill');
      expect(results).toHaveLength(0);
    });
  });

  describe('read()', () => {
    it('returns from first adapter that has the artifact', async () => {
      const a1 = createMockAdapter(new Map()); // empty
      const a2 = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      const result = await composite.read('skill', 'dev');
      expect(result.meta.id).toBe('dev');
    });

    it('returns from higher priority adapter when both have artifact', async () => {
      const highPri = mockBundle('dev');
      highPri.content = 'high-priority-content';
      const lowPri = mockBundle('dev');
      lowPri.content = 'low-priority-content';

      const a1 = createMockAdapter(new Map([['skill:dev', highPri]]));
      const a2 = createMockAdapter(new Map([['skill:dev', lowPri]]));
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      const result = await composite.read('skill', 'dev');
      expect(result.content).toBe('high-priority-content');
    });

    it('skips failing adapter and reads from next', async () => {
      const failing = createFailingAdapter('BadAdapter');
      const good = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const composite = new CompositeAdapter({ adapters: [failing, good] });

      const result = await composite.read('skill', 'dev');
      expect(result.meta.id).toBe('dev');
    });

    it('throws AllAdaptersFailedError when all adapters fail', async () => {
      const f1 = createFailingAdapter('Fail1');
      const f2 = createFailingAdapter('Fail2');
      const composite = new CompositeAdapter({ adapters: [f1, f2] });

      await expect(composite.read('skill', 'missing')).rejects.toThrow(
        AllAdaptersFailedError
      );
    });

    it('AllAdaptersFailedError includes sources tried', async () => {
      const f1 = createFailingAdapter('Fail1');
      const f2 = createFailingAdapter('Fail2');
      const composite = new CompositeAdapter({ adapters: [f1, f2] });

      try {
        await composite.read('skill', 'missing');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Fail1');
        expect(err.message).toContain('Fail2');
      }
    });
  });

  describe('exists()', () => {
    it('returns true when first adapter has it', async () => {
      const a1 = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const a2 = createMockAdapter(new Map());
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      expect(await composite.exists('skill', 'dev')).toBe(true);
    });

    it('returns true when only later adapter has it', async () => {
      const a1 = createMockAdapter(new Map());
      const a2 = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      expect(await composite.exists('skill', 'dev')).toBe(true);
    });

    it('returns false when no adapter has it', async () => {
      const a1 = createMockAdapter(new Map());
      const a2 = createMockAdapter(new Map());
      const composite = new CompositeAdapter({ adapters: [a1, a2] });

      expect(await composite.exists('skill', 'missing')).toBe(false);
    });

    it('skips failing adapter and checks next', async () => {
      const failing = createFailingAdapter('BadAdapter');
      const good = createMockAdapter(
        new Map([['skill:dev', mockBundle('dev')]])
      );
      const composite = new CompositeAdapter({ adapters: [failing, good] });

      expect(await composite.exists('skill', 'dev')).toBe(true);
    });

    it('returns false when all adapters fail', async () => {
      const f1 = createFailingAdapter('Fail1');
      const f2 = createFailingAdapter('Fail2');
      const composite = new CompositeAdapter({ adapters: [f1, f2] });

      expect(await composite.exists('skill', 'dev')).toBe(false);
    });
  });

  describe('write()', () => {
    it('delegates to first adapter by default', async () => {
      const writeSpy = vi.fn();
      const a1 = createMockAdapter(new Map());
      a1.write = writeSpy;
      const a2 = createMockAdapter(new Map());

      const composite = new CompositeAdapter({ adapters: [a1, a2] });
      const bundle = mockBundle('new-skill');
      await composite.write('skill', 'new-skill', bundle);

      expect(writeSpy).toHaveBeenCalledOnce();
      expect(writeSpy).toHaveBeenCalledWith('skill', 'new-skill', bundle);
    });

    it('delegates to designated writable adapter', async () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();
      const a1 = createMockAdapter(new Map());
      a1.write = spy1;
      const a2 = createMockAdapter(new Map());
      a2.write = spy2;

      const composite = new CompositeAdapter({
        adapters: [a1, a2],
        writableIndex: 1,
      });
      const bundle = mockBundle('new-skill');
      await composite.write('skill', 'new-skill', bundle);

      expect(spy1).not.toHaveBeenCalled();
      expect(spy2).toHaveBeenCalledOnce();
    });
  });
});
