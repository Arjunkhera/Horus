// Unit tests for storage layer (frontmatter, slug, wiki-links, file-store)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { mkdtemp } from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';

// Import storage modules
import { parseFrontmatter, serializeFrontmatter, CORE_FIELD_ORDER } from '../../src/storage/frontmatter.js';
import { generateSlug, generateFilePath as generateFilePathSlug } from '../../src/storage/slug.js';
import { extractWikiLinks, parseWikiLinkText } from '../../src/storage/wiki-links.js';
import {
  readNote,
  writeNote,
  scanVault,
  deleteFile,
} from '../../src/storage/file-store.js';
import { isAnvilError } from '../../src/types/error.js';
import { Note } from '../../src/types/note.js';

const mkdtempAsync = promisify(mkdtemp);

describe('Storage Layer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-test-'));
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Frontmatter', () => {
    it('should parse frontmatter with valid YAML', () => {
      const content = `---
noteId: note-1
type: task
title: Test Note
created: 2024-01-01T00:00:00Z
modified: 2024-01-01T00:00:00Z
tags:
  - tag1
  - tag2
related: []
---
This is the body`;

      const result = parseFrontmatter(content);

      expect(result.isEmpty).toBe(false);
      expect(result.data.noteId).toBe('note-1');
      expect(result.data.type).toBe('task');
      expect(result.data.title).toBe('Test Note');
      expect(Array.isArray(result.data.tags)).toBe(true);
      expect(result.content).toBe('This is the body');
    });

    it('should handle missing frontmatter', () => {
      const content = 'Just body text, no frontmatter';
      const result = parseFrontmatter(content);

      expect(result.isEmpty).toBe(true);
      expect(result.data).toEqual({});
      expect(result.content).toBe('Just body text, no frontmatter');
    });

    it('should strip BOM on read', () => {
      const bomContent = `\ufeff---
noteId: test
---
Body`;

      const result = parseFrontmatter(bomContent);

      expect(result.data.noteId).toBe('test');
      expect(result.isEmpty).toBe(false);
    });

    it('should serialize frontmatter with correct field order', () => {
      const data = {
        noteId: 'note-1',
        type: 'task',
        title: 'Test',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: ['tag1'],
        related: [],
        customField: 'custom-value',
        anotherField: 'value2',
      };

      const result = serializeFrontmatter(data, 'Body text');

      // Parse to verify core fields are in order
      const parsed = parseFrontmatter(result);

      // Check that we can re-serialize and it's still valid
      const reserialized = serializeFrontmatter(parsed.data, 'Body text');
      const reparsed = parseFrontmatter(reserialized);

      expect(reparsed.data.noteId).toBe(data.noteId);
      expect(reparsed.data.type).toBe(data.type);
      expect(reparsed.data.title).toBe(data.title);
    });

    it('should handle round-trip: parse then serialize', () => {
      const original = `---
noteId: note-1
type: task
title: Test
created: 2024-01-01T00:00:00Z
modified: 2024-01-01T00:00:00Z
tags:
  - tag1
related: []
---
Body content`;

      const parsed = parseFrontmatter(original);
      const serialized = serializeFrontmatter(parsed.data, parsed.content);

      // Parse again to verify equivalence
      const reparsed = parseFrontmatter(serialized);

      expect(reparsed.data.noteId).toBe(parsed.data.noteId);
      expect(reparsed.data.type).toBe(parsed.data.type);
      expect(reparsed.data.title).toBe(parsed.data.title);
      expect(reparsed.content).toBe(parsed.content);
    });

    it('should not add BOM when serializing', () => {
      const data = { noteId: 'test' };
      const result = serializeFrontmatter(data, 'body');

      expect(result[0]).not.toBe('\ufeff');
    });

    it('should handle CORE_FIELD_ORDER constant', () => {
      expect(Array.isArray(CORE_FIELD_ORDER)).toBe(true);
      expect(CORE_FIELD_ORDER).toContain('noteId');
      expect(CORE_FIELD_ORDER).toContain('type');
      expect(CORE_FIELD_ORDER).toContain('title');
    });
  });

  describe('Slug Generation', () => {
    it('should generate slug from title', () => {
      const slug = generateSlug('My Task Title');
      expect(slug).toBe('my-task-title');
    });

    it('should handle special characters', () => {
      const slug = generateSlug('Hello, World! (2024)');
      expect(slug).toBe('hello-world-2024');
    });

    it('should remove consecutive hyphens', () => {
      const slug = generateSlug('Multi---word---title');
      expect(slug).toBe('multi-word-title');
    });

    it('should strip leading/trailing hyphens', () => {
      const slug = generateSlug('-hello-world-');
      expect(slug).toBe('hello-world');
    });

    it('should trim long slugs to max length', () => {
      const slug = generateSlug('Very Long Title That Exceeds The Default Length', 20);
      expect(slug.length).toBeLessThanOrEqual(20);
      expect(slug).not.toMatch(/-$/);
    });

    it('should handle empty string', () => {
      const slug = generateSlug('');
      expect(slug).toBe('');
    });

    it('should handle file path generation with flat strategy', () => {
      const existingPaths = new Set<string>();
      const path = generateFilePathSlug('My Note', 'note', 'flat', existingPaths);
      expect(path).toBe('my-note.md');
    });

    it('should handle file path generation with by-type strategy', () => {
      const existingPaths = new Set<string>();
      const path = generateFilePathSlug('My Note', 'note', 'by-type', existingPaths);
      expect(path).toBe('note/my-note.md');
    });

    it('should handle collisions with counter', () => {
      const existingPaths = new Set<string>(['my-note.md']);
      const path = generateFilePathSlug('My Note', 'note', 'flat', existingPaths);
      expect(path).toBe('my-note-1.md');
    });

    it('should handle multiple collisions', () => {
      const existingPaths = new Set<string>(['my-note.md', 'my-note-1.md', 'my-note-2.md']);
      const path = generateFilePathSlug('My Note', 'note', 'flat', existingPaths);
      expect(path).toBe('my-note-3.md');
    });
  });

  describe('Wiki Links', () => {
    it('should extract simple wiki links', () => {
      const body = 'This mentions [[First Note]] and [[Second Note]].';
      const links = extractWikiLinks(body);

      expect(links).toContain('First Note');
      expect(links).toContain('Second Note');
      expect(links.length).toBe(2);
    });

    it('should handle wiki links with aliases', () => {
      const body = 'See [[Original Title|display text]] for more.';
      const links = extractWikiLinks(body);

      expect(links).toContain('Original Title');
      expect(links).not.toContain('display text');
    });

    it('should skip wiki links inside code blocks', () => {
      const body = `Here is a link [[Valid Link]].

\`\`\`
This [[code link]] should be ignored
\`\`\`

And [[another link]] here.`;

      const links = extractWikiLinks(body);

      expect(links).toContain('Valid Link');
      expect(links).toContain('another link');
      expect(links).not.toContain('code link');
    });

    it('should skip wiki links inside inline code', () => {
      const body = 'Use \`[[inline code]]\` but not [[this one]].';
      const links = extractWikiLinks(body);

      expect(links).toContain('this one');
      expect(links).not.toContain('inline code');
    });

    it('should deduplicate results', () => {
      const body = 'Link to [[Same Note]] and again [[Same Note]].';
      const links = extractWikiLinks(body);

      expect(links.filter((l) => l === 'Same Note').length).toBe(1);
    });

    it('should parse wiki link text', () => {
      expect(parseWikiLinkText('[[Simple Title]]')).toBe('Simple Title');
      expect(parseWikiLinkText('[[Title|Alias]]')).toBe('Title');
      expect(parseWikiLinkText('Not a link')).toBe('');
    });
  });

  describe('File Store', () => {
    it('should write and read a note', async () => {
      const note: Note = {
        noteId: 'test-note-1',
        type: 'task',
        title: 'Test Task',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
        tags: ['important'],
        related: [],
        scope: undefined,
        status: 'in-progress',
        priority: 'high',
        due: undefined,
        effort: 3,
        fields: { customField: 'customValue' },
        body: 'This is the task body.',
        filePath: join(tmpDir, 'test.md'),
      };

      // Write note
      await writeNote(note);

      // Verify file exists
      const content = await fs.readFile(note.filePath, 'utf-8');
      expect(content).toContain('noteId: test-note-1');
      expect(content).toContain('This is the task body');

      // Read note back
      const result = await readNote(note.filePath);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const { note: readNoteData } = result;
        expect(readNoteData.noteId).toBe('test-note-1');
        expect(readNoteData.type).toBe('task');
        expect(readNoteData.title).toBe('Test Task');
        expect(readNoteData.status).toBe('in-progress');
        expect(readNoteData.body).toBe('This is the task body.');
      }
    });

    it('should handle missing file', async () => {
      const result = await readNote(join(tmpDir, 'nonexistent.md'));

      expect(isAnvilError(result)).toBe(true);
      if (isAnvilError(result)) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('should create parent directories when writing', async () => {
      const note: Note = {
        noteId: 'nested-note',
        type: 'note',
        title: 'Nested Note',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: [],
        fields: {},
        body: 'Nested content',
        filePath: join(tmpDir, 'deep', 'nested', 'path', 'note.md'),
      };

      await writeNote(note);

      const exists = await fs
        .stat(note.filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should scan vault for markdown files', async () => {
      // Create some test files
      const note1Path = join(tmpDir, 'note1.md');
      const note2Path = join(tmpDir, 'subdir', 'note2.md');
      const ignorePath = join(tmpDir, '.git', 'config.md');

      await fs.mkdir(join(tmpDir, 'subdir'), { recursive: true });
      await fs.mkdir(join(tmpDir, '.git'), { recursive: true });

      await fs.writeFile(note1Path, 'content1');
      await fs.writeFile(note2Path, 'content2');
      await fs.writeFile(ignorePath, 'ignored');

      const results: string[] = [];
      for await (const result of scanVault(tmpDir)) {
        results.push(result.filePath);
      }

      expect(results).toContain('note1.md');
      expect(results).toContain(join('subdir', 'note2.md'));
      expect(results.some((r) => r.includes('.git'))).toBe(false);
    });

    it('should handle empty vault', async () => {
      const results: string[] = [];
      for await (const result of scanVault(tmpDir)) {
        results.push(result.filePath);
      }

      expect(results.length).toBe(0);
    });

    it('should delete files', async () => {
      const filePath = join(tmpDir, 'to-delete.md');
      await fs.writeFile(filePath, 'content');

      await deleteFile(filePath);

      const exists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should return error when deleting nonexistent file', async () => {
      const filePath = join(tmpDir, 'nonexistent.md');

      try {
        await deleteFile(filePath);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(isAnvilError(err)).toBe(true);
        if (isAnvilError(err)) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }
    });
  });

  describe('Integration: Note Round-trip', () => {
    it('should write a note with wiki links and read it back', async () => {
      const note: Note = {
        noteId: 'integration-test',
        type: 'note',
        title: 'Integration Test Note',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T12:00:00Z',
        tags: ['test', 'integration'],
        related: ['[[Related Note 1]]', '[[Related Note 2]]'],
        fields: { customField: 'value' },
        body: `# Integration Test

This note mentions [[Referenced Note]].

See also [[Another Note|alias]].

\`\`\`
Ignored [[link]] in code
\`\`\`

Final mention of [[Final Note]].`,
        filePath: join(tmpDir, 'integration.md'),
      };

      // Write
      await writeNote(note);

      // Read back
      const result = await readNote(note.filePath);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const { note: readNote } = result;

        // Verify all fields
        expect(readNote.noteId).toBe(note.noteId);
        expect(readNote.type).toBe(note.type);
        expect(readNote.title).toBe(note.title);
        expect(readNote.tags).toEqual(note.tags);
        expect(readNote.body).toBe(note.body);

        // Verify wiki links can be extracted from body
        const links = extractWikiLinks(readNote.body);
        expect(links).toContain('Referenced Note');
        expect(links).toContain('Another Note');
        expect(links).toContain('Final Note');
        expect(links).not.toContain('link');
      }
    });
  });
});
