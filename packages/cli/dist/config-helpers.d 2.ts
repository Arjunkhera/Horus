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
export declare function setNestedValue(obj: any, dotPath: string, value: string): void;
/**
 * Get a nested value from an object using dot notation.
 */
export declare function getNestedValue(obj: any, dotPath: string): any;
//# sourceMappingURL=config-helpers.d.ts.map