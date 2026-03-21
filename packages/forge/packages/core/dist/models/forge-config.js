"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgeConfigSchema = exports.RegistryConfigSchema = void 0;
const zod_1 = require("zod");
const FilesystemRegistrySchema = zod_1.z.object({
    type: zod_1.z.literal('filesystem'),
    name: zod_1.z.string().min(1),
    path: zod_1.z.string().min(1),
});
const GitRegistrySchema = zod_1.z.object({
    type: zod_1.z.literal('git'),
    name: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
    branch: zod_1.z.string().default('main'),
    path: zod_1.z.string().default('registry'),
});
const HttpRegistrySchema = zod_1.z.object({
    type: zod_1.z.literal('http'),
    name: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
    token: zod_1.z.string().optional(),
});
/**
 * Discriminated union of all registry types.
 */
exports.RegistryConfigSchema = zod_1.z.discriminatedUnion('type', [
    FilesystemRegistrySchema,
    GitRegistrySchema,
    HttpRegistrySchema,
]);
/**
 * Schema for forge.yaml — the workspace configuration file.
 * @example
 * const config = ForgeConfigSchema.parse({
 *   name: 'my-workspace',
 *   version: '0.1.0',
 *   target: 'claude-code',
 *   registries: [{ type: 'filesystem', name: 'local', path: './registry' }],
 *   artifacts: {}
 * });
 */
exports.ForgeConfigSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    version: zod_1.z.string().default('0.1.0'),
    target: zod_1.z.enum(['claude-code', 'cursor', 'plugin']).default('claude-code'),
    registries: zod_1.z.array(exports.RegistryConfigSchema).default([]),
    artifacts: zod_1.z.object({
        skills: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
        agents: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
        plugins: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
        'workspace-configs': zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
    }).default({}),
    outputDir: zod_1.z.string().default('.'),
});
//# sourceMappingURL=forge-config.js.map