/**
 * Set a nested value in an object using dot notation.
 * Creates missing intermediate objects and handles array notation.
 *
 * @param obj - The object to modify
 * @param dotPath - Dot notation path (e.g., "workspace.mount_path")
 * @param value - The value to set (will be parsed as number, boolean, or string)
 * @example
 * setNestedValue({}, "workspace.mount_path", "~/my-workspaces")
 * // => { workspace: { mount_path: "~/my-workspaces" } }
 *
 * setNestedValue({}, "repos.scan_paths", "~/Repos,~/Projects")
 * // => { repos: { scan_paths: ["~/Repos", "~/Projects"] } }
 */
export function setNestedValue(obj: any, dotPath: string, value: string): void {
  const parts = dotPath.split('.');
  let current = obj;

  // Navigate/create the path up to the last key
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastKey = parts[parts.length - 1]!;

  // Parse the value based on context
  const parsedValue = parseValue(value);
  current[lastKey] = parsedValue;
}

/**
 * Parse a string value into appropriate type.
 * - Handles comma-separated values as arrays
 * - Converts "true"/"false" to booleans
 * - Converts numeric strings to numbers
 * - Returns strings as-is
 */
function parseValue(value: string): any {
  // Check for comma-separated array
  if (value.includes(',')) {
    return value.split(',').map(v => v.trim());
  }

  // Check for boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Check for number
  const numValue = Number(value);
  if (!isNaN(numValue) && value !== '') {
    return numValue;
  }

  // Default to string
  return value;
}

/**
 * Get a nested value from an object using dot notation.
 */
export function getNestedValue(obj: any, dotPath: string): any {
  const parts = dotPath.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
