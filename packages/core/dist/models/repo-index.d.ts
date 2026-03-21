import { z } from 'zod';
export declare const RepoIndexEntrySchema: z.ZodObject<{
    name: z.ZodString;
    localPath: z.ZodString;
    remoteUrl: z.ZodNullable<z.ZodString>;
    defaultBranch: z.ZodString;
    language: z.ZodNullable<z.ZodString>;
    framework: z.ZodNullable<z.ZodString>;
    lastCommitDate: z.ZodString;
    lastScannedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    localPath: string;
    remoteUrl: string | null;
    defaultBranch: string;
    language: string | null;
    framework: string | null;
    lastCommitDate: string;
    lastScannedAt: string;
}, {
    name: string;
    localPath: string;
    remoteUrl: string | null;
    defaultBranch: string;
    language: string | null;
    framework: string | null;
    lastCommitDate: string;
    lastScannedAt: string;
}>;
export declare const RepoIndexSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    scannedAt: z.ZodString;
    scanPaths: z.ZodArray<z.ZodString, "many">;
    repos: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        localPath: z.ZodString;
        remoteUrl: z.ZodNullable<z.ZodString>;
        defaultBranch: z.ZodString;
        language: z.ZodNullable<z.ZodString>;
        framework: z.ZodNullable<z.ZodString>;
        lastCommitDate: z.ZodString;
        lastScannedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
    }, {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: "1";
    repos: {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
    }[];
    scannedAt: string;
    scanPaths: string[];
}, {
    version: "1";
    repos: {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
    }[];
    scannedAt: string;
    scanPaths: string[];
}>;
export type RepoIndexEntry = z.infer<typeof RepoIndexEntrySchema>;
export type RepoIndex = z.infer<typeof RepoIndexSchema>;
//# sourceMappingURL=repo-index.d.ts.map