import { z } from 'zod';

export const RepoIndexEntrySchema = z.object({
  name: z.string(),
  localPath: z.string(),
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string(),
  language: z.string().nullable(),
  framework: z.string().nullable(),
  lastCommitDate: z.string(),   // ISO date string
  lastScannedAt: z.string(),    // ISO date string
});

export const RepoIndexSchema = z.object({
  version: z.literal('1'),
  scannedAt: z.string(),
  scanPaths: z.array(z.string()),
  repos: z.array(RepoIndexEntrySchema),
});

export type RepoIndexEntry = z.infer<typeof RepoIndexEntrySchema>;
export type RepoIndex = z.infer<typeof RepoIndexSchema>;
