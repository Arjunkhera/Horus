import { z } from 'zod';
export declare const WorkspaceStatusSchema: z.ZodEnum<["active", "paused", "completed", "archived"]>;
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
export declare const WorkspaceRepoSchema: z.ZodObject<{
    name: z.ZodString;
    localPath: z.ZodString;
    branch: z.ZodString;
    worktreePath: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    branch: string;
    localPath: string;
    worktreePath: string | null;
}, {
    name: string;
    branch: string;
    localPath: string;
    worktreePath: string | null;
}>;
export declare const WorkspaceRecordSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    configRef: z.ZodString;
    storyId: z.ZodNullable<z.ZodString>;
    storyTitle: z.ZodNullable<z.ZodString>;
    path: z.ZodString;
    status: z.ZodEnum<["active", "paused", "completed", "archived"]>;
    repos: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        localPath: z.ZodString;
        branch: z.ZodString;
        worktreePath: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        branch: string;
        localPath: string;
        worktreePath: string | null;
    }, {
        name: string;
        branch: string;
        localPath: string;
        worktreePath: string | null;
    }>, "many">;
    createdAt: z.ZodString;
    lastAccessedAt: z.ZodString;
    completedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    status: "active" | "paused" | "completed" | "archived";
    path: string;
    repos: {
        name: string;
        branch: string;
        localPath: string;
        worktreePath: string | null;
    }[];
    configRef: string;
    storyId: string | null;
    storyTitle: string | null;
    createdAt: string;
    lastAccessedAt: string;
    completedAt: string | null;
}, {
    id: string;
    name: string;
    status: "active" | "paused" | "completed" | "archived";
    path: string;
    repos: {
        name: string;
        branch: string;
        localPath: string;
        worktreePath: string | null;
    }[];
    configRef: string;
    storyId: string | null;
    storyTitle: string | null;
    createdAt: string;
    lastAccessedAt: string;
    completedAt: string | null;
}>;
export declare const WorkspaceStoreSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    workspaces: z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        configRef: z.ZodString;
        storyId: z.ZodNullable<z.ZodString>;
        storyTitle: z.ZodNullable<z.ZodString>;
        path: z.ZodString;
        status: z.ZodEnum<["active", "paused", "completed", "archived"]>;
        repos: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            localPath: z.ZodString;
            branch: z.ZodString;
            worktreePath: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }, {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }>, "many">;
        createdAt: z.ZodString;
        lastAccessedAt: z.ZodString;
        completedAt: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        status: "active" | "paused" | "completed" | "archived";
        path: string;
        repos: {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }[];
        configRef: string;
        storyId: string | null;
        storyTitle: string | null;
        createdAt: string;
        lastAccessedAt: string;
        completedAt: string | null;
    }, {
        id: string;
        name: string;
        status: "active" | "paused" | "completed" | "archived";
        path: string;
        repos: {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }[];
        configRef: string;
        storyId: string | null;
        storyTitle: string | null;
        createdAt: string;
        lastAccessedAt: string;
        completedAt: string | null;
    }>>;
}, "strip", z.ZodTypeAny, {
    version: "1";
    workspaces: Record<string, {
        id: string;
        name: string;
        status: "active" | "paused" | "completed" | "archived";
        path: string;
        repos: {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }[];
        configRef: string;
        storyId: string | null;
        storyTitle: string | null;
        createdAt: string;
        lastAccessedAt: string;
        completedAt: string | null;
    }>;
}, {
    version: "1";
    workspaces: Record<string, {
        id: string;
        name: string;
        status: "active" | "paused" | "completed" | "archived";
        path: string;
        repos: {
            name: string;
            branch: string;
            localPath: string;
            worktreePath: string | null;
        }[];
        configRef: string;
        storyId: string | null;
        storyTitle: string | null;
        createdAt: string;
        lastAccessedAt: string;
        completedAt: string | null;
    }>;
}>;
export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;
export type WorkspaceStore = z.infer<typeof WorkspaceStoreSchema>;
//# sourceMappingURL=workspace-record.d.ts.map