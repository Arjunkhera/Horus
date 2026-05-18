import { describe, it, expect } from 'vitest';
import {
  HostSchema,
  CredentialSchema,
  WorkflowSchema,
  VaultScopeSchema,
  RepoMetadataSchema,
  CreateRepoInputSchema,
  PatchRepoInputSchema,
} from '../src/types/repo-metadata.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validCreateInput() {
  return { org: 'acme', name: 'my-repo', canonicalUrl: 'git@github.com:acme/my-repo.git' };
}

function validMetadata() {
  return {
    org: 'acme',
    name: 'my-repo',
    canonicalUrl: 'git@github.com:acme/my-repo.git',
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// HostSchema
// ---------------------------------------------------------------------------

describe('HostSchema', () => {
  it('accepts valid github host', () => {
    const result = HostSchema.parse({ url: 'https://github.com', provider: 'github' });
    expect(result.provider).toBe('github');
  });

  it('accepts all providers', () => {
    for (const provider of ['github', 'gitlab', 'bitbucket', 'other'] as const) {
      expect(() => HostSchema.parse({ url: 'https://example.com', provider })).not.toThrow();
    }
  });

  it('accepts optional apiUrl as valid URL', () => {
    const result = HostSchema.parse({
      url: 'https://github.example.com',
      provider: 'other',
      apiUrl: 'https://api.github.example.com',
    });
    expect(result.apiUrl).toBe('https://api.github.example.com');
  });

  it('rejects invalid apiUrl', () => {
    expect(() =>
      HostSchema.parse({ url: 'https://x.com', provider: 'github', apiUrl: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects unknown provider', () => {
    expect(() => HostSchema.parse({ url: 'https://x.com', provider: 'unknown' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CredentialSchema
// ---------------------------------------------------------------------------

describe('CredentialSchema', () => {
  const types = ['ssh-host', 'gh-cli', 'token-env', 'git-credential', 'mcp-tool'] as const;

  it('validates all 5 credential types', () => {
    for (const type of types) {
      expect(() => CredentialSchema.parse({ type, label: `my ${type}` })).not.toThrow();
    }
  });

  it('accepts optional mcpServer for mcp-tool', () => {
    const result = CredentialSchema.parse({
      type: 'mcp-tool',
      label: 'my mcp',
      mcpServer: 'github-mcp',
    });
    expect(result.mcpServer).toBe('github-mcp');
  });

  it('rejects unknown credential type', () => {
    expect(() => CredentialSchema.parse({ type: 'oauth', label: 'x' })).toThrow();
  });

  it('rejects missing label', () => {
    expect(() => CredentialSchema.parse({ type: 'gh-cli' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkflowSchema
// ---------------------------------------------------------------------------

describe('WorkflowSchema', () => {
  function base(type: 'owner' | 'fork' | 'contributor') {
    return {
      type,
      pushTo: 'origin',
      prTarget: { repo: 'acme/my-repo', branch: 'main' },
    };
  }

  it('validates all 3 workflow types', () => {
    for (const type of ['owner', 'fork', 'contributor'] as const) {
      expect(() => WorkflowSchema.parse(base(type))).not.toThrow();
    }
  });

  it('accepts optional fields', () => {
    const result = WorkflowSchema.parse({
      ...base('fork'),
      branchPattern: 'feat/{id}',
      commitFormat: 'conventional',
      mergeStrategy: 'squash',
      hooks: { 'pre-push': 'npm test' },
    });
    expect(result.mergeStrategy).toBe('squash');
    expect(result.hooks).toEqual({ 'pre-push': 'npm test' });
  });

  it('rejects invalid mergeStrategy', () => {
    expect(() => WorkflowSchema.parse({ ...base('owner'), mergeStrategy: 'fast-forward' })).toThrow();
  });

  it('rejects missing prTarget', () => {
    expect(() => WorkflowSchema.parse({ type: 'owner', pushTo: 'origin' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VaultScopeSchema
// ---------------------------------------------------------------------------

describe('VaultScopeSchema', () => {
  it('accepts required repo', () => {
    expect(() => VaultScopeSchema.parse({ repo: 'horus' })).not.toThrow();
  });

  it('accepts optional program', () => {
    const result = VaultScopeSchema.parse({ repo: 'horus', program: 'forge-v3' });
    expect(result.program).toBe('forge-v3');
  });

  it('rejects missing repo', () => {
    expect(() => VaultScopeSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RepoMetadataSchema
// ---------------------------------------------------------------------------

describe('RepoMetadataSchema', () => {
  it('accepts minimal valid metadata', () => {
    const result = RepoMetadataSchema.parse(validMetadata());
    expect(result.org).toBe('acme');
  });

  it('accepts full metadata with all sub-schemas', () => {
    const full = {
      ...validMetadata(),
      host: { url: 'https://github.com', provider: 'github' },
      credential: { type: 'gh-cli', label: 'gh' },
      workflow: { type: 'owner', pushTo: 'origin', prTarget: { repo: 'acme/r', branch: 'main' } },
      vaultScope: { repo: 'horus' },
      description: 'A test repo',
      topics: ['typescript', 'testing'],
      language: 'TypeScript',
      defaultBranch: 'main',
      isPrivate: false,
      isFork: false,
      stars: 42,
      lastPushedAt: '2024-06-01T00:00:00.000Z',
      extra: { custom: true },
    };
    expect(() => RepoMetadataSchema.parse(full)).not.toThrow();
  });

  it('rejects empty org', () => {
    expect(() => RepoMetadataSchema.parse({ ...validMetadata(), org: '' })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => RepoMetadataSchema.parse({ ...validMetadata(), name: '' })).toThrow();
  });

  it('rejects invalid registeredAt datetime', () => {
    expect(() =>
      RepoMetadataSchema.parse({ ...validMetadata(), registeredAt: 'not-a-date' }),
    ).toThrow();
  });

  it('rejects negative stars', () => {
    expect(() => RepoMetadataSchema.parse({ ...validMetadata(), stars: -1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CreateRepoInputSchema
// ---------------------------------------------------------------------------

describe('CreateRepoInputSchema', () => {
  it('parses minimal required fields', () => {
    const result = CreateRepoInputSchema.parse(validCreateInput());
    expect(result.org).toBe('acme');
    expect(result.name).toBe('my-repo');
    expect(result.canonicalUrl).toBe('git@github.com:acme/my-repo.git');
  });

  it('throws on empty input', () => {
    expect(() => CreateRepoInputSchema.parse({})).toThrow();
  });

  it('throws on missing canonicalUrl', () => {
    expect(() => CreateRepoInputSchema.parse({ org: 'x', name: 'y' })).toThrow();
  });

  it('accepts optional fields alongside required', () => {
    const result = CreateRepoInputSchema.parse({
      ...validCreateInput(),
      description: 'hello',
      language: 'Go',
      workflow: { type: 'owner', pushTo: 'origin', prTarget: { repo: 'x/y', branch: 'main' } },
    });
    expect(result.description).toBe('hello');
  });

  it('does not allow registeredAt (server-set)', () => {
    // registeredAt is omitted from CreateRepoInputSchema — extra fields are stripped by Zod
    const result = CreateRepoInputSchema.parse({
      ...validCreateInput(),
      registeredAt: '2024-01-01T00:00:00.000Z',
    });
    expect((result as Record<string, unknown>)['registeredAt']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PatchRepoInputSchema
// ---------------------------------------------------------------------------

describe('PatchRepoInputSchema', () => {
  it('accepts empty patch', () => {
    expect(() => PatchRepoInputSchema.parse({})).not.toThrow();
  });

  it('accepts partial update', () => {
    const result = PatchRepoInputSchema.parse({ description: 'updated', language: 'Rust' });
    expect(result.description).toBe('updated');
  });

  it('does not allow org (identity field)', () => {
    const result = PatchRepoInputSchema.parse({ org: 'acme', description: 'x' });
    expect((result as Record<string, unknown>)['org']).toBeUndefined();
  });

  it('does not allow updatedAt (server-set)', () => {
    const result = PatchRepoInputSchema.parse({ updatedAt: '2024-01-01T00:00:00.000Z' });
    expect((result as Record<string, unknown>)['updatedAt']).toBeUndefined();
  });
});
