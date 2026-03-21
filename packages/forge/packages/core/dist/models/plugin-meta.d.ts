import { z } from 'zod';
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
export declare const PluginMetaSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    type: z.ZodLiteral<"plugin">;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    skills: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    agents: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    homepage: z.ZodOptional<z.ZodString>;
    repository: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "plugin";
    tags: string[];
    skills: string[];
    agents: string[];
    author?: string | undefined;
    license?: string | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
}, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "plugin";
    author?: string | undefined;
    license?: string | undefined;
    tags?: string[] | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
    skills?: string[] | undefined;
    agents?: string[] | undefined;
}>;
export type PluginMeta = z.infer<typeof PluginMetaSchema>;
//# sourceMappingURL=plugin-meta.d.ts.map