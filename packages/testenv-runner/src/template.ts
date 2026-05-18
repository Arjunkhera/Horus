/**
 * Template variable substitution.
 *
 * Supports: {slot}, {workdir}, {src}, {profile}, and any custom key.
 * Unknown variables are left as-is (for forward-compatibility with new vars).
 */

export interface TemplateContext {
  slot?: string;
  workdir?: string;
  src?: string;
  profile?: string;
  [key: string]: string | undefined;
}

/**
 * Substitute {var} placeholders in a string using the provided context.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const val = ctx[key];
    return val !== undefined ? val : match; // leave unknown vars as-is
  });
}

/**
 * Recursively expand {var} placeholders in string values within an args record.
 * Non-string values are passed through unchanged.
 */
export function templateExpandArgs(
  args: Record<string, unknown>,
  ctx: TemplateContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      result[key] = renderTemplate(value, ctx);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = templateExpandArgs(value as Record<string, unknown>, ctx);
    } else {
      result[key] = value;
    }
  }
  return result;
}
