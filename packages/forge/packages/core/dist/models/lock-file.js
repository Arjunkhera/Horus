"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockFileSchema = exports.LockedArtifactSchema = void 0;
const zod_1 = require("zod");
/**
 * A single locked artifact entry in forge.lock.
 */
exports.LockedArtifactSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.enum(['skill', 'agent', 'plugin']),
    version: zod_1.z.string(),
    registry: zod_1.z.string(),
    sha256: zod_1.z.string().regex(/^[a-f0-9]{64}$/, 'Must be a valid SHA-256 hex string'),
    files: zod_1.z.array(zod_1.z.string()).default([]),
    resolvedAt: zod_1.z.string().datetime(),
});
/**
 * Schema for forge.lock — the lockfile tracking installed artifacts.
 * @example
 * const lock = LockFileSchema.parse({
 *   version: '1',
 *   lockedAt: new Date().toISOString(),
 *   artifacts: {}
 * });
 */
exports.LockFileSchema = zod_1.z.object({
    version: zod_1.z.literal('1').default('1'),
    lockedAt: zod_1.z.string().datetime(),
    artifacts: zod_1.z.record(zod_1.z.string(), exports.LockedArtifactSchema).default({}),
});
//# sourceMappingURL=lock-file.js.map