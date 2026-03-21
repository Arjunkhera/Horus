"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentMetaSchema = void 0;
const zod_1 = require("zod");
const skill_meta_js_1 = require("./skill-meta.js");
/**
 * Schema for agent.yaml — describes a Forge agent artifact.
 * @example
 * const meta = AgentMetaSchema.parse({
 *   id: 'sdlc-agent',
 *   name: 'SDLC Agent',
 *   version: '1.0.0',
 *   description: 'Manages software development lifecycle',
 *   type: 'agent',
 *   rootSkill: 'orchestrator'
 * });
 */
exports.AgentMetaSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
    name: zod_1.z.string().min(1),
    version: skill_meta_js_1.SemVerSchema,
    description: zod_1.z.string().min(1),
    type: zod_1.z.literal('agent'),
    rootSkill: zod_1.z.string().min(1),
    author: zod_1.z.string().optional(),
    license: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    skills: zod_1.z.array(zod_1.z.string()).default([]),
    dependencies: zod_1.z.record(zod_1.z.string(), skill_meta_js_1.SemVerRangeSchema).default({}),
    homepage: zod_1.z.string().url().optional(),
    repository: zod_1.z.string().optional(),
});
//# sourceMappingURL=agent-meta.js.map