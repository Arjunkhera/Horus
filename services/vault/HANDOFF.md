# Knowledge Service v0 - Development Handoff

## 📍 Current Status: Phase 1 Complete

**Completed:** 2026-02-19  
**Next Phase:** Phase 2 - Layer 1 (Search Store) — NOTE: Original adapter was replaced by Typesense (external search, TS-4).

---

## ✅ What's Been Built

### Phase 1: Python Project Scaffold

1. **Project Structure** - Complete folder hierarchy
   ```
   knowledge-service/
   ├── README.md                  # Architecture overview
   ├── requirements.txt           # All 7 dependencies
   ├── config/                    # Config directory
   └── src/
       ├── __init__.py
       ├── layer1/__init__.py
       ├── layer2/__init__.py
       ├── api/
       │   ├── __init__.py
       │   └── models.py          # ✅ Complete Pydantic models
       └── sync/__init__.py
   ```

2. **API Contract** - All 5 operations defined in `src/api/models.py`
   - `resolve-context` - Resolve scope chain, return operational pages
   - `search` - Full-text + semantic search with progressive disclosure
   - `get-page` - Retrieve full page by identifier
   - `get-related` - Follow links to related pages
   - `list-by-scope` - Browse/filter by scope, mode, type, tags

3. **Data Models** - Complete Pydantic models
   - `PageSummary` - Progressive disclosure (description only)
   - `PageFull` - Complete page with body and relationships
   - `ScopeFilter` - Hierarchical scope filtering
   - Request/Response models for each operation

---

## Phase 2 - Layer 1 (Search Store)

> **Historical note:** The original plan called for a subprocess adapter. That was replaced
> by a local engine, which was then removed in the Typesense migration (TS-4). The current
> implementation uses `FilesystemStore` for document retrieval. Text search is provided by Typesense.

### Task 2.1: Define Abstract SearchStore Interface -- DONE

**File:** `src/layer1/interface.py`

### Task 2.2: Implement Search Store -- DONE (FilesystemStore)

**File:** `src/layer1/filesystem_store.py`

Filesystem-based store that handles document retrieval. Search operations return empty results
until a Typesense-backed SearchStore is configured.

---

## 📚 Key Resources

### Documentation
- **Story file:** `/Users/akhera/Desktop/Repositories/Notes/Projects/Agent-Automation/stories/Knowledge-Service-v0.md`
- **Sample pages:** `/Users/akhera/Desktop/Repositories/Notes/Tasks/examples/knowledge-service-page-samples.md`
- **This README:** `automation/knowledge-service/README.md`

### Code Repositories
- **Service code:** `/Users/akhera/Desktop/Repositories/automation/knowledge-service/`
- **Search:** Typesense (external service, shared with Anvil)
- **Data repo (future):** `akhera/knowledge-base` (markdown pages - not created yet)

### Architecture
```
┌─ Docker Container ─────────────────────────────────────────┐
│  REST API (:8000, FastAPI)                                  │
│    ├── Layer 2: Knowledge Logic                             │
│    │     (scope-chain, mode filter, progressive disclosure) │
│    └── Layer 1: FilesystemStore + Typesense (planned)       │
│          ├── Collection: "shared"                            │
│          │     └── /data/knowledge-repo/ (cloned inside)    │
│          └── Collection: "workspace"                         │
│                └── /workspace/ (mounted from host, ro)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Development Setup

### Install Dependencies
```bash
cd /Users/akhera/Desktop/Repositories/automation/knowledge-service
pip install -r requirements.txt
```

### Run Tests
```bash
pytest tests/ -v
```

---

## 📋 Phase Checklist

- [x] **Phase 1**: Python Project Scaffold ✅ COMPLETE
  - [x] Task 1.1: Project structure + requirements.txt
  - [x] Task 1.2: Pydantic models

- [x] **Phase 2**: Layer 1 - Search Store
  - [x] Task 2.1: Abstract SearchStore interface
  - [x] Task 2.2: FilesystemStore implementation (Typesense replaces old local engine)

- [ ] **Phase 3**: Layer 2 - Knowledge Logic
  - [ ] Task 3.1: Frontmatter parser
  - [ ] Task 3.2: Scope-chain resolver
  - [ ] Task 3.3: Mode filtering + progressive disclosure
  - [ ] Task 3.4: Link navigator

- [ ] **Phase 4**: REST API
  - [ ] Task 4.1: 5 REST endpoints
  - [ ] Task 4.2: FastAPI app entry point

- [ ] **Phase 5**: Sync Daemon
  - [ ] Task 5.1: Git pull loop + file watcher
  - [ ] Task 5.2: Wire into entrypoint

- [ ] **Phase 6**: Docker Image
  - [ ] Task 6.1: Dockerfile
  - [ ] Task 6.2: docker-compose.yml

- [ ] **Phase 7**: MCP Thin Client
  - [ ] Task 7.1: npm package scaffold
  - [ ] Task 7.2: MCP server implementation

- [ ] **Phase 8**: Validation
  - [ ] Task 8.1: Local integration test
  - [ ] Task 8.2: Docker end-to-end test

---

## 💡 Tips for Next Developer

1. **Read the sample pages first** - Understanding the frontmatter schema is crucial. See `Tasks/examples/knowledge-service-page-samples.md` for 10 validated examples.

2. **The two-layer architecture is key** - Layer 1 (search/storage) is swappable. Layer 2 (knowledge logic) is stable. Keep them decoupled.

3. **Typesense integration** - The next step for Layer 1 is to add a TypesenseStore that implements SearchStore using the shared `@horus/search` package.

---

## 🐛 Known Issues / Gotchas

- Collection paths must be absolute in Docker container
- File watcher (Phase 5) needs debouncing to avoid re-indexing on every keystroke

---

## 📞 Questions?

Refer back to the story file for detailed implementation guidance. Each phase has step-by-step instructions with code examples.

**Story location:** `/Users/akhera/Desktop/Repositories/Notes/Projects/Agent-Automation/stories/Knowledge-Service-v0.md`
