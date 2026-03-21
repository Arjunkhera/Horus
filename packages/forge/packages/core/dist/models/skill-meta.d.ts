import { z } from 'zod';
declare const SemVerSchema: z.ZodString;
declare const SemVerRangeSchema: z.ZodString;
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
export declare const SkillMetaSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    type: z.ZodLiteral<"skill">;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dependencies: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    files: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    homepage: z.ZodOptional<z.ZodString>;
    repository: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "skill";
    tags: string[];
    dependencies: Record<string, string>;
    files: string[];
    author?: string | undefined;
    license?: string | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
}, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "skill";
    author?: string | undefined;
    license?: string | undefined;
    tags?: string[] | undefined;
    dependencies?: Record<string, string> | undefined;
    files?: string[] | undefined;
    homepage?: string | undefined;
    repository?: string | undefined;
}>;
export type SkillMeta = z.infer<typeof SkillMetaSchema>;
export { SemVerSchema, SemVerRangeSchema };
//# sourceMappingURL=skill-meta.d.ts.map