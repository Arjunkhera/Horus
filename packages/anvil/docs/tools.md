# MCP Tools Reference

Anvil exposes 9 tools for managing your vault. Each tool is designed for a specific operation.

## Tool Naming Convention

All tools are prefixed with `anvil_` for clarity in MCP clients.

---

## 1. anvil_create_note

Create a new note in the vault with automatic ID generation and indexing.

**Input Schema**:
```typescript
{
  type: string;          // Type ID (e.g., 'task', 'note', 'project')
  title: string;         // Note title
  content?: string;      // Body content (markdown)
  fields?: Record<string, unknown>;  // Type-specific fields
  use_template?: boolean; // Use type's template body (default: true)
}
```

**Output Schema** (on success):
```typescript
{
  noteId: string;        // UUID
  filePath: string;      // Absolute path to created file
  title: string;
  type: string;
}
```

**Example Request**:
```json
{
  "type": "task",
  "title": "Implement user authentication",
  "fields": {
    "status": "open",
    "priority": "P1-high",
    "tags": ["backend", "security"]
  },
  "content": "Add JWT-based auth to API endpoints."
}
```

**Example Response**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001",
  "filePath": "/vault/tasks/implement-user-authentication.md",
  "title": "Implement user authentication",
  "type": "task"
}
```

**Error Cases**:
- `TYPE_NOT_FOUND`: Type doesn't exist in registry
- `VALIDATION_ERROR`: Fields don't match type schema
- `IO_ERROR`: Failed to write file

---

## 2. anvil_get_note

Retrieve a note by ID with full content and relationships.

**Input Schema**:
```typescript
{
  noteId: string;  // UUID of the note
}
```

**Output Schema** (on success):
```typescript
{
  noteId: string;
  type: string;
  title: string;
  created: string;      // ISO 8601 date
  modified: string;     // ISO 8601 date
  status?: string;      // If applicable
  priority?: string;    // If applicable
  due?: string;         // If applicable
  effort?: number;
  tags: string[];
  related: string[];
  scope?: Object;
  body: string;         // Full markdown content
  filePath: string;
  relationships: {
    forward: Relationship[];
    reverse: Relationship[];
  }
}
```

Where `Relationship` is:
```typescript
{
  relationType: string;  // 'mentions', 'related', 'assigned', etc.
  sourceId: string;      // ID of source note
  targetId: string | null;  // ID of target note (null if unresolved)
  targetTitle: string;   // Title of target note
}
```

**Example Request**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001"
}
```

**Example Response**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001",
  "type": "task",
  "title": "Implement user authentication",
  "status": "open",
  "priority": "P1-high",
  "tags": ["backend", "security"],
  "created": "2026-02-15T10:30:00Z",
  "modified": "2026-02-15T10:30:00Z",
  "body": "Add JWT-based auth to API endpoints.",
  "filePath": "/vault/tasks/implement-user-authentication.md",
  "relationships": {
    "forward": [
      {
        "relationType": "mentions",
        "sourceId": "550e8400-e29b-41d4-a716-446655440001",
        "targetId": "550e8400-e29b-41d4-a716-446655440005",
        "targetTitle": "Alice Smith"
      }
    ],
    "reverse": []
  }
}
```

**Error Cases**:
- `NOT_FOUND`: Note with given ID doesn't exist

---

## 3. anvil_update_note

Update note fields or content with PATCH semantics.

**Input Schema**:
```typescript
{
  noteId: string;
  fields?: Record<string, unknown>;  // Fields to update
  content?: string;                  // Body content (PATCH or APPEND)
}
```

**Output Schema** (on success):
```typescript
{
  noteId: string;
  title: string;
  type: string;
  modified: string;  // Updated timestamp
}
```

**Example Request**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001",
  "fields": {
    "status": "in-progress",
    "priority": "P1-high"
  },
  "content": "Making good progress on auth implementation."
}
```

**Example Response**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001",
  "title": "Implement user authentication",
  "type": "task",
  "modified": "2026-02-15T11:45:00Z"
}
```

**Behaviors**:
- **PATCH semantics**: Only provided fields are updated
- **append_only types**: Content is appended, not replaced
- **immutable fields**: Cannot be changed (e.g., `noteId`, `created`)
- **modified timestamp**: Always updated

**Error Cases**:
- `NOT_FOUND`: Note doesn't exist
- `VALIDATION_ERROR`: Updated fields don't match schema
- `IMMUTABLE_FIELD`: Cannot modify immutable field
- `APPEND_ONLY`: Type has append-only behavior
- `TYPE_NOT_FOUND`: Type definition doesn't exist

---

## 4. anvil_search

Full-text search across all notes with filtering.

**Input Schema**:
```typescript
{
  query?: string;  // Free-text search query
  filters?: {
    type?: string;
    status?: string | { not: string };
    priority?: string;
    tags?: string[];  // Match any
    due?: { gte?: string; lte?: string };  // Date range
    created?: { gte?: string; lte?: string };
    modified?: { gte?: string; lte?: string };
    assignee?: string;
    project?: string;
    scope?: {
      context?: 'personal' | 'work';
      team?: string;
      service?: string;
    };
    archived?: boolean;
  };
  limit?: number;  // Default: 50
  offset?: number; // Default: 0
}
```

**Output Schema** (on success):
```typescript
{
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}
```

Where `SearchResult` is:
```typescript
{
  noteId: string;
  type: string;
  title: string;
  status?: string;
  priority?: string;
  due?: string;
  modified: string;
  tags?: string[];
  excerpt?: string;  // Snippet around match
}
```

**Example Request**:
```json
{
  "query": "authentication",
  "filters": {
    "type": "task",
    "status": "open",
    "tags": ["backend"]
  },
  "limit": 10
}
```

**Example Response**:
```json
{
  "results": [
    {
      "noteId": "550e8400-e29b-41d4-a716-446655440001",
      "type": "task",
      "title": "Implement user authentication",
      "status": "open",
      "priority": "P1-high",
      "modified": "2026-02-15T10:30:00Z",
      "tags": ["backend", "security"],
      "excerpt": "...Add JWT-based **authentication** to API endpoints..."
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

**Error Cases**:
- `SERVER_ERROR`: Search failed

---

## 5. anvil_query_view

Create complex views of notes with filtering, grouping, and pagination.

**Input Schema**:
```typescript
{
  type: 'list' | 'table' | 'board';  // View type
  filters?: Record<string, unknown>;  // Same as search
  columns?: string[];  // For table/list views
  group_by?: string;   // For board view
  order_by?: string;   // Field to sort by
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
```

**Output Schema** (on success):
```typescript
{
  type: 'list' | 'table' | 'board';
  columns?: string[];
  rows: Array<Record<string, unknown>>;
  groups?: Record<string, Array<Record<string, unknown>>>;  // For board
  total?: number;
}
```

**Example Request (Board View)**:
```json
{
  "type": "board",
  "filters": { "type": "task" },
  "group_by": "status"
}
```

**Example Response**:
```json
{
  "type": "board",
  "groups": {
    "open": [
      {
        "noteId": "550e8400-e29b-41d4-a716-446655440001",
        "title": "Implement user authentication",
        "priority": "P1-high"
      }
    ],
    "in-progress": [],
    "done": []
  }
}
```

**Error Cases**:
- `VALIDATION_ERROR`: Invalid group_by field
- `SERVER_ERROR`: Query failed

---

## 6. anvil_list_types

List all available note types.

**Input Schema**:
```typescript
{}  // No parameters
```

**Output Schema** (on success):
```typescript
{
  types: TypeInfo[];
}
```

Where `TypeInfo` is:
```typescript
{
  id: string;
  name: string;
  description?: string;
  icon?: string;
  extends?: string;  // Parent type
  fields: Record<string, FieldInfo>;
  behaviors?: {
    append_only?: boolean;
  };
}
```

**Example Response**:
```json
{
  "types": [
    {
      "id": "task",
      "name": "Task",
      "description": "An actionable work item",
      "icon": "checkbox",
      "fields": {
        "status": {
          "type": "enum",
          "values": ["open", "in-progress", "done"],
          "required": true
        },
        "priority": {
          "type": "enum",
          "values": ["P0-critical", "P1-high", "P2-medium", "P3-low"]
        }
      }
    }
  ]
}
```

**Error Cases**:
- None (always succeeds)

---

## 7. anvil_get_related

Get relationships for a note grouped by relationship type.

**Input Schema**:
```typescript
{
  noteId: string;
}
```

**Output Schema** (on success):
```typescript
{
  noteId: string;
  title: string;
  type: string;
  forward: Record<string, RelatedEntry[]>;
  reverse: Record<string, RelatedEntry[]>;
}
```

Where `RelatedEntry` is:
```typescript
{
  noteId: string | null;  // null if unresolved
  title: string;
  type?: string;
  resolved: boolean;
}
```

**Example Response**:
```json
{
  "noteId": "550e8400-e29b-41d4-a716-446655440001",
  "title": "Implement user authentication",
  "type": "task",
  "forward": {
    "mentions": [
      {
        "noteId": "550e8400-e29b-41d4-a716-446655440005",
        "title": "Alice Smith",
        "type": "person",
        "resolved": true
      }
    ]
  },
  "reverse": {
    "related": [
      {
        "noteId": "550e8400-e29b-41d4-a716-446655440010",
        "title": "Website Redesign 2026",
        "type": "project",
        "resolved": true
      }
    ]
  }
}
```

**Error Cases**:
- `NOT_FOUND`: Note doesn't exist

---

## 8. anvil_sync_pull

Pull changes from remote git repository.

**Input Schema**:
```typescript
{
  message?: string;  // Commit message (if pulling creates merge)
}
```

**Output Schema** (on success):
```typescript
{
  pulled: boolean;
  message: string;
  changes?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}
```

**Example Response**:
```json
{
  "pulled": true,
  "message": "Successfully pulled from origin/main",
  "changes": {
    "added": ["tasks/new-task.md"],
    "modified": ["notes/architecture.md"],
    "deleted": []
  }
}
```

**Error Cases**:
- `NO_GIT_REPO`: Vault is not a git repository
- `NO_REMOTE`: No remote configured
- `SYNC_ERROR`: Git operation failed

---

## 9. anvil_sync_push

Push local changes to remote git repository.

**Input Schema**:
```typescript
{
  message?: string;  // Custom commit message
}
```

**Output Schema** (on success):
```typescript
{
  pushed: boolean;
  message: string;
  changes?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}
```

**Example Response**:
```json
{
  "pushed": true,
  "message": "Successfully pushed to origin/main",
  "changes": {
    "added": [],
    "modified": ["tasks/implement-auth.md"],
    "deleted": []
  }
}
```

**Error Cases**:
- `NO_GIT_REPO`: Vault is not a git repository
- `NO_REMOTE`: No remote configured
- `SYNC_ERROR`: Git operation failed

---

## Error Format

All errors follow this structure:

```typescript
{
  error: true;
  code: string;  // Error code (e.g., 'VALIDATION_ERROR')
  message: string;
  field?: string;         // Which field caused error (if applicable)
  allowed_values?: string[];  // For validation errors
  fields?: FieldError[];  // Multiple field errors
}
```

Where `FieldError` is:
```typescript
{
  field: string;
  message: string;
  allowed_values?: string[];
}
```

**Example Error Response**:
```json
{
  "error": true,
  "code": "VALIDATION_ERROR",
  "message": "Note validation failed",
  "fields": [
    {
      "field": "status",
      "message": "Invalid enum value",
      "allowed_values": ["open", "in-progress", "done"]
    }
  ]
}
```

---

## Common Patterns

### Creating a Task and Getting It Back
```
1. Call anvil_create_note with type='task'
2. Get noteId from response
3. Call anvil_get_note with the noteId
```

### Searching for Open Tasks
```
Call anvil_search with:
  - filters.type = 'task'
  - filters.status = 'open'
  - query = <search term>
```

### Creating a Board View
```
Call anvil_query_view with:
  - type = 'board'
  - group_by = 'status'
  - filters.type = 'task'
```

### Updating a Note Progressively
```
1. Call anvil_update_note to change status
2. Later, call anvil_update_note again with new content
3. Each update only touches specified fields
```
