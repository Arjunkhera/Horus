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
