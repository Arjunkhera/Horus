import { z } from 'zod';
/**
 * A single locked artifact entry in forge.lock.
 */
export declare const LockedArtifactSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["skill", "agent", "plugin"]>;
    version: z.ZodString;
    registry: z.ZodString;
    sha256: z.ZodString;
    files: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    resolvedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    version: string;
    type: "skill" | "agent" | "plugin";
    files: string[];
    registry: string;
    sha256: string;
    resolvedAt: string;
}, {
    id: string;
    version: string;
    type: "skill" | "agent" | "plugin";
    registry: string;
    sha256: string;
    resolvedAt: string;
    files?: string[] | undefined;
}>;
/**
 * Schema for forge.lock — the lockfile tracking installed artifacts.
 * @example
 * const lock = LockFileSchema.parse({
 *   version: '1',
 *   lockedAt: new Date().toISOString(),
 *   artifacts: {}
 * });
 */
export declare const LockFileSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodLiteral<"1">>;
    lockedAt: z.ZodString;
    artifacts: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["skill", "agent", "plugin"]>;
        version: z.ZodString;
        registry: z.ZodString;
        sha256: z.ZodString;
        files: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        resolvedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        version: string;
        type: "skill" | "agent" | "plugin";
        files: string[];
        registry: string;
        sha256: string;
        resolvedAt: string;
    }, {
        id: string;
        version: string;
        type: "skill" | "agent" | "plugin";
        registry: string;
        sha256: string;
        resolvedAt: string;
        files?: string[] | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    artifacts: Record<string, {
        id: string;
        version: string;
        type: "skill" | "agent" | "plugin";
        files: string[];
        registry: string;
        sha256: string;
        resolvedAt: string;
    }>;
    lockedAt: string;
}, {
    lockedAt: string;
    version?: "1" | undefined;
    artifacts?: Record<string, {
        id: string;
        version: string;
        type: "skill" | "agent" | "plugin";
        registry: string;
        sha256: string;
        resolvedAt: string;
        files?: string[] | undefined;
    }> | undefined;
}>;
export type LockedArtifact = z.infer<typeof LockedArtifactSchema>;
export type LockFile = z.infer<typeof LockFileSchema>;
//# sourceMappingURL=lock-file.d.ts.map