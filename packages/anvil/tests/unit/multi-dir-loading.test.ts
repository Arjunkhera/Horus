// Unit tests for multi-directory type loading in TypeRegistry

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TypeRegistry - Multi-directory loading', () => {
  let tmpDir: string;
  let dir1: string;
  let dir2: string;
  let dir3: string;

  beforeEach(() => {
    // Create temporary directories for testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-multi-dir-test-'));
    dir1 = path.join(tmpDir, 'dir1');
    dir2 = path.join(tmpDir, 'dir2');
    dir3 = path.join(tmpDir, 'dir3');
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.mkdirSync(dir3);
  });

  afterEach(() => {
    // Clean up temporary directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load types from a single directory (backward compat)', async () => {
    // Create _core.yaml in dir1
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create task.yaml in dir1
    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes(dir1); // Single string, not array

    expect(err).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);
    expect(registry.getType('task')?.extends).toBe('_core');
  });

  it('should load types from multiple directories with no conflicts', async () => {
    // dir1: _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: note
    fs.writeFileSync(
      path.join(dir2, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);
    expect(registry.hasType('note')).toBe(true);
  });

  it('should resolve conflicts: first directory wins', async () => {
    // dir1: task type (version 1)
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task (version 1)
extends: _core
fields:
  priority:
    type: enum
    values: [low, high]
`
    );

    // dir2: task type (version 2) — should be ignored
    fs.writeFileSync(
      path.join(dir2, 'task.yaml'),
      `id: task
name: Task (version 2)
extends: _core
fields:
  priority:
    type: number
`
    );

    // Capture console.warn to verify warning logged
    let warnMessage = '';
    const originalWarn = console.warn;
    console.warn = (msg: string) => {
      warnMessage = msg;
    };

    try {
      const registry = new TypeRegistry();
      const err = await registry.loadTypes([dir1, dir2]);

      expect(err).toBeUndefined();
      expect(registry.getType('task')?.name).toBe('Task (version 1)');
      expect(warnMessage).toContain("Type conflict: 'task'");
      expect(warnMessage).toContain('defined in both');
      expect(warnMessage).toContain('higher precedence');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should skip missing directories without error', async () => {
    // Only create dir1, dir2 and dir3 don't exist
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    // Capture console.debug to verify debug log
    let debugMessage = '';
    const originalDebug = console.debug;
    console.debug = (msg: string) => {
      debugMessage = msg;
    };

    try {
      const registry = new TypeRegistry();
      // dir2 doesn't exist, but should be skipped
      const nonExistentDir = path.join(tmpDir, 'nonexistent');
      const err = await registry.loadTypes([dir1, nonExistentDir, dir3]);

      expect(err).toBeUndefined();
      expect(registry.hasType('_core')).toBe(true);
      expect(registry.hasType('note')).toBe(true);
      expect(debugMessage).toContain('Type directory not found');
    } finally {
      console.debug = originalDebug;
    }
  });

  it('should handle empty directories silently', async () => {
    // dir1: has _core
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // dir2: empty (no YAML files)
    // dir3: has note
    fs.writeFileSync(
      path.join(dir3, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2, dir3]);

    expect(err).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('note')).toBe(true);
  });

  it('should support cross-directory inheritance', async () => {
    // dir1: _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: story that extends task (defined in dir1)
    fs.writeFileSync(
      path.join(dir2, 'story.yaml'),
      `id: story
name: Story
extends: task
fields:
  epic:
    type: reference
    ref_type: epic
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    expect(registry.hasType('story')).toBe(true);
    const storyType = registry.getType('story');
    expect(storyType?.extends).toBe('task');
    // Story should have both task's status field and task's inherited title field
    expect(storyType?.fields['status']).toBeDefined();
    expect(storyType?.fields['title']).toBeDefined();
    expect(storyType?.fields['epic']).toBeDefined();
  });

  it('should error if _core is missing from all directories', async () => {
    // dir1: task (no _core)
    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: note (no _core)
    fs.writeFileSync(
      path.join(dir2, 'note.yaml'),
      `id: note
name: Note
fields:
  content:
    type: text
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeDefined();
    expect(err && 'error' in err ? err.error : false).toBe(true);
    expect(err && 'error' in err ? err.message : '').toContain('_core');
  });

  it('should load _core from any directory', async () => {
    // dir1: task (no _core)
    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: _core
    fs.writeFileSync(
      path.join(dir2, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);
  });

  it('should resolve inheritance correctly with cross-directory types', async () => {
    // dir1: _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
  created:
    type: datetime
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: story that extends task
    fs.writeFileSync(
      path.join(dir2, 'story.yaml'),
      `id: story
name: Story
extends: task
fields:
  epic:
    type: reference
    ref_type: epic
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    const storyType = registry.getType('story');

    // Verify story has all inherited fields
    expect(storyType?.fields).toHaveProperty('title');
    expect(storyType?.fields).toHaveProperty('created');
    expect(storyType?.fields).toHaveProperty('status');
    expect(storyType?.fields).toHaveProperty('epic');
  });

  it('should handle multiple YAML files in each directory', async () => {
    // dir1: _core, task, note
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    fs.writeFileSync(
      path.join(dir1, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    // dir2: journal, bug-report
    fs.writeFileSync(
      path.join(dir2, 'journal.yaml'),
      `id: journal
name: Journal
extends: _core
fields:
  date:
    type: date
`
    );

    fs.writeFileSync(
      path.join(dir2, 'bug-report.yaml'),
      `id: bug_report
name: Bug Report
extends: task
fields:
  severity:
    type: enum
    values: [low, medium, high]
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    expect(registry.getAllTypes().length).toBe(5); // _core, task, note, journal, bug_report
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);
    expect(registry.hasType('note')).toBe(true);
    expect(registry.hasType('journal')).toBe(true);
    expect(registry.hasType('bug_report')).toBe(true);
  });

  it('should handle circular inheritance detection across directories', async () => {
    // dir1: _core and type A that will create a circle
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'type_a.yaml'),
      `id: type_a
name: Type A
extends: type_b
fields:
  field_a:
    type: string
`
    );

    // dir2: type B that extends type A (creates circle)
    fs.writeFileSync(
      path.join(dir2, 'type_b.yaml'),
      `id: type_b
name: Type B
extends: type_a
fields:
  field_b:
    type: string
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeDefined();
    expect(err && 'error' in err ? err.message : '').toContain('Circular inheritance');
  });

  it('should preserve type order: first directory types have precedence', async () => {
    // Both directories have 'task' type
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task (from vault)
extends: _core
fields:
  priority:
    type: enum
    values: [low, medium, high]
`
    );

    fs.writeFileSync(
      path.join(dir2, 'task.yaml'),
      `id: task
name: Task (from plugin)
extends: _core
fields:
  custom_field:
    type: string
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes([dir1, dir2]);

    expect(err).toBeUndefined();
    const task = registry.getType('task');
    expect(task?.name).toBe('Task (from vault)');
    expect(task?.fields).toHaveProperty('priority');
    expect(task?.fields).not.toHaveProperty('custom_field');
  });
});
