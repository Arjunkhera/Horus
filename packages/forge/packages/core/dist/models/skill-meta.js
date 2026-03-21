"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemVerRangeSchema = exports.SemVerSchema = exports.SkillMetaSchema = void 0;
const zod_1 = require("zod");
const SemVerSchema = zod_1.z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/, 'Must be a valid semver string (e.g., 1.0.0)');
exports.SemVerSchema = SemVerSchema;
const SemVerRangeSchema = zod_1.z.string(); // e.g., ^1.0.0, ~2.1, >=1.0.0
exports.SemVerRangeSchema = SemVerRangeSchema;
/**
 * Schema for metadata.yaml — describes a Forge skill artifact.
 * @example
 * const meta = SkillMetaSchema.parse({
 *   id: 'developer',
 *   name: 'Developer Skill',
 *   version: '1.0.0',
 *   description: 'Implements stories',
 *   type: 'skill',
 *   tags: ['development', 'sdlc']
 * });
 */
exports.SkillMetaSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
    name: zod_1.z.string().min(1),
    version: SemVerSchema,
    description: zod_1.z.string().min(1),
    type: zod_1.z.literal('skill'),
    author: zod_1.z.string().optional(),
    license: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    dependencies: zod_1.z.record(zod_1.z.string(), SemVerRangeSchema).default({}),
    files: zod_1.z.array(zod_1.z.string()).default([]),
    homepage: zod_1.z.string().url().optional(),
    repository: zod_1.z.string().optional(),
});
//# sourceMappingURL=skill-meta.js.map