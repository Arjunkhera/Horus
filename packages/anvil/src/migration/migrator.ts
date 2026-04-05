// Main migration orchestrator

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AnvilDb } from '../index/sqlite.js';
import { parseFrontmatter, serializeFrontmatter } from '../storage/frontmatter.js';
import { scanVault, readNote } from '../storage/file-store.js';
import { fullRebuild } from '../index/indexer.js';
import { inferType, type InferenceRule } from './type-inferrer.js';
import { extractDataviewFields, convertDataviewFields } from './dataview-converter.js';
import {
  createEmptyReport,
  addFileResult,
  type MigrationReport,
  type FileMigrationResult,
} from './report.js';
import type { Note } from '../types/note.js';

export type MigrationConfig = {
  vaultPath: string;
  dryRun: boolean;
  batchSize?: number;
  typeRules?: InferenceRule[];
  prefixMap?: Record<string, string>;
};

/**
 * Main migration function.
 * Scans vault for .md files and applies migrations:
 * 1. Read frontmatter
 * 2. If already has noteId, skip (idempotent)
 * 3. Assign noteId if missing
 * 4. Infer type if missing
 * 5. Extract and convert dataview fields
 * 6. Merge converted fields into frontmatter
 * 7. If NOT dry-run: backup and write updated file
 * 8. Trigger fullRebuild if db provided and NOT dry-run
 * 9. Return report
 */
export async function migrate(
  config: MigrationConfig,
  db?: AnvilDb,
): Promise<MigrationReport> {
  const report = createEmptyReport();

  // Collect all files first
  const files: Array<{
    filePath: string;
    fullPath: string;
  }> = [];

  for await (const scanResult of scanVault(config.vaultPath)) {
    files.push({
      filePath: scanResult.filePath,
      fullPath: join(config.vaultPath, scanResult.filePath),
    });
  }

  report.totalFiles = files.length;

  // Process files
  const processedNotes: Note[] = [];

  for (const file of files) {
    const result = await processFile(
      file.fullPath,
      file.filePath,
      config,
    );

    addFileResult(report, result);

    // If not dry-run and processing was successful, track the note for indexing
    if (!config.dryRun && result.status === 'ok') {
      const readResult = await readNote(file.fullPath);
      if ('note' in readResult) {
        processedNotes.push(readResult.note);
      }
    }
  }

  // If db provided and NOT dry-run, trigger fullRebuild
  if (db && !config.dryRun && processedNotes.length > 0) {
    try {
      fullRebuild(db, processedNotes);
    } catch (err) {
      const errorMsg = `Failed to rebuild index: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(errorMsg);
    }
  }

  return report;
}

/**
 * Process a single file for migration.
 */
async function processFile(
  fullPath: string,
  relativeFilePath: string,
  config: MigrationConfig,
): Promise<FileMigrationResult> {
  const result: FileMigrationResult = {
    filePath: relativeFilePath,
    status: 'ok',
    noteIdAdded: false,
    typeAssigned: null,
    dataviewFieldsConverted: [],
    warnings: [],
  };

  try {
    // Read file content
    const fileContent = await fs.readFile(fullPath, 'utf-8');
    const { data, content: body } = parseFrontmatter(fileContent);

    // Check if already has noteId (idempotent)
    if (data.noteId && typeof data.noteId === 'string') {
      result.status = 'skipped';
      return result;
    }

    // Create new frontmatter by copying existing data
    const newData: Record<string, unknown> = { ...data };

    // Assign noteId
    newData.noteId = uuidv4();
    result.noteIdAdded = true;

    // Infer and assign type if missing
    if (!newData.type) {
      const rules = config.typeRules;
      const type = inferType(relativeFilePath, data, rules ? { rules } : undefined);
      newData.type = type;
      result.typeAssigned = type;
    }

    // Extract dataview fields
    const dataviewFields = extractDataviewFields(body);
    let newBody = body;

    if (dataviewFields.length > 0) {
      const { newBody: cleanedBody, convertedFields } = convertDataviewFields(
        body,
        dataviewFields,
      );

      newBody = cleanedBody;

      // Merge converted fields into frontmatter
      Object.assign(newData, convertedFields);

      result.dataviewFieldsConverted = Object.keys(convertedFields);
    }

    // If NOT dry-run, backup and write updated file
    if (!config.dryRun) {
      // Create backup
      await backupFile(config.vaultPath, relativeFilePath, fileContent);

      // Serialize and write updated content
      const updatedContent = serializeFrontmatter(newData, newBody);
      await fs.writeFile(fullPath, updatedContent, 'utf-8');
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.status = 'error';
    result.error = errorMsg;
    result.warnings.push(`Failed to process file: ${errorMsg}`);
    return result;
  }
}

/**
 * Create backup of file.
 * Backup location: <vaultPath>/.anvil/.local/migration-backup/
 * Filename: file path relative to vault with `/` → `_`, keep `.md` extension
 */
async function backupFile(
  vaultPath: string,
  relativeFilePath: string,
  fileContent: string,
): Promise<void> {
  // Convert path separators to underscores
  const backupFileName = relativeFilePath.replace(/\//g, '_');

  // Create backup directory
  const backupDir = join(vaultPath, '.anvil', '.local', 'migration-backup');
  await fs.mkdir(backupDir, { recursive: true });

  // Write backup file
  const backupPath = join(backupDir, backupFileName);
  await fs.writeFile(backupPath, fileContent, 'utf-8');
}
