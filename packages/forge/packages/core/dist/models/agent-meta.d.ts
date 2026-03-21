import { z } from 'zod';
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
export declare const AgentMetaSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    type: z.ZodLiteral<"agent">;
    rootSkill: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    skills: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dependencies: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    homepage: z.ZodOptional<z.ZodString>;
    repository: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "agent";
    tags: string[];
    dependencies: Record<string, string>;
    rootSkill: string;
    skills: string[];
    author?: string | undefined;
    license?: string | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
}, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "agent";
    rootSkill: string;
    author?: string | undefined;
    license?: string | undefined;
    tags?: string[] | undefined;
    dependencies?: Record<string, string> | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
    skills?: string[] | undefined;
}>;
export type AgentMeta = z.infer<typeof AgentMetaSchema>;
//# sourceMappingURL=agent-meta.d.ts.map