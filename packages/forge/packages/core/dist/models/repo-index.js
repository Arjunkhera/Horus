"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoIndexSchema = exports.RepoIndexEntrySchema = void 0;
const zod_1 = require("zod");
exports.RepoIndexEntrySchema = zod_1.z.object({
    name: zod_1.z.string(),
    localPath: zod_1.z.string(),
    remoteUrl: zod_1.z.string().nullable(),
    defaultBranch: zod_1.z.string(),
    language: zod_1.z.string().nullable(),
    framework: zod_1.z.string().nullable(),
    lastCommitDate: zod_1.z.string(), // ISO date string
    lastScannedAt: zod_1.z.string(), // ISO date string
});
exports.RepoIndexSchema = zod_1.z.object({
    version: zod_1.z.literal('1'),
    scannedAt: zod_1.z.string(),
    scanPaths: zod_1.z.array(zod_1.z.string()),
    repos: zod_1.z.array(exports.RepoIndexEntrySchema),
});
//# sourceMappingURL=repo-index.js.map