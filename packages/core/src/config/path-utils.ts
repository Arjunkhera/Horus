import os from 'os';
import path from 'path';

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
export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    const homeDir = os.homedir();
    return p === '~' ? homeDir : path.join(homeDir, p.slice(2));
  }
  return p;
}

/**
 * Expand multiple paths with ~ to the user's home directory.
 *
 * @param paths - Array of paths to expand.
 * @returns Array of expanded paths.
 */
export function expandPaths(paths: string[]): string[] {
  return paths.map(expandPath);
}
