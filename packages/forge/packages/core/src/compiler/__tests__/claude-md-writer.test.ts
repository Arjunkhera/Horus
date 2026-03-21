import { describe, it, expect } from 'vitest';
import { upsertManagedSection, removeManagedSection } from '../claude-md-writer.js';

describe('upsertManagedSection', () => {
  it('inserts into empty/undefined content', () => {
    const result = upsertManagedSection(undefined, 'horus-core', '# Rules');
    expect(result).toBe(
      '<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n'
    );
  });

  it('inserts into empty string', () => {
    const result = upsertManagedSection('', 'horus-core', '# Rules');
    expect(result).toBe(
      '<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n'
    );
  });

  it('appends to existing content', () => {
    const existing = '# My CLAUDE.md\n\nSome existing content.\n';
    const result = upsertManagedSection(existing, 'horus-core', '# Rules');
    expect(result).toContain('# My CLAUDE.md');
    expect(result).toContain('<!-- forge:global:horus-core:start -->');
    expect(result).toContain('# Rules');
    expect(result).toContain('<!-- forge:global:horus-core:end -->');
  });

  it('appends to existing content without trailing newline', () => {
    const existing = '# My CLAUDE.md';
    const result = upsertManagedSection(existing, 'horus-core', '# Rules');
    expect(result).toContain('# My CLAUDE.md');
    expect(result).toContain('<!-- forge:global:horus-core:start -->');
  });

  it('replaces existing fenced section', () => {
    const existing = [
      '# My CLAUDE.md',
      '',
      '<!-- forge:global:horus-core:start -->',
      '# Old Rules',
      '<!-- forge:global:horus-core:end -->',
      '',
      'Other content.',
    ].join('\n');

    const result = upsertManagedSection(existing, 'horus-core', '# New Rules');
    expect(result).toContain('# New Rules');
    expect(result).not.toContain('# Old Rules');
    expect(result).toContain('Other content.');
  });

  it('handles multiple plugin sections independently', () => {
    let content = upsertManagedSection('', 'plugin-a', 'A rules');
    content = upsertManagedSection(content, 'plugin-b', 'B rules');
    expect(content).toContain('<!-- forge:global:plugin-a:start -->');
    expect(content).toContain('A rules');
    expect(content).toContain('<!-- forge:global:plugin-b:start -->');
    expect(content).toContain('B rules');
  });

  it('is idempotent (same content produces same result)', () => {
    const first = upsertManagedSection('', 'horus-core', '# Rules');
    const second = upsertManagedSection(first, 'horus-core', '# Rules');
    expect(second).toBe(first);
  });
});

describe('removeManagedSection', () => {
  it('removes an existing fenced section', () => {
    const content = [
      '# My CLAUDE.md',
      '',
      '<!-- forge:global:horus-core:start -->',
      '# Rules',
      '<!-- forge:global:horus-core:end -->',
      '',
      'Other content.',
    ].join('\n');

    const result = removeManagedSection(content, 'horus-core');
    expect(result).not.toContain('<!-- forge:global:horus-core:start -->');
    expect(result).not.toContain('# Rules');
    expect(result).toContain('# My CLAUDE.md');
    expect(result).toContain('Other content.');
  });

  it('returns content as-is when section not found', () => {
    const content = '# My CLAUDE.md\n';
    const result = removeManagedSection(content, 'nonexistent');
    expect(result).toBe('# My CLAUDE.md\n');
  });

  it('returns empty string when removing the only section', () => {
    const content = '<!-- forge:global:horus-core:start -->\n# Rules\n<!-- forge:global:horus-core:end -->\n';
    const result = removeManagedSection(content, 'horus-core');
    expect(result).toBe('');
  });

  it('preserves other plugin sections when removing one', () => {
    let content = upsertManagedSection('', 'plugin-a', 'A rules');
    content = upsertManagedSection(content, 'plugin-b', 'B rules');
    const result = removeManagedSection(content, 'plugin-a');
    expect(result).not.toContain('A rules');
    expect(result).toContain('B rules');
  });
});
