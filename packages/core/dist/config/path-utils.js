"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandPath = expandPath;
exports.expandPaths = expandPaths;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
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
function expandPath(p) {
    if (p.startsWith('~/') || p === '~') {
        const homeDir = os_1.default.homedir();
        return p === '~' ? homeDir : path_1.default.join(homeDir, p.slice(2));
    }
    return p;
}
/**
 * Expand multiple paths with ~ to the user's home directory.
 *
 * @param paths - Array of paths to expand.
 * @returns Array of expanded paths.
 */
function expandPaths(paths) {
    return paths.map(expandPath);
}
//# sourceMappingURL=path-utils.js.map