# Type Authoring Guide

Anvil uses YAML-based type definitions to enforce structure and validation on notes. This guide explains how to create and customize types.

## Type Definition Format

Type definitions are stored in YAML files. Here's the complete structure:

```yaml
id: task
name: Task
description: "An actionable work item with status tracking"
icon: "checkbox"
extends: _core
fields:
  status:
    type: enum
    values: [open, in-progress, blocked, done]
    default: open
    required: true
  priority:
    type: enum
    values: [P0-critical, P1-high, P2-medium, P3-low]
    default: P2-medium
  due:
    type: date
    required: false
  assignee:
    type: reference
    ref_type: person
behaviors:
  append_only: false
template:
  frontmatter:
    status: open
    priority: P2-medium
    tags: []
  body: |
    ## Context
    
    ## Acceptance Criteria
    
    - [ ]
    
    ## Notes
```

## Field Type Reference

### Primitives

#### `string`
Plain text field.
```yaml
fields:
  name:
    type: string
    required: true
    min_length: 1
    max_length: 100
    pattern: "^[a-z0-9-]+$"  # regex
```

#### `number`
Numeric field.
```yaml
fields:
  effort:
    type: number
    required: false
    min: 1
    max: 21
    integer: true  # disallow decimals
```

#### `boolean`
True/false field.
```yaml
fields:
  pinned:
    type: boolean
    default: false
```

### Temporal

#### `date`
ISO 8601 date (YYYY-MM-DD).
```yaml
fields:
  due:
    type: date
    required: false
```

#### `datetime`
ISO 8601 datetime (YYYY-MM-DDTHH:MM:SSZ).
```yaml
fields:
  created:
    type: datetime
    immutable: true  # Cannot be changed
```

### Structured

#### `enum`
One of predefined values.
```yaml
fields:
  status:
    type: enum
    values: [open, in-progress, done]
    required: true
    default: open
```

#### `tags`
Array of strings.
```yaml
fields:
  tags:
    type: tags
    required: false
    no_duplicates: true
```

#### `reference`
Link to another note of specific type.
```yaml
fields:
  assignee:
    type: reference
    ref_type: person  # must be a valid type
    required: false
```

#### `reference_list`
Array of links to other notes.
```yaml
fields:
  related:
    type: reference_list
    ref_type: note
    no_duplicates: true
```

#### `text` (textarea)
Multi-line text field (for custom frontmatter).
```yaml
fields:
  description:
    type: text
    required: false
```

#### `url`
URL field with validation.
```yaml
fields:
  link:
    type: url
    required: false
```

#### `object`
Nested object with sub-fields.
```yaml
fields:
  scope:
    type: object
    required: false
    fields:
      context:
        type: enum
        values: [personal, work]
      team:
        type: string
      service:
        type: string
```

## Inheritance

All types should extend from `_core` (directly or indirectly). The core type provides standard fields:

```yaml
id: _core
name: Core
fields:
  noteId:
    type: string
    auto: uuid
    immutable: true
  created:
    type: datetime
    auto: now
    immutable: true
  modified:
    type: datetime
    auto: now
  title:
    type: string
    required: true
  tags:
    type: tags
  related:
    type: reference_list
  scope:
    type: object
```

Extend core to inherit these fields:

```yaml
id: task
name: Task
extends: _core  # inherits all core fields
fields:
  status:
    type: enum
    values: [open, in-progress, done]
```

## Built-in Types

Anvil provides several built-in types:

### Core (_core)
Base type with common fields. Don't use directly.

### Task
Actionable items with status and priority.
```yaml
extends: _core
fields:
  status: enum [open, in-progress, blocked, done]
  priority: enum [P0-critical, P1-high, P2-medium, P3-low]
  due: date
  effort: number (1-21)
  assignee: reference to person
  project: reference to project
```

### Project
Larger initiatives.
```yaml
extends: _core
fields:
  status: enum [active, planning, archived]
```

### Note
General information.
```yaml
extends: _core
# No additional fields
```

### Meeting
Meeting notes with participants.
```yaml
extends: _core
fields:
  attendees: reference_list to person
```

### Journal
Daily logs with append-only behavior.
```yaml
extends: _core
behaviors:
  append_only: true
```

### Person
Team members and contacts.
```yaml
extends: _core
fields:
  email: string
  role: string
```

### Story
User stories and feature requests.
```yaml
extends: _core
fields:
  status: enum [active, planned, completed]
  priority: enum [P0, P1, P2, P3]
```

### Service
External services and APIs.
```yaml
extends: _core
fields:
  status: enum [active, deprecated]
  url: url
```

## Creating a Custom Type

### Example: Bug Report Type

Create `types/bug.yaml` in your vault:

```yaml
id: bug
name: Bug Report
description: "Issue tracking for bugs and defects"
icon: "bug"
extends: task  # inherit from task to get status, priority, etc.
fields:
  severity:
    type: enum
    values: [critical, high, medium, low]
    required: true
    default: medium
  environment:
    type: string
    required: true
    description: "Where the bug occurs (browser, OS, etc.)"
  steps_to_reproduce:
    type: text
    required: true
  expected_behavior:
    type: text
    required: false
  actual_behavior:
    type: text
    required: true
  error_log:
    type: text
    required: false
behaviors:
  append_only: false
template:
  frontmatter:
    status: open
    severity: medium
    priority: P2-medium
    tags: []
  body: |
    ## Environment
    
    ## Steps to Reproduce
    
    1.
    
    ## Expected Behavior
    
    ## Actual Behavior
    
    ## Error Log
    
    ## Screenshots
```

Now you can create bug reports:
```
User: Create a bug for the login page crash.
```

### Example: Decision Record Type

```yaml
id: decision_record
name: Architecture Decision Record
description: "Record important decisions and their rationale"
extends: _core
fields:
  status:
    type: enum
    values: [proposed, accepted, superseded, deprecated]
    default: proposed
    required: true
  decision_date:
    type: date
    required: true
  context:
    type: text
    required: true
  decision:
    type: text
    required: true
  consequences:
    type: text
    required: true
  alternatives:
    type: text
    required: false
template:
  frontmatter:
    status: proposed
    tags: [architecture, decision]
  body: |
    ## Context
    
    ## Decision
    
    ## Consequences
    
    ### Positive
    
    ### Negative
    
    ## Alternatives Considered
```

## Field Constraints

### Common Attributes

All field types can include:

```yaml
fields:
  example:
    type: string
    required: true          # must be present
    immutable: false        # cannot be changed after creation
    default: "value"        # initial value
    description: "..."      # help text
```

### Auto-Generation

Some fields can auto-generate values:

```yaml
fields:
  noteId:
    type: string
    auto: uuid             # generates UUID
  created:
    type: datetime
    auto: now              # sets to current timestamp
```

Valid auto values:
- `uuid`: Generate UUID v4
- `now`: Current ISO 8601 timestamp

## Behaviors

Types can have behaviors that change how they work:

```yaml
behaviors:
  append_only: true  # content can only be appended, not replaced
```

### append_only
Content updates are appended rather than replaced.

Example use case: Journal entries
```yaml
id: journal
extends: _core
behaviors:
  append_only: true
```

When updating an append_only note:
```
Initial content: "Morning: Started work."

Update with: "Afternoon: Made progress."

Result: "Morning: Started work.\nAfternoon: Made progress."
```

## Templates

Templates provide default content when creating notes:

```yaml
template:
  frontmatter:
    status: open
    priority: P2-medium
    tags: []
  body: |
    ## Context
    
    ## Acceptance Criteria
    
    ## Notes
```

When creating a note of this type without explicit content, the template body is used. Template frontmatter provides defaults that can be overridden.

## Validation Rules

Anvil validates notes against type schemas:

1. **All required fields must be present**
2. **Field values must match their type**
3. **Enum values must be from the values list**
4. **Number ranges must be within min/max**
5. **Strings must match patterns (if specified)**
6. **References must point to existing notes (or remain unresolved)**

If validation fails, creation or update is rejected with detailed error messages.

## Best Practices

1. **Always extend a parent type** (directly or indirectly from _core)
2. **Use descriptive field names** (snake_case preferred)
3. **Mark required fields explicitly** to avoid surprises
4. **Provide default values** for common cases
5. **Include descriptions** to help users understand fields
6. **Use enums** for constrained fields instead of free strings
7. **Keep templates realistic** with useful section headers
8. **Document custom types** in your vault's README

## Schema Validation

Types are validated when loaded. Invalid YAML or type definitions will cause startup errors:

```
Error: Schema validation failed in bug.yaml
  - severity field: unknown enum value "catastrophic"
  - extends references non-existent type "task_base"
```

Fix the issues and restart Anvil.

## Viewing Available Types

Use the `anvil_list_types` tool to see all available types and their schemas:

```
User: What note types are available?

Claude: I'll list all available types.
[Uses anvil_list_types tool]
```

This shows all types with their fields and validation rules.

## Migration from Obsidian

If migrating from Obsidian:

1. Define types matching your vault's note categories
2. Use migration tools to auto-infer types based on tags/properties
3. Adjust field mappings as needed
4. Validate against new schemas

See the main README for migration tools.

## Examples

See `defaults/` directory for complete examples of all built-in types.
