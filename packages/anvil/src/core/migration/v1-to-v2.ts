/**
 * Automatic migration from Anvil V1 (SQLite-only) to V2 (SQLite + Neo4j graph).
 *
 * Rebuilds the SQLite index from the filesystem (source of truth), then
 * migrates `related` frontmatter fields into Neo4j edges with `mentions`
 * intent. The migration is idempotent and safe to restart mid-run.
 *
 * @module core/migration/v1-to-v2
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import type { AnvilDatabase } from '../../index/sqlite.js'
import type { Neo4jEdgeStore } from '../graph/neo4j-edge-store.js'
import type { AnvilEdge } from '../graph/edge-model.js'
import { scanVault, readNote } from '../../storage/file-store.js'
import { fullRebuild } from '../../index/indexer.js'
import { parseWikiLink } from '../../types/note.js'
import type { Note } from '../../types/note.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationOptions {
  vaultPath: string
  db: AnvilDatabase
  edgeStore: Neo4jEdgeStore
}

export interface MigrationReport {
  skipped: boolean
  edgesMigrated: number
  edgesFailed: number
  failedDetails: Array<{ source: string; target: string; reason: string }>
  duration: number
}

// ---------------------------------------------------------------------------
// Version marker helpers
// ---------------------------------------------------------------------------

const VERSION_DIR = '.anvil/.local'
const VERSION_FILE = 'version.json'

interface VersionMarker {
  version: number
  migratedAt: string
}

async function readVersionMarker(
  vaultPath: string,
): Promise<VersionMarker | null> {
  const filePath = join(vaultPath, VERSION_DIR, VERSION_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as VersionMarker
  } catch {
    return null
  }
}

async function writeVersionMarker(vaultPath: string): Promise<void> {
  const dirPath = join(vaultPath, VERSION_DIR)
  await fs.mkdir(dirPath, { recursive: true })

  const marker: VersionMarker = {
    version: 2,
    migratedAt: new Date().toISOString(),
  }

  const filePath = join(dirPath, VERSION_FILE)
  await fs.writeFile(filePath, JSON.stringify(marker, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Migration entry point
// ---------------------------------------------------------------------------

/**
 * Migrate an Anvil vault from V1 to V2.
 *
 * 1. Check version marker -- skip if already >= 2.
 * 2. Rebuild SQLite index from filesystem (source of truth).
 * 3. Convert `related` frontmatter entries into Neo4j edges (intent: mentions).
 * 4. Write V2 version marker.
 *
 * The migration is idempotent: Neo4j edges use MERGE semantics, and the
 * version marker prevents re-running on an already-migrated vault.
 * Failures on individual edges are logged but do not halt the migration.
 */
export async function migrateV1ToV2(
  options: MigrationOptions,
): Promise<MigrationReport> {
  const start = Date.now()
  const { vaultPath, db, edgeStore } = options

  // -----------------------------------------------------------------------
  // Step 1: Check version marker
  // -----------------------------------------------------------------------
  const marker = await readVersionMarker(vaultPath)
  if (marker && marker.version >= 2) {
    return {
      skipped: true,
      edgesMigrated: 0,
      edgesFailed: 0,
      failedDetails: [],
      duration: Date.now() - start,
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Rebuild SQLite from filesystem
  // -----------------------------------------------------------------------
  const notes: Note[] = []
  for await (const file of scanVault(vaultPath)) {
    const absolutePath = join(vaultPath, file.filePath)
    const result = await readNote(absolutePath)
    if (!('error' in result)) {
      notes.push(result.note)
    }
  }

  fullRebuild(db.raw, notes)

  // -----------------------------------------------------------------------
  // Step 3: Migrate related fields to Neo4j edges
  // -----------------------------------------------------------------------
  let edgesMigrated = 0
  let edgesFailed = 0
  const failedDetails: MigrationReport['failedDetails'] = []

  const edgeBatch: AnvilEdge[] = []
  const now = new Date()

  for (const note of notes) {
    if (!note.related || note.related.length === 0) {
      continue
    }

    for (const relStr of note.related) {
      const targetTitle = parseWikiLink(relStr)
      if (!targetTitle) {
        edgesFailed++
        failedDetails.push({
          source: note.noteId,
          target: relStr,
          reason: `Could not parse wiki-link: ${relStr}`,
        })
        continue
      }

      // Resolve target title to noteId via SQLite
      const targetRow = db.raw.getOne<{ note_id: string }>(
        'SELECT note_id FROM notes WHERE title = ? LIMIT 1',
        [targetTitle],
      )

      if (!targetRow) {
        edgesFailed++
        failedDetails.push({
          source: note.noteId,
          target: targetTitle,
          reason: `Target note not found in index`,
        })
        continue
      }

      edgeBatch.push({
        sourceId: note.noteId,
        targetId: targetRow.note_id,
        intent: 'mentions',
        description: `Migrated from V1 related field`,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // Batch import with MERGE semantics (idempotent)
  if (edgeBatch.length > 0) {
    try {
      await edgeStore.importEdges(edgeBatch)
      edgesMigrated = edgeBatch.length
    } catch (err) {
      // If batch fails, fall back to one-by-one to maximise successful edges
      for (const edge of edgeBatch) {
        try {
          await edgeStore.importEdges([edge])
          edgesMigrated++
        } catch (individualErr) {
          edgesFailed++
          failedDetails.push({
            source: edge.sourceId,
            target: edge.targetId,
            reason:
              individualErr instanceof Error
                ? individualErr.message
                : String(individualErr),
          })
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Write V2 version marker
  // -----------------------------------------------------------------------
  await writeVersionMarker(vaultPath)

  return {
    skipped: false,
    edgesMigrated,
    edgesFailed,
    failedDetails,
    duration: Date.now() - start,
  }
}
