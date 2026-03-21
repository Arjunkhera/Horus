/**
 * Expand a path with ~ to the user's home directory.
 * Absolute paths are returned unchanged.
 * Relative paths without ~ are returned unchanged.
 *
 * @param p - The path to expand.
 * @returns The expanded path.
 * @example
 * expandPath('~/Documents') // => '/home/user/Documents'
 * expandPath('/absolute/path') // => '/absolute/path'
 * expandPath('relative/path') // => 'relative/path'
 */
export declare function expandPath(p: string): string;
/**
 * Expand multiple paths with ~ to the user's home directory.
 *
 * @param paths - Array of paths to expand.
 * @returns Array of expanded paths.
 */
export declare function expandPaths(paths: string[]): string[];
//# sourceMappingURL=path-utils.d.ts.map