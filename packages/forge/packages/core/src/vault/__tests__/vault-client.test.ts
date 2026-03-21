import { describe, it, expect } from 'vitest';
import { extractHostingFromUrl } from '../vault-client.js';

describe('extractHostingFromUrl', () => {
  it('extracts hostname and org from HTTPS URL', () => {
    const result = extractHostingFromUrl('https://github.com/Arjunkhera/Vault.git');
    expect(result).toEqual({ hostname: 'github.com', org: 'Arjunkhera' });
  });

  it('extracts hostname and org from SSH URL', () => {
    const result = extractHostingFromUrl('git@github.com:Arjunkhera/Vault.git');
    expect(result).toEqual({ hostname: 'github.com', org: 'Arjunkhera' });
  });

  it('extracts enterprise GitHub hostname from HTTPS URL', () => {
    const result = extractHostingFromUrl('https://github.corp.acme.com/platform-team/my-service.git');
    expect(result).toEqual({ hostname: 'github.corp.acme.com', org: 'platform-team' });
  });

  it('extracts enterprise GitHub hostname from SSH URL', () => {
    const result = extractHostingFromUrl('git@github.corp.acme.com:platform-team/my-service.git');
    expect(result).toEqual({ hostname: 'github.corp.acme.com', org: 'platform-team' });
  });

  it('returns defaults for null remote URL', () => {
    const result = extractHostingFromUrl(null);
    expect(result).toEqual({ hostname: 'github.com', org: '' });
  });

  it('returns defaults for unrecognised URL format', () => {
    const result = extractHostingFromUrl('not-a-url');
    expect(result).toEqual({ hostname: 'github.com', org: '' });
  });
});
