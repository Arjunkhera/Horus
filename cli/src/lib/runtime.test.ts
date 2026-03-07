import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing runtime to intercept all calls
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { detectRuntime } from './runtime.js';

const mockExeca = vi.mocked(execa);

// Helper to create a mock execa result
function mockResult(exitCode: number) {
  return { exitCode, stdout: '', stderr: '' } as any;
}

// Helper to make execa throw (simulates binary not in PATH)
function mockNotFound() {
  const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tryCommand behaviour (tested via detectRuntime) ──────────────────────────

describe('detectRuntime — tryCommand exit code check', () => {
  it('accepts a runtime when compose version exits 0', async () => {
    mockExeca.mockResolvedValue(mockResult(0));
    const rt = await detectRuntime('docker');
    expect(rt.name).toBe('docker');
  });

  it('rejects a runtime when compose version exits non-zero (core bug fix)', async () => {
    // All compose version probes fail with exit 125 (Podman no-provider scenario)
    // commandExists('podman') also fails (throw ENOENT) so we get the generic error
    mockExeca.mockRejectedValue(mockNotFound());
    await expect(detectRuntime('podman')).rejects.toThrow();
  });

  it('falls through to auto-detect when preferred runtime compose fails', async () => {
    // preferred=podman compose fails, then docker compose succeeds
    mockExeca
      .mockResolvedValueOnce(mockResult(125)) // podman compose version → fail
      .mockResolvedValueOnce(mockResult(0))   // docker compose version → ok
      .mockResolvedValueOnce(mockResult(0));  // docker --version (commandExists)
    const rt = await detectRuntime('podman');
    expect(rt.name).toBe('docker');
  });
});

// ── Auto-detection order ─────────────────────────────────────────────────────

describe('detectRuntime — auto-detection', () => {
  it('prefers Docker when both runtimes are available', async () => {
    mockExeca.mockResolvedValue(mockResult(0)); // all succeed
    const rt = await detectRuntime();
    expect(rt.name).toBe('docker');
  });

  it('falls back to Podman when Docker compose is not available', async () => {
    mockExeca
      .mockResolvedValueOnce(mockResult(1))  // docker compose version → fail
      .mockResolvedValueOnce(mockResult(0)); // podman compose version → ok
    const rt = await detectRuntime();
    expect(rt.name).toBe('podman');
  });
});

// ── Error messages ───────────────────────────────────────────────────────────

describe('detectRuntime — error messages', () => {
  it('throws Podman-specific error when podman binary exists but compose fails', async () => {
    mockExeca
      .mockResolvedValueOnce(mockResult(125)) // docker compose version → fail
      .mockResolvedValueOnce(mockResult(125)) // podman compose version → fail
      .mockResolvedValueOnce(mockResult(0));  // podman --version → binary exists
    let err!: Error;
    await detectRuntime().catch((e: Error) => { err = e; });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('podman compose` is not working');
    expect(err.message).toContain('podman machine start');
    expect(err.message).toContain('pip3 install podman-compose');
  });

  it('throws generic error when no runtime binary is found', async () => {
    mockExeca
      .mockResolvedValueOnce(mockResult(1))   // docker compose version → fail
      .mockResolvedValueOnce(mockResult(1))   // podman compose version → fail
      .mockRejectedValueOnce(mockNotFound()); // podman --version → ENOENT
    await expect(detectRuntime()).rejects.toThrow('No container runtime found');
  });

  it('generic error includes Docker and Podman install instructions', async () => {
    mockExeca
      .mockResolvedValueOnce(mockResult(1))
      .mockResolvedValueOnce(mockResult(1))
      .mockRejectedValueOnce(mockNotFound());
    let err!: Error;
    await detectRuntime().catch((e: Error) => { err = e; });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Docker Desktop');
    expect(err.message).toContain('Podman Desktop');
  });
});

// ── Regression: Docker runtime behaviour unchanged ───────────────────────────

describe('detectRuntime — Docker regression', () => {
  it('returns docker runtime when docker compose version succeeds', async () => {
    mockExeca.mockResolvedValue(mockResult(0));
    const rt = await detectRuntime('docker');
    expect(rt.name).toBe('docker');
  });

  it('docker runtime exposes compose method', async () => {
    mockExeca.mockResolvedValue(mockResult(0));
    const rt = await detectRuntime('docker');
    expect(typeof rt.compose).toBe('function');
    expect(typeof rt.isRunning).toBe('function');
  });
});
