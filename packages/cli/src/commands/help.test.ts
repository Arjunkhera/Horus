import { describe, it, expect } from 'vitest';
import { helpCommand } from './help.js';

describe('helpCommand', () => {
  it('is a commander command named "help"', () => {
    expect(helpCommand.name()).toBe('help');
  });

  it('has a description mentioning guides', () => {
    expect(helpCommand.description().toLowerCase()).toContain('guide');
  });

  it('accepts a variadic query argument', () => {
    // Commander 12 exposes args via `registeredArguments`
    const args = (helpCommand as unknown as { registeredArguments: Array<{ variadic: boolean; name(): string }> })
      .registeredArguments;
    expect(args).toBeDefined();
    expect(args.length).toBe(1);
    expect(args[0].variadic).toBe(true);
    expect(args[0].name()).toBe('query');
  });
});
