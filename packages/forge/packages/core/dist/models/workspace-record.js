"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceStoreSchema = exports.WorkspaceRecordSchema = exports.WorkspaceRepoSchema = exports.WorkspaceStatusSchema = void 0;
const zod_1 = require("zod");
exports.WorkspaceStatusSchema = zod_1.z.enum(['active', 'paused', 'completed', 'archived']);
exports.WorkspaceRepoSchema = zod_1.z.object({
    name: zod_1.z.string(),
    localPath: zod_1.z.string(),
    branch: zod_1.z.string(),
    worktreePath: zod_1.z.string().nullable(),
});
exports.WorkspaceRecordSchema = zod_1.z.object({
    id: zod_1.z.string(), // "ws-{8chars}"
    name: zod_1.z.string(),
    configRef: zod_1.z.string(), // "sdlc-default@1.0.0"
    storyId: zod_1.z.string().nullable(),
    storyTitle: zod_1.z.string().nullable(),
    path: zod_1.z.string(), // absolute path to workspace folder
    status: exports.WorkspaceStatusSchema,
    repos: zod_1.z.array(exports.WorkspaceRepoSchema),
    createdAt: zod_1.z.string(), // ISO datetime
    lastAccessedAt: zod_1.z.string(), // ISO datetime
    completedAt: zod_1.z.string().nullable(),
});
exports.WorkspaceStoreSchema = zod_1.z.object({
    version: zod_1.z.literal('1'),
    workspaces: zod_1.z.record(zod_1.z.string(), exports.WorkspaceRecordSchema),
});
//# sourceMappingURL=workspace-record.js.map