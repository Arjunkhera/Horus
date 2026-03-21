---
noteId: 550e8400-e29b-41d4-a716-446655440006
type: note
title: "Architecture Decisions - 2026"
tags: [arch, docs, decisions]
created: "2026-01-10T11:00:00Z"
modified: "2026-02-15T15:30:00Z"
---

## ADR-001: Event-Driven Architecture
**Date**: 2026-01-10
**Status**: Accepted

We have chosen an event-driven architecture for the new microservices.

**Consequences**:
- Loose coupling between services
- Eventual consistency
- Need for event sourcing patterns

## ADR-002: SQLite for Local Storage
**Date**: 2026-01-15
**Status**: Accepted

SQLite with FTS5 extension for full-text search in vault indexing.

**Rationale**:
- Zero external dependencies
- Excellent for local development
- Good performance with moderate data

## Related
- [[Implement Authentication]]
- [[Quality Assurance Plan]]
