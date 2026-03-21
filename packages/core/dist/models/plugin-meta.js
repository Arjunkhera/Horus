"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginMetaSchema = void 0;
const zod_1 = require("zod");
const skill_meta_js_1 = require("./skill-meta.js");
/**
 * Schema for plugin.yaml — describes a Forge plugin bundle artifact.
 * @example
 * const meta = PluginMetaSchema.parse({
 *   id: 'anvil-sdlc',
 *   name: 'Anvil SDLC Plugin',
 *   version: '1.0.0',
 *   description: 'Software development lifecycle tools',
 *   type: 'plugin',
 *   skills: ['developer', 'tester'],
 *   agents: ['sdlc-agent']
 * });
 */
exports.PluginMetaSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
    name: zod_1.z.string().min(1),
    version: skill_meta_js_1.SemVerSchema,
    description: zod_1.z.string().min(1),
    type: zod_1.z.literal('plugin'),
    author: zod_1.z.string().optional(),
    license: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    skills: zod_1.z.array(zod_1.z.string()).default([]),
    agents: zod_1.z.array(zod_1.z.string()).default([]),
    homepage: zod_1.z.string().url().optional(),
    repository: zod_1.z.string().optional(),
});
//# sourceMappingURL=plugin-meta.js.map