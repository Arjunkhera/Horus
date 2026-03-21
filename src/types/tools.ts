// Zod schemas for all MCP tool inputs and outputs.
// These provide both TypeScript types (via z.infer) and runtime validation.

import { z } from 'zod';

// ─── Shared sub-schemas ────────────────────────────────────────────────────

const DateRangeSchema = z.object({
  gte: z.string().optional(),
  lte: z.string().optional(),
});

const ScopeFilterSchema = z.object({
  context: z.enum(['personal', 'work']).optional(),
  team: z.string().optional(),
  service: z.string().optional(),
});

const OrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

const FiltersSchema = z.object({
  query: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  tags: z.array(z.string()).optional(),
  due: DateRangeSchema.optional(),
  created: DateRangeSchema.optional(),
  modified: DateRangeSchema.optional(),
  assignee: z.string().optional(),
  project: z.string().optional(),
  scope: ScopeFilterSchema.optional(),
  archived: z.boolean().optional(),
});

// ─── anvil_create_note ─────────────────────────────────────────────────────

export const CreateNoteInputSchema = z.object({
  type: z.string().describe('Note type (e.g., task, note, journal, story)'),
  title: z.string().min(1).max(300).describe('Note title'),
  content: z.string().optional().describe('Optional markdown body content'),
  fields: z.record(z.unknown()).optional().describe('Type-specific frontmatter fields to set'),
  use_template: z
    .boolean()
    .default(true)
    .optional()
    .describe('Apply the type body template (default: true). Frontmatter defaults always apply.'),
});

export const CreateNoteOutputSchema = z.object({
  noteId: z.string(),
  filePath: z.string(),
  title: z.string(),
  type: z.string(),
});

// ─── anvil_get_note ────────────────────────────────────────────────────────

export const GetNoteInputSchema = z.object({
  noteId: z.string().describe('UUID of the note to retrieve'),
});

// ─── anvil_update_note ─────────────────────────────────────────────────────

export const UpdateNoteInputSchema = z.object({
  noteId: z.string().describe('UUID of the note to update'),
  fields: z
    .record(z.unknown())
    .optional()
    .describe('Fields to update (PATCH semantics — omitted fields are preserved)'),
  content: z
    .string()
    .optional()
    .describe(
      'New body content. For append_only types (journal), appends to body. Otherwise replaces.',
    ),
});

export const UpdateNoteOutputSchema = z.object({
  noteId: z.string(),
  updatedFields: z.array(z.string()),
});

// ─── anvil_search ──────────────────────────────────────────────────────────

export const SearchInputSchema = z.object({
  query: z.string().optional().describe('Free-text search query (supports FTS5 syntax)'),
  type: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  tags: z.array(z.string()).optional().describe('Notes must have ALL specified tags (AND)'),
  due: DateRangeSchema.optional().describe('Due date range filter (ISO date strings)'),
  assignee: z.string().optional(),
  project: z.string().optional(),
  scope: ScopeFilterSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// ─── anvil_query_view ──────────────────────────────────────────────────────

export const QueryViewInputSchema = z.object({
  view: z.enum(['list', 'table', 'board']).describe('View type to render'),
  filters: FiltersSchema.optional(),
  groupBy: z
    .string()
    .optional()
    .describe('Field to group by — required for board view'),
  orderBy: OrderBySchema.optional(),
  columns: z.array(z.string()).optional().describe('Column names for table view'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// ─── anvil_list_types ──────────────────────────────────────────────────────

export const ListTypesInputSchema = z.object({});

// ─── anvil_get_related ─────────────────────────────────────────────────────

export const GetRelatedInputSchema = z.object({
  noteId: z.string().describe('UUID of the note to get relationships for'),
});

// ─── anvil_sync_pull ───────────────────────────────────────────────────────

export const SyncPullInputSchema = z.object({
  remote: z.string().default('origin').optional().describe('Git remote name (default: origin)'),
  branch: z.string().optional().describe('Branch to pull (default: current branch)'),
});

// ─── anvil_sync_push ───────────────────────────────────────────────────────

export const SyncPushInputSchema = z.object({
  message: z.string().min(1).describe('Git commit message for the push'),
});

// ─── Inferred TypeScript types ─────────────────────────────────────────────

export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>;
export type CreateNoteOutput = z.infer<typeof CreateNoteOutputSchema>;
export type GetNoteInput = z.infer<typeof GetNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>;
export type UpdateNoteOutput = z.infer<typeof UpdateNoteOutputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
export type QueryViewInput = z.infer<typeof QueryViewInputSchema>;
export type ListTypesInput = z.infer<typeof ListTypesInputSchema>;
export type GetRelatedInput = z.infer<typeof GetRelatedInputSchema>;
export type SyncPullInput = z.infer<typeof SyncPullInputSchema>;
export type SyncPushInput = z.infer<typeof SyncPushInputSchema>;

// ─── Output schemas for sync operations ─────────────────────────────────────

export const SyncPullOutputSchema = z.union([
  z.object({
    status: z.literal('ok'),
    filesChanged: z.number(),
    conflicts: z.array(z.object({ filePath: z.string(), type: z.literal('merge_conflict') })),
  }),
  z.object({
    status: z.literal('conflict'),
    conflicts: z.array(z.object({ filePath: z.string(), type: z.literal('merge_conflict') })),
  }),
  z.object({
    status: z.literal('no_changes'),
  }),
]);

export const SyncPushOutputSchema = z.union([
  z.object({
    status: z.literal('ok'),
    filesCommitted: z.number(),
    commitHash: z.string(),
  }),
  z.object({
    status: z.literal('no_changes'),
  }),
  z.object({
    status: z.literal('push_failed'),
    message: z.string(),
  }),
]);

export type SyncPullOutput = z.infer<typeof SyncPullOutputSchema>;
export type SyncPushOutput = z.infer<typeof SyncPushOutputSchema>;
