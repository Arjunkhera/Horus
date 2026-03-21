"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const composite_adapter_js_1 = require("../composite-adapter.js");
const errors_js_1 = require("../errors.js");
// ---------------------------------------------------------------------------
// Helpers — mock adapters
// ---------------------------------------------------------------------------
function mockMeta(id, type = 'skill') {
    return {
        id,
        name: `${id} name`,
        version: '1.0.0',
        description: `The ${id} artifact`,
        type,
        tags: [],
        dependencies: {},
        files: [],
    };
}
function mockBundle(id, type = 'skill') {
    return {
        meta: mockMeta(id, type),
        content: `# ${id}\nContent for ${id}`,
        contentPath: 'SKILL.md',
    };
}
function createMockAdapter(artifacts, name = 'MockAdapter') {
    const adapter = {
        async list(type) {
            const results = [];
            for (const bundle of artifacts.values()) {
                if (bundle.meta.type === type)
                    results.push(bundle.meta);
            }
            return results;
        },
        async read(type, id) {
            const bundle = artifacts.get(`${type}:${id}`);
            if (!bundle)
                throw new Error(`Not found: ${type}:${id}`);
            return bundle;
        },
        async exists(type, id) {
            return artifacts.has(`${type}:${id}`);
        },
        async write(_type, _id, _bundle) {
            // no-op for mock
        },
    };
    // Give the mock adapter a recognisable name for error messages
    Object.defineProperty(adapter.constructor, 'name', { value: name });
    return adapter;
}
function createFailingAdapter(adapterName = 'FailingAdapter') {
    // Create a unique class per name so constructor.name is distinct
    class NamedFailingAdapter {
        async list() {
            throw new Error(`${adapterName} list failure`);
        }
        async read() {
            throw new Error(`${adapterName} read failure`);
        }
        async exists() {
            throw new Error(`${adapterName} exists failure`);
        }
        async write() {
            throw new Error(`${adapterName} write failure`);
        }
    }
    Object.defineProperty(NamedFailingAdapter, 'name', { value: adapterName });
    return new NamedFailingAdapter();
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('CompositeAdapter', () => {
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('requires at least one adapter', () => {
            (0, vitest_1.expect)(() => new composite_adapter_js_1.CompositeAdapter({ adapters: [] })).toThrow('CompositeAdapter requires at least one adapter');
        });
        (0, vitest_1.it)('rejects out-of-bounds writableIndex', () => {
            const adapter = createMockAdapter(new Map());
            (0, vitest_1.expect)(() => new composite_adapter_js_1.CompositeAdapter({ adapters: [adapter], writableIndex: 5 })).toThrow('writableIndex 5 is out of bounds');
        });
        (0, vitest_1.it)('accepts valid writableIndex', () => {
            const a1 = createMockAdapter(new Map());
            const a2 = createMockAdapter(new Map());
            (0, vitest_1.expect)(() => new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2], writableIndex: 1 })).not.toThrow();
        });
    });
    (0, vitest_1.describe)('list()', () => {
        (0, vitest_1.it)('merges results from all adapters', async () => {
            const a1 = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const a2 = createMockAdapter(new Map([['skill:test', mockBundle('test')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            const results = await composite.list('skill');
            const ids = results.map((r) => r.id);
            (0, vitest_1.expect)(ids).toContain('dev');
            (0, vitest_1.expect)(ids).toContain('test');
            (0, vitest_1.expect)(results).toHaveLength(2);
        });
        (0, vitest_1.it)('deduplicates by id — higher priority adapter wins', async () => {
            const highPriBundle = mockBundle('shared');
            highPriBundle.meta = {
                ...highPriBundle.meta,
                description: 'from-high-priority',
            };
            const lowPriBundle = mockBundle('shared');
            lowPriBundle.meta = {
                ...lowPriBundle.meta,
                description: 'from-low-priority',
            };
            const a1 = createMockAdapter(new Map([['skill:shared', highPriBundle]]));
            const a2 = createMockAdapter(new Map([['skill:shared', lowPriBundle]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            const results = await composite.list('skill');
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].description).toBe('from-high-priority');
        });
        (0, vitest_1.it)('skips failing adapter and returns results from others', async () => {
            const failing = createFailingAdapter('BadAdapter');
            const good = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [failing, good] });
            const results = await composite.list('skill');
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].id).toBe('dev');
        });
        (0, vitest_1.it)('returns empty array when all adapters fail', async () => {
            const f1 = createFailingAdapter('Fail1');
            const f2 = createFailingAdapter('Fail2');
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [f1, f2] });
            const results = await composite.list('skill');
            (0, vitest_1.expect)(results).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('read()', () => {
        (0, vitest_1.it)('returns from first adapter that has the artifact', async () => {
            const a1 = createMockAdapter(new Map()); // empty
            const a2 = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            const result = await composite.read('skill', 'dev');
            (0, vitest_1.expect)(result.meta.id).toBe('dev');
        });
        (0, vitest_1.it)('returns from higher priority adapter when both have artifact', async () => {
            const highPri = mockBundle('dev');
            highPri.content = 'high-priority-content';
            const lowPri = mockBundle('dev');
            lowPri.content = 'low-priority-content';
            const a1 = createMockAdapter(new Map([['skill:dev', highPri]]));
            const a2 = createMockAdapter(new Map([['skill:dev', lowPri]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            const result = await composite.read('skill', 'dev');
            (0, vitest_1.expect)(result.content).toBe('high-priority-content');
        });
        (0, vitest_1.it)('skips failing adapter and reads from next', async () => {
            const failing = createFailingAdapter('BadAdapter');
            const good = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [failing, good] });
            const result = await composite.read('skill', 'dev');
            (0, vitest_1.expect)(result.meta.id).toBe('dev');
        });
        (0, vitest_1.it)('throws AllAdaptersFailedError when all adapters fail', async () => {
            const f1 = createFailingAdapter('Fail1');
            const f2 = createFailingAdapter('Fail2');
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [f1, f2] });
            await (0, vitest_1.expect)(composite.read('skill', 'missing')).rejects.toThrow(errors_js_1.AllAdaptersFailedError);
        });
        (0, vitest_1.it)('AllAdaptersFailedError includes sources tried', async () => {
            const f1 = createFailingAdapter('Fail1');
            const f2 = createFailingAdapter('Fail2');
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [f1, f2] });
            try {
                await composite.read('skill', 'missing');
                vitest_1.expect.fail('Should have thrown');
            }
            catch (err) {
                (0, vitest_1.expect)(err.message).toContain('Fail1');
                (0, vitest_1.expect)(err.message).toContain('Fail2');
            }
        });
    });
    (0, vitest_1.describe)('exists()', () => {
        (0, vitest_1.it)('returns true when first adapter has it', async () => {
            const a1 = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const a2 = createMockAdapter(new Map());
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            (0, vitest_1.expect)(await composite.exists('skill', 'dev')).toBe(true);
        });
        (0, vitest_1.it)('returns true when only later adapter has it', async () => {
            const a1 = createMockAdapter(new Map());
            const a2 = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            (0, vitest_1.expect)(await composite.exists('skill', 'dev')).toBe(true);
        });
        (0, vitest_1.it)('returns false when no adapter has it', async () => {
            const a1 = createMockAdapter(new Map());
            const a2 = createMockAdapter(new Map());
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            (0, vitest_1.expect)(await composite.exists('skill', 'missing')).toBe(false);
        });
        (0, vitest_1.it)('skips failing adapter and checks next', async () => {
            const failing = createFailingAdapter('BadAdapter');
            const good = createMockAdapter(new Map([['skill:dev', mockBundle('dev')]]));
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [failing, good] });
            (0, vitest_1.expect)(await composite.exists('skill', 'dev')).toBe(true);
        });
        (0, vitest_1.it)('returns false when all adapters fail', async () => {
            const f1 = createFailingAdapter('Fail1');
            const f2 = createFailingAdapter('Fail2');
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [f1, f2] });
            (0, vitest_1.expect)(await composite.exists('skill', 'dev')).toBe(false);
        });
    });
    (0, vitest_1.describe)('write()', () => {
        (0, vitest_1.it)('delegates to first adapter by default', async () => {
            const writeSpy = vitest_1.vi.fn();
            const a1 = createMockAdapter(new Map());
            a1.write = writeSpy;
            const a2 = createMockAdapter(new Map());
            const composite = new composite_adapter_js_1.CompositeAdapter({ adapters: [a1, a2] });
            const bundle = mockBundle('new-skill');
            await composite.write('skill', 'new-skill', bundle);
            (0, vitest_1.expect)(writeSpy).toHaveBeenCalledOnce();
            (0, vitest_1.expect)(writeSpy).toHaveBeenCalledWith('skill', 'new-skill', bundle);
        });
        (0, vitest_1.it)('delegates to designated writable adapter', async () => {
            const spy1 = vitest_1.vi.fn();
            const spy2 = vitest_1.vi.fn();
            const a1 = createMockAdapter(new Map());
            a1.write = spy1;
            const a2 = createMockAdapter(new Map());
            a2.write = spy2;
            const composite = new composite_adapter_js_1.CompositeAdapter({
                adapters: [a1, a2],
                writableIndex: 1,
            });
            const bundle = mockBundle('new-skill');
            await composite.write('skill', 'new-skill', bundle);
            (0, vitest_1.expect)(spy1).not.toHaveBeenCalled();
            (0, vitest_1.expect)(spy2).toHaveBeenCalledOnce();
        });
    });
});
//# sourceMappingURL=composite-adapter.test.js.map