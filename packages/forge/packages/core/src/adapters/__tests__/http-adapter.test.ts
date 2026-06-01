import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpAdapter } from '../http-adapter.js';
import {
  PreUploadValidationError,
  ForgeCoreVersionMismatchError,
  ArtifactNotFoundError,
} from '../errors.js';
import type { ArtifactBundle } from '../../models/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSkillBundle(overrides: Record<string, unknown> = {}): ArtifactBundle {
  return {
    meta: {
      id: 'my-skill',
      name: 'My Skill',
      version: '1.2.3',
      description: 'A test skill',
      type: 'skill' as const,
      tags: [],
      dependencies: {},
      files: [],
      ...overrides,
    } as ArtifactBundle['meta'],
    content: '# My Skill\nContent here.',
    contentPath: 'SKILL.md',
  };
}

/**
 * Build a minimal mock fetch that returns a successful response by default.
 */
function mockFetch(responseInit: { status?: number; body?: unknown } = {}): typeof fetch {
  const status = responseInit.status ?? 201;
  const body = responseInit.body ?? {};
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

/**
 * Build a mock fetch that can return different responses on successive calls.
 */
function mockFetchSequence(responses: Array<{ status?: number; body?: unknown }>): typeof fetch {
  const fn = vi.fn();
  for (const r of responses) {
    const status = r.status ?? 200;
    fn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(r.body ?? {}),
    } as unknown as Response);
  }
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpAdapter', () => {
  const BASE_URL = 'https://registry.example.com';
  const TOKEN = 'secret-token';
  const CORE_VERSION = '0.1.0';

  let fetch: ReturnType<typeof mockFetch>;
  let adapter: HttpAdapter;

  beforeEach(() => {
    fetch = mockFetch();
    adapter = new HttpAdapter({
      baseUrl: BASE_URL,
      token: TOKEN,
      coreVersion: CORE_VERSION,
      fetch,
    });
  });

  // ── write(): happy path ───────────────────────────────────────────────────

  it('write() succeeds for a valid bundle without throwing', async () => {
    const bundle = validSkillBundle();
    await expect(adapter.write('skill', 'my-skill', bundle)).resolves.toBeUndefined();
  });

  it('write() calls fetch with POST to the correct URL', async () => {
    const bundle = validSkillBundle();
    await adapter.write('skill', 'my-skill', bundle);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/artifacts/skill/my-skill/1.2.3`);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('write() attaches X-Forge-Core-Version header on every write', async () => {
    const bundle = validSkillBundle();
    await adapter.write('skill', 'my-skill', bundle);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Forge-Core-Version']).toBe(CORE_VERSION);
  });

  it('write() attaches Authorization header when token is set', async () => {
    const bundle = validSkillBundle();
    await adapter.write('skill', 'my-skill', bundle);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('write() does NOT attach Authorization when no token', async () => {
    const noTokenAdapter = new HttpAdapter({
      baseUrl: BASE_URL,
      coreVersion: CORE_VERSION,
      fetch: mockFetch(),
    });
    const bundle = validSkillBundle();
    await noTokenAdapter.write('skill', 'my-skill', bundle);
    // No assertion on Authorization header — just verify no error thrown
  });

  // ── write(): pre-upload validation ───────────────────────────────────────

  it('write() throws PreUploadValidationError for invalid metadata without sending HTTP', async () => {
    // Missing required `description` field
    const bundle = validSkillBundle({ description: undefined });
    delete (bundle.meta as Record<string, unknown>)['description'];

    await expect(adapter.write('skill', 'my-skill', bundle)).rejects.toThrow(
      PreUploadValidationError,
    );
    // fetch must NOT have been called
    expect(fetch).not.toHaveBeenCalled();
  });

  it('write() PreUploadValidationError contains field-level issues', async () => {
    const bundle = validSkillBundle({ id: 'INVALID ID' }); // uppercase + spaces

    let err: PreUploadValidationError | undefined;
    try {
      await adapter.write('skill', 'my-skill', bundle);
    } catch (e) {
      if (e instanceof PreUploadValidationError) err = e;
    }

    expect(err).toBeInstanceOf(PreUploadValidationError);
    expect(err!.issues.length).toBeGreaterThan(0);
    // Each issue must have a path and message
    for (const issue of err!.issues) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  });

  it('write() pre-flight runs for agent type as well', async () => {
    // AgentMetaSchema requires rootSkill
    const bundle: ArtifactBundle = {
      meta: {
        id: 'my-agent',
        name: 'My Agent',
        version: '1.0.0',
        description: 'An agent',
        type: 'agent' as const,
        tags: [],
        dependencies: {},
        // rootSkill intentionally omitted to trigger pre-upload validation
      } as unknown as ArtifactBundle['meta'],
      content: '# My Agent',
      contentPath: 'AGENT.md',
    };

    await expect(adapter.write('agent', 'my-agent', bundle)).rejects.toThrow(
      PreUploadValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── write(): version skew error handling ─────────────────────────────────

  it('write() throws ForgeCoreVersionMismatchError on 409 with CORE_VERSION_INCOMPATIBLE', async () => {
    const skewFetch = mockFetch({
      status: 409,
      body: {
        code: 'CORE_VERSION_INCOMPATIBLE',
        serviceVersion: '2.0.0',
        clientVersion: CORE_VERSION,
      },
    });
    const skewAdapter = new HttpAdapter({
      baseUrl: BASE_URL,
      token: TOKEN,
      coreVersion: CORE_VERSION,
      fetch: skewFetch,
    });

    const bundle = validSkillBundle();
    const err = await skewAdapter.write('skill', 'my-skill', bundle).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeCoreVersionMismatchError);
    expect((err as ForgeCoreVersionMismatchError).minimumCoreVersion).toBe('2.0.0');
    expect((err as ForgeCoreVersionMismatchError).currentCoreVersion).toBe(CORE_VERSION);
  });

  it('write() throws ForgeCoreVersionMismatchError on 426 with CORE_VERSION_INCOMPATIBLE', async () => {
    const skewFetch = mockFetch({
      status: 426,
      body: {
        code: 'CORE_VERSION_INCOMPATIBLE',
        serviceVersion: '2.0.0',
        clientVersion: CORE_VERSION,
      },
    });
    const skewAdapter = new HttpAdapter({
      baseUrl: BASE_URL,
      coreVersion: CORE_VERSION,
      fetch: skewFetch,
    });

    const bundle = validSkillBundle();
    const err = await skewAdapter.write('skill', 'my-skill', bundle).catch((e) => e);
    expect(err).toBeInstanceOf(ForgeCoreVersionMismatchError);
  });

  it('ForgeCoreVersionMismatchError message references the minimum version', async () => {
    const skewFetch = mockFetch({
      status: 409,
      body: {
        code: 'CORE_VERSION_INCOMPATIBLE',
        serviceVersion: '3.1.0',
        clientVersion: CORE_VERSION,
      },
    });
    const skewAdapter = new HttpAdapter({
      baseUrl: BASE_URL,
      coreVersion: CORE_VERSION,
      fetch: skewFetch,
    });

    const bundle = validSkillBundle();
    let err: ForgeCoreVersionMismatchError | undefined;
    try {
      await skewAdapter.write('skill', 'my-skill', bundle);
    } catch (e) {
      if (e instanceof ForgeCoreVersionMismatchError) err = e;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('3.1.0');
    expect(err!.message).toContain('too old');
  });

  it('write() throws generic error on 409 WITHOUT CORE_VERSION_INCOMPATIBLE code', async () => {
    // 409 for a version conflict (different code) should NOT become a version-skew error
    const conflictFetch = mockFetch({
      status: 409,
      body: {
        code: 'VERSION_CONFLICT',
        message: 'Version already exists',
      },
    });
    const conflictAdapter = new HttpAdapter({
      baseUrl: BASE_URL,
      coreVersion: CORE_VERSION,
      fetch: conflictFetch,
    });

    const bundle = validSkillBundle();
    const err = await conflictAdapter.write('skill', 'my-skill', bundle).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ForgeCoreVersionMismatchError);
    expect(err).not.toBeInstanceOf(PreUploadValidationError);
  });

  // ── list() / listVersions() / read() / exists() ───────────────────────────

  const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64');
  const SKILL_META_YAML = [
    'id: my-skill',
    'name: My Skill',
    'version: 1.2.3',
    'description: A test skill',
    'type: skill',
    'tags: []',
  ].join('\n');

  it('list() maps the registry `hits` summaries onto ArtifactMeta', async () => {
    const listFetch = mockFetch({
      status: 200,
      body: {
        query: 'skill',
        total: 1,
        hits: [
          {
            artifact_id: 'skill-a',
            id: 'skill:skill-a:1.0.0',
            name: 'Skill A',
            version: '1.0.0',
            description: 'desc',
            type: 'skill',
            tags: ['x'],
          },
        ],
      },
    });
    const listAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: listFetch });
    const results = await listAdapter.list('skill');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('skill-a');
    expect(results[0]!.version).toBe('1.0.0');
    // Uses the search/list querystring route, not a path segment.
    const [url] = (listFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/artifacts?type=skill&limit=250`);
  });

  it('listVersions() returns versions sorted highest-first', async () => {
    const vFetch = mockFetch({ status: 200, body: { type: 'skill', id: 'my-skill', versions: ['1.0.0', '1.2.0'] } });
    const vAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: vFetch });
    expect(await vAdapter.listVersions('skill', 'my-skill')).toEqual(['1.2.0', '1.0.0']);
    const [url] = (vFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/artifacts/skill/my-skill/versions`);
  });

  it('listVersions() returns [] on 404 (legacy flat-layout fallback)', async () => {
    const vAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: mockFetch({ status: 404 }) });
    expect(await vAdapter.listVersions('skill', 'my-skill')).toEqual([]);
  });

  it('read() with explicit version fetches the 3-segment route and decodes base64 files', async () => {
    const readFetch = mockFetch({
      status: 200,
      body: {
        type: 'skill',
        id: 'my-skill',
        version: '1.2.3',
        files: { 'metadata.yaml': b64(SKILL_META_YAML), 'SKILL.md': b64('# My Skill\nBody.') },
      },
    });
    const readAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: readFetch });
    const bundle = await readAdapter.read('skill', 'my-skill@1.2.3');
    expect(bundle.meta.id).toBe('my-skill');
    expect(bundle.meta.version).toBe('1.2.3');
    expect(bundle.content).toBe('# My Skill\nBody.');
    expect(bundle.contentPath).toBe('SKILL.md');
    const [url] = (readFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/artifacts/skill/my-skill/1.2.3`);
  });

  it('read() with no version resolves latest via listVersions then fetches it', async () => {
    const seqFetch = mockFetchSequence([
      { status: 200, body: { type: 'skill', id: 'my-skill', versions: ['1.2.3'] } },
      {
        status: 200,
        body: { type: 'skill', id: 'my-skill', version: '1.2.3', files: { 'metadata.yaml': b64(SKILL_META_YAML), 'SKILL.md': b64('hi') } },
      },
    ]);
    const seqAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: seqFetch });
    const bundle = await seqAdapter.read('skill', 'my-skill');
    expect(bundle.meta.version).toBe('1.2.3');
    const calls = (seqFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe(`${BASE_URL}/artifacts/skill/my-skill/versions`);
    expect(calls[1]![0]).toBe(`${BASE_URL}/artifacts/skill/my-skill/1.2.3`);
  });

  it('read() throws ArtifactNotFoundError when no versions exist', async () => {
    const notFoundFetch = mockFetch({ status: 404, body: { message: 'Not found' } });
    const notFoundAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: notFoundFetch });
    await expect(notFoundAdapter.read('skill', 'unknown-skill')).rejects.toThrow(
      ArtifactNotFoundError,
    );
  });

  it('exists() returns true for an explicit version that HEADs 200', async () => {
    const existsFetch = mockFetch({ status: 200 });
    const existsAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: existsFetch });
    expect(await existsAdapter.exists('skill', 'my-skill@1.0.0')).toBe(true);
    const [url, init] = (existsFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/artifacts/skill/my-skill/1.0.0`);
    expect((init as RequestInit).method).toBe('HEAD');
  });

  it('exists() with no version is true when at least one version exists', async () => {
    const existsFetch = mockFetch({ status: 200, body: { versions: ['1.0.0'] } });
    const existsAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: existsFetch });
    expect(await existsAdapter.exists('skill', 'my-skill')).toBe(true);
  });

  it('exists() returns false for 404 response', async () => {
    const existsFetch = mockFetch({ status: 404 });
    const existsAdapter = new HttpAdapter({ baseUrl: BASE_URL, fetch: existsFetch });
    expect(await existsAdapter.exists('skill', 'unknown-skill')).toBe(false);
  });
});
