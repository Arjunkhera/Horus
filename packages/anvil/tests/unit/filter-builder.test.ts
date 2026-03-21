import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseQuery, resolveDateExpression } from '../../src/search/filter-builder.js';
import type { ParsedQuery, QueryFilter } from '../../src/types/query.js';

describe('filter-builder', () => {
  /**
   * Test helpers
   */
  function expectFilter(result: ParsedQuery, expectedFilter: Partial<QueryFilter>) {
    expect(result.parsedFilter).toEqual(expectedFilter);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // Set to Monday, Feb 23, 2026 at midnight UTC
    vi.setSystemTime(new Date('2026-02-23T00:00:00Z'));
  });

  describe('Type patterns', () => {
    it('should parse "task" as type:task', () => {
      const result = parseQuery('task');
      expectFilter(result, { type: 'task' });
      expect(result.freeText).toBeNull();
    });

    it('should parse "tasks" as type:task (plural)', () => {
      const result = parseQuery('tasks');
      expectFilter(result, { type: 'task' });
      expect(result.freeText).toBeNull();
    });

    it('should parse "note" as type:note', () => {
      const result = parseQuery('note');
      expectFilter(result, { type: 'note' });
    });

    it('should parse "notes" as type:note', () => {
      const result = parseQuery('notes');
      expectFilter(result, { type: 'note' });
    });

    it('should parse "story" as type:story', () => {
      const result = parseQuery('story');
      expectFilter(result, { type: 'story' });
    });

    it('should parse "stories" as type:story', () => {
      const result = parseQuery('stories');
      expectFilter(result, { type: 'story' });
    });

    it('should parse "project" as type:project', () => {
      const result = parseQuery('project');
      expectFilter(result, { type: 'project' });
    });

    it('should parse "projects" as type:project', () => {
      const result = parseQuery('projects');
      expectFilter(result, { type: 'project' });
    });

    it('should parse "meeting" as type:meeting', () => {
      const result = parseQuery('meeting');
      expectFilter(result, { type: 'meeting' });
    });

    it('should parse "meetings" as type:meeting', () => {
      const result = parseQuery('meetings');
      expectFilter(result, { type: 'meeting' });
    });

    it('should parse "person" as type:person', () => {
      const result = parseQuery('person');
      expectFilter(result, { type: 'person' });
    });

    it('should parse "persons" as type:person', () => {
      const result = parseQuery('persons');
      expectFilter(result, { type: 'person' });
    });

    it('should parse "people" as type:person', () => {
      const result = parseQuery('people');
      expectFilter(result, { type: 'person' });
    });

    it('should parse "service" as type:service', () => {
      const result = parseQuery('service');
      expectFilter(result, { type: 'service' });
    });

    it('should parse "services" as type:service', () => {
      const result = parseQuery('services');
      expectFilter(result, { type: 'service' });
    });

    it('should parse "journal" as type:journal', () => {
      const result = parseQuery('journal');
      expectFilter(result, { type: 'journal' });
    });

    it('should parse "journals" as type:journal', () => {
      const result = parseQuery('journals');
      expectFilter(result, { type: 'journal' });
    });
  });

  describe('Status patterns', () => {
    it('should parse "open" as status:open', () => {
      const result = parseQuery('open');
      expectFilter(result, { status: 'open' });
    });

    it('should parse "in progress" as status:in-progress', () => {
      const result = parseQuery('in progress');
      expectFilter(result, { status: 'in-progress' });
    });

    it('should parse "in-progress" as status:in-progress', () => {
      const result = parseQuery('in-progress');
      expectFilter(result, { status: 'in-progress' });
    });

    it('should parse "wip" as status:in-progress', () => {
      const result = parseQuery('wip');
      expectFilter(result, { status: 'in-progress' });
    });

    it('should parse "blocked" as status:blocked', () => {
      const result = parseQuery('blocked');
      expectFilter(result, { status: 'blocked' });
    });

    it('should parse "done" as status:done', () => {
      const result = parseQuery('done');
      expectFilter(result, { status: 'done' });
    });

    it('should parse "completed" as status:done', () => {
      const result = parseQuery('completed');
      expectFilter(result, { status: 'done' });
    });

    it('should parse "archived" as status:archived', () => {
      const result = parseQuery('archived');
      expectFilter(result, { status: 'archived' });
    });

    it('should parse "cancelled" as status:cancelled', () => {
      const result = parseQuery('cancelled');
      expectFilter(result, { status: 'cancelled' });
    });

    it('should parse "canceled" as status:cancelled', () => {
      const result = parseQuery('canceled');
      expectFilter(result, { status: 'cancelled' });
    });

    it('should parse "active" as status:active', () => {
      const result = parseQuery('active');
      expectFilter(result, { status: 'active' });
    });

    it('should parse "paused" as status:paused', () => {
      const result = parseQuery('paused');
      expectFilter(result, { status: 'paused' });
    });
  });

  describe('Priority patterns', () => {
    it('should parse "P0" as priority:P0-critical', () => {
      const result = parseQuery('P0');
      expectFilter(result, { priority: 'P0-critical' });
    });

    it('should parse "p0" as priority:P0-critical (case-insensitive)', () => {
      const result = parseQuery('p0');
      expectFilter(result, { priority: 'P0-critical' });
    });

    it('should parse "critical" as priority:P0-critical', () => {
      const result = parseQuery('critical');
      expectFilter(result, { priority: 'P0-critical' });
    });

    it('should parse "P1" as priority:P1-high', () => {
      const result = parseQuery('P1');
      expectFilter(result, { priority: 'P1-high' });
    });

    it('should parse "p1" as priority:P1-high', () => {
      const result = parseQuery('p1');
      expectFilter(result, { priority: 'P1-high' });
    });

    it('should parse "urgent" as priority:P1-high', () => {
      const result = parseQuery('urgent');
      expectFilter(result, { priority: 'P1-high' });
    });

    it('should parse "high priority" as priority:P1-high', () => {
      const result = parseQuery('high priority');
      expectFilter(result, { priority: 'P1-high' });
    });

    it('should parse "P2" as priority:P2-medium', () => {
      const result = parseQuery('P2');
      expectFilter(result, { priority: 'P2-medium' });
    });

    it('should parse "p2" as priority:P2-medium', () => {
      const result = parseQuery('p2');
      expectFilter(result, { priority: 'P2-medium' });
    });

    it('should parse "medium" as priority:P2-medium', () => {
      const result = parseQuery('medium');
      expectFilter(result, { priority: 'P2-medium' });
    });

    it('should parse "medium priority" as priority:P2-medium', () => {
      const result = parseQuery('medium priority');
      expectFilter(result, { priority: 'P2-medium' });
    });

    it('should parse "P3" as priority:P3-low', () => {
      const result = parseQuery('P3');
      expectFilter(result, { priority: 'P3-low' });
    });

    it('should parse "p3" as priority:P3-low', () => {
      const result = parseQuery('p3');
      expectFilter(result, { priority: 'P3-low' });
    });

    it('should parse "low" as priority:P3-low', () => {
      const result = parseQuery('low');
      expectFilter(result, { priority: 'P3-low' });
    });

    it('should parse "low priority" as priority:P3-low', () => {
      const result = parseQuery('low priority');
      expectFilter(result, { priority: 'P3-low' });
    });
  });

  describe('Tag patterns', () => {
    it('should parse "tag:urgent" as tags:[urgent]', () => {
      const result = parseQuery('tag:urgent');
      expectFilter(result, { tags: ['urgent'] });
    });

    it('should parse "#urgent" as tags:[urgent]', () => {
      const result = parseQuery('#urgent');
      expectFilter(result, { tags: ['urgent'] });
    });

    it('should parse "tagged urgent" as tags:[urgent]', () => {
      const result = parseQuery('tagged urgent');
      expectFilter(result, { tags: ['urgent'] });
    });

    it('should parse "tag:work,personal" as tags:[work, personal]', () => {
      const result = parseQuery('tag:work,personal');
      expectFilter(result, { tags: ['work', 'personal'] });
    });

    it('should parse multiple hash tags "#work #personal"', () => {
      const result = parseQuery('#work #personal');
      expectFilter(result, { tags: ['work', 'personal'] });
    });
  });

  describe('Due date patterns', () => {
    it('should parse "due today"', () => {
      const result = parseQuery('due today');
      expectFilter(result, { due: { gte: '2026-02-23', lte: '2026-02-23' } });
    });

    it('should parse "due tomorrow"', () => {
      const result = parseQuery('due tomorrow');
      expectFilter(result, { due: { gte: '2026-02-24', lte: '2026-02-24' } });
    });

    it('should parse "due yesterday"', () => {
      const result = parseQuery('due yesterday');
      expectFilter(result, { due: { gte: '2026-02-22', lte: '2026-02-22' } });
    });

    it('should parse "due this week" (Monday to Sunday)', () => {
      const result = parseQuery('due this week');
      // 2026-02-23 is Monday, so this week = 2026-02-23 to 2026-03-01
      expectFilter(result, { due: { gte: '2026-02-23', lte: '2026-03-01' } });
    });

    it('should parse "due next week"', () => {
      const result = parseQuery('due next week');
      // Next week starts Monday 2026-03-02, ends Sunday 2026-03-08
      expectFilter(result, { due: { gte: '2026-03-02', lte: '2026-03-08' } });
    });

    it('should parse "due this month"', () => {
      const result = parseQuery('due this month');
      expectFilter(result, { due: { gte: '2026-02-01', lte: '2026-02-28' } });
    });

    it('should parse "overdue"', () => {
      const result = parseQuery('overdue');
      // Yesterday = 2026-02-22
      expectFilter(result, { due: { lte: '2026-02-22' } });
    });

    it('should parse "past due"', () => {
      const result = parseQuery('past due');
      expectFilter(result, { due: { lte: '2026-02-22' } });
    });
  });

  describe('Scope patterns', () => {
    it('should parse "about Onboarding" as scope:service (lowercased)', () => {
      const result = parseQuery('about Onboarding');
      expectFilter(result, { scope: { service: 'onboarding' } });
    });

    it('should parse "for Dashboard" as scope:service (lowercased)', () => {
      const result = parseQuery('for Dashboard');
      expectFilter(result, { scope: { service: 'dashboard' } });
    });

    it('should parse "at work" as scope:context:work', () => {
      const result = parseQuery('at work');
      expectFilter(result, { scope: { context: 'work' } });
    });

    it('should parse "work context" as scope:context:work', () => {
      const result = parseQuery('work context');
      expectFilter(result, { scope: { context: 'work' } });
    });

    it('should parse "personal" as scope:context:personal', () => {
      const result = parseQuery('personal');
      expectFilter(result, { scope: { context: 'personal' } });
    });

    it('should parse "personal context" as scope:context:personal', () => {
      const result = parseQuery('personal context');
      expectFilter(result, { scope: { context: 'personal' } });
    });
  });

  describe('Assignee patterns', () => {
    it('should parse "assigned to me" as assignee:self', () => {
      const result = parseQuery('assigned to me');
      expectFilter(result, { assignee: 'self' });
    });

    it('should parse "my tasks" as assignee:self + type:task', () => {
      const result = parseQuery('my tasks');
      expectFilter(result, { assignee: 'self', type: 'task' });
    });

    it('should parse "mine" as assignee:self', () => {
      const result = parseQuery('mine');
      expectFilter(result, { assignee: 'self' });
    });

    it('should parse "assigned to Alice" (lowercased)', () => {
      const result = parseQuery('assigned to Alice');
      expectFilter(result, { assignee: 'alice' });
    });

    it('should parse "assignee:Bob" (lowercased)', () => {
      const result = parseQuery('assignee:Bob');
      expectFilter(result, { assignee: 'bob' });
    });
  });

  describe('Compound queries', () => {
    it('should parse "open tasks"', () => {
      const result = parseQuery('open tasks');
      expectFilter(result, { status: 'open', type: 'task' });
      expect(result.freeText).toBeNull();
    });

    it('should parse "blocked stories"', () => {
      const result = parseQuery('blocked stories');
      expectFilter(result, { status: 'blocked', type: 'story' });
    });

    it('should parse "urgent tasks due this week"', () => {
      const result = parseQuery('urgent tasks due this week');
      expectFilter(result, {
        priority: 'P1-high',
        type: 'task',
        due: { gte: '2026-02-23', lte: '2026-03-01' },
      });
    });

    it('should parse "my urgent tasks"', () => {
      const result = parseQuery('my urgent tasks');
      expectFilter(result, {
        assignee: 'self',
        priority: 'P1-high',
        type: 'task',
      });
    });

    it('should parse "P0 critical tasks" (both map to critical)', () => {
      const result = parseQuery('P0 critical tasks');
      // Should only extract one priority (the first match)
      expectFilter(result, {
        priority: 'P0-critical',
        type: 'task',
      });
    });

    it('should parse "done notes about onboarding"', () => {
      const result = parseQuery('done notes about onboarding');
      expectFilter(result, {
        status: 'done',
        type: 'note',
        scope: { service: 'onboarding' },
      });
    });
  });

  describe('Case insensitivity', () => {
    it('should parse "OPEN" as status:open', () => {
      const result = parseQuery('OPEN');
      expectFilter(result, { status: 'open' });
    });

    it('should parse "Open Tasks" as open + task (case-insensitive)', () => {
      const result = parseQuery('Open Tasks');
      expectFilter(result, { status: 'open', type: 'task' });
    });

    it('should parse "BLOCKED TASKS"', () => {
      const result = parseQuery('BLOCKED TASKS');
      expectFilter(result, { status: 'blocked', type: 'task' });
    });

    it('should parse "Urgent Tasks Due This Week"', () => {
      const result = parseQuery('Urgent Tasks Due This Week');
      expectFilter(result, {
        priority: 'P1-high',
        type: 'task',
        due: { gte: '2026-02-23', lte: '2026-03-01' },
      });
    });
  });

  describe('Free text pass-through', () => {
    it('should handle "authentication tasks" as task + free text', () => {
      const result = parseQuery('authentication tasks');
      expect(result.parsedFilter.type).toBe('task');
      expect(result.freeText).toBe('authentication');
      expect(result.parsedFilter.query).toBe('authentication');
    });

    it('should handle "random gibberish xyz" as pure free text', () => {
      const result = parseQuery('random gibberish xyz');
      expect(result.parsedFilter.query).toBe('random gibberish xyz');
      expect(result.freeText).toBe('random gibberish xyz');
    });

    it('should handle empty query', () => {
      const result = parseQuery('');
      expectFilter(result, {});
      expect(result.freeText).toBeNull();
    });

    it('should handle "   " (whitespace only)', () => {
      const result = parseQuery('   ');
      expectFilter(result, {});
      expect(result.freeText).toBeNull();
    });
  });

  describe('resolveDateExpression', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date('2026-02-23T00:00:00Z')); // Monday
    });

    it('should resolve "today"', () => {
      const result = resolveDateExpression('today');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-02-23' });
    });

    it('should resolve "yesterday"', () => {
      const result = resolveDateExpression('yesterday');
      expect(result).toEqual({ gte: '2026-02-22', lte: '2026-02-22' });
    });

    it('should resolve "tomorrow"', () => {
      const result = resolveDateExpression('tomorrow');
      expect(result).toEqual({ gte: '2026-02-24', lte: '2026-02-24' });
    });

    it('should resolve "this week" (Monday to Sunday)', () => {
      const result = resolveDateExpression('this week');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-03-01' });
    });

    it('should resolve "this week" correctly when called on different days', () => {
      // Tuesday
      vi.setSystemTime(new Date('2026-02-24T00:00:00Z'));
      const result = resolveDateExpression('this week');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-03-01' });
    });

    it('should resolve "this week" correctly on Sunday', () => {
      // Sunday
      vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
      const result = resolveDateExpression('this week');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-03-01' });
    });

    it('should resolve "next week"', () => {
      const result = resolveDateExpression('next week');
      expect(result).toEqual({ gte: '2026-03-02', lte: '2026-03-08' });
    });

    it('should resolve "this month"', () => {
      const result = resolveDateExpression('this month');
      expect(result).toEqual({ gte: '2026-02-01', lte: '2026-02-28' });
    });

    it('should resolve "this month" in a month with 31 days', () => {
      vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
      const result = resolveDateExpression('this month');
      expect(result).toEqual({ gte: '2026-01-01', lte: '2026-01-31' });
    });

    it('should resolve "last 7 days"', () => {
      const result = resolveDateExpression('last 7 days');
      expect(result).toEqual({ gte: '2026-02-16', lte: '2026-02-23' });
    });

    it('should resolve "last 30 days"', () => {
      const result = resolveDateExpression('last 30 days');
      expect(result).toEqual({ gte: '2026-01-24', lte: '2026-02-23' });
    });

    it('should return null for unknown expression', () => {
      const result = resolveDateExpression('unknown date');
      expect(result).toBeNull();
    });

    it('should be case-insensitive', () => {
      const result = resolveDateExpression('TODAY');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-02-23' });
    });

    it('should handle whitespace', () => {
      const result = resolveDateExpression('  today  ');
      expect(result).toEqual({ gte: '2026-02-23', lte: '2026-02-23' });
    });
  });

  describe('Edge cases', () => {
    it('should not match partial words', () => {
      const result = parseQuery('taskforce');
      // 'taskforce' should NOT match 'task' as a whole word
      expectFilter(result, { query: 'taskforce' });
    });

    it('should handle hyphenated status names', () => {
      const result = parseQuery('in-progress');
      expectFilter(result, { status: 'in-progress' });
    });

    it('should handle multiple spaces between words', () => {
      const result = parseQuery('open    tasks');
      expectFilter(result, { status: 'open', type: 'task' });
    });
  });

  describe('Complex real-world scenarios', () => {
    it('should parse "my high priority tasks due today"', () => {
      const result = parseQuery('my high priority tasks due today');
      expectFilter(result, {
        assignee: 'self',
        priority: 'P1-high',
        type: 'task',
        due: { gte: '2026-02-23', lte: '2026-02-23' },
      });
    });

    it('should parse "blocked urgent stories #critical"', () => {
      const result = parseQuery('blocked urgent stories #critical');
      expectFilter(result, {
        status: 'blocked',
        priority: 'P1-high',
        type: 'story',
        tags: ['critical'],
      });
    });

    it('should parse "personal notes about fitness due this week"', () => {
      const result = parseQuery('personal notes about fitness due this week');
      expectFilter(result, {
        scope: { context: 'personal' },
        type: 'note',
        scope: { context: 'personal' },
        due: { gte: '2026-02-23', lte: '2026-03-01' },
      });
    });

    it('should parse "meetings assigned to Alice at work overdue"', () => {
      const result = parseQuery('meetings assigned to Alice at work overdue');
      expectFilter(result, {
        type: 'meeting',
        assignee: 'alice',
        scope: { context: 'work' },
        due: { lte: '2026-02-22' },
      });
    });
  });

  describe('Matcher order and interactions', () => {
    it('should apply matchers in correct order (type, status, priority, tag, due, scope, assignee)', () => {
      const result = parseQuery(
        'assigned to me tag:urgent P1 done tasks due tomorrow'
      );
      // Check that all patterns are extracted regardless of order
      expect(result.parsedFilter.assignee).toBe('self');
      expect(result.parsedFilter.tags).toEqual(['urgent']);
      expect(result.parsedFilter.priority).toBe('P1-high');
      expect(result.parsedFilter.status).toBe('done');
      expect(result.parsedFilter.type).toBe('task');
      expect(result.parsedFilter.due).toEqual({
        gte: '2026-02-24',
        lte: '2026-02-24',
      });
    });
  });
});
