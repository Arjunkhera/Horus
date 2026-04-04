/**
 * LocalFileStore — local filesystem implementation of the FileStore interface.
 *
 * Stores binary files (PDFs, images, etc.) on disk at:
 *   {dataRoot}/files/{entityId}/{filename}
 *
 * Files are NOT git-synced — they live outside the vault and are local-only in MVP.
 */

import { FileStore, StoredFile } from './file-store.js';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import * as fss from 'node:fs';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};

const DEFAULT_MIME_TYPE = 'application/octet-stream';

function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;
}

export class LocalFileStore implements FileStore {
  private readonly filesDir: string;

  constructor(dataRoot: string) {
    this.filesDir = path.join(dataRoot, 'files');
  }

  async store(entityId: string, filename: string, sourcePath: string): Promise<StoredFile> {
    const dir = path.join(this.filesDir, entityId);
    await fs.mkdir(dir, { recursive: true });

    const dest = path.join(dir, filename);
    await fs.copyFile(sourcePath, dest);

    const stat = await fs.stat(dest);
    const mimeType = detectMimeType(filename);
    const storedPath = path.join('data', 'files', entityId, filename);

    return {
      entityId,
      filename,
      size: stat.size,
      mimeType,
      storedPath,
    };
  }

  async get(entityId: string, filename: string): Promise<Readable> {
    const filePath = path.join(this.filesDir, entityId, filename);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${entityId}/${filename}`);
    }

    return fss.createReadStream(filePath);
  }

  async delete(entityId: string): Promise<void> {
    const dir = path.join(this.filesDir, entityId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Silently succeed if already gone
    }
  }

  async exists(entityId: string, filename: string): Promise<boolean> {
    const filePath = path.join(this.filesDir, entityId, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
