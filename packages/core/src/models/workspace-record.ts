import { z } from 'zod';

export const WorkspaceStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const WorkspaceRepoSchema = z.object({
  name: z.string(),
  localPath: z.string(),
  branch: z.string(),
  worktreePath: z.string().nullable(),
});

export const WorkspaceRecordSchema = z.object({
  id: z.string(),                    // "ws-{8chars}"
  name: z.string(),
  configRef: z.string(),             // "sdlc-default@1.0.0"
  storyId: z.string().nullable(),
  storyTitle: z.string().nullable(),
  path: z.string(),                  // absolute path to workspace folder
  status: WorkspaceStatusSchema,
  repos: z.array(WorkspaceRepoSchema),
  createdAt: z.string(),             // ISO datetime
  lastAccessedAt: z.string(),        // ISO datetime
  completedAt: z.string().nullable(),
});

export const WorkspaceStoreSchema = z.object({
  version: z.literal('1'),
  workspaces: z.record(z.string(), WorkspaceRecordSchema),
});

export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;
export type WorkspaceStore = z.infer<typeof WorkspaceStoreSchema>;
