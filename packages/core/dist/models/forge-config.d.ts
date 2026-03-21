import { z } from 'zod';
/**
 * Discriminated union of all registry types.
 */
export declare const RegistryConfigSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"filesystem">;
    name: z.ZodString;
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: "filesystem";
    path: string;
}, {
    name: string;
    type: "filesystem";
    path: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"git">;
    name: z.ZodString;
    url: z.ZodString;
    branch: z.ZodDefault<z.ZodString>;
    path: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: "git";
    path: string;
    url: string;
    branch: string;
}, {
    name: string;
    type: "git";
    url: string;
    path?: string | undefined;
    branch?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"http">;
    name: z.ZodString;
    url: z.ZodString;
    token: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: "http";
    url: string;
    token?: string | undefined;
}, {
    name: string;
    type: "http";
    url: string;
    token?: string | undefined;
}>]>;
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
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
export declare const ForgeConfigSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    target: z.ZodDefault<z.ZodEnum<["claude-code", "cursor", "plugin"]>>;
    registries: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"filesystem">;
        name: z.ZodString;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "filesystem";
        path: string;
    }, {
        name: string;
        type: "filesystem";
        path: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"git">;
        name: z.ZodString;
        url: z.ZodString;
        branch: z.ZodDefault<z.ZodString>;
        path: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "git";
        path: string;
        url: string;
        branch: string;
    }, {
        name: string;
        type: "git";
        url: string;
        path?: string | undefined;
        branch?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"http">;
        name: z.ZodString;
        url: z.ZodString;
        token: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    }, {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    }>]>, "many">>;
    artifacts: z.ZodDefault<z.ZodObject<{
        skills: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        agents: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        plugins: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        'workspace-configs': z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        skills: Record<string, string>;
        agents: Record<string, string>;
        plugins: Record<string, string>;
        'workspace-configs': Record<string, string>;
    }, {
        skills?: Record<string, string> | undefined;
        agents?: Record<string, string> | undefined;
        plugins?: Record<string, string> | undefined;
        'workspace-configs'?: Record<string, string> | undefined;
    }>>;
    outputDir: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: string;
    target: "plugin" | "claude-code" | "cursor";
    registries: ({
        name: string;
        type: "filesystem";
        path: string;
    } | {
        name: string;
        type: "git";
        path: string;
        url: string;
        branch: string;
    } | {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    })[];
    artifacts: {
        skills: Record<string, string>;
        agents: Record<string, string>;
        plugins: Record<string, string>;
        'workspace-configs': Record<string, string>;
    };
    outputDir: string;
}, {
    name: string;
    version?: string | undefined;
    target?: "plugin" | "claude-code" | "cursor" | undefined;
    registries?: ({
        name: string;
        type: "filesystem";
        path: string;
    } | {
        name: string;
        type: "git";
        url: string;
        path?: string | undefined;
        branch?: string | undefined;
    } | {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    })[] | undefined;
    artifacts?: {
        skills?: Record<string, string> | undefined;
        agents?: Record<string, string> | undefined;
        plugins?: Record<string, string> | undefined;
        'workspace-configs'?: Record<string, string> | undefined;
    } | undefined;
    outputDir?: string | undefined;
}>;
export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
export type Target = z.infer<typeof ForgeConfigSchema>['target'];
//# sourceMappingURL=forge-config.d.ts.map