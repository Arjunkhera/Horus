import type { QueryFilter, ParsedQuery, DateRange } from '../types/query.js';

/**
 * Resolve relative date expressions to absolute ISO date strings.
 *
 * @param expr - One of: 'today', 'yesterday', 'tomorrow', 'this week',
 *               'next week', 'this month', 'last 7 days', 'last 30 days'
 * @param now - Reference date (injectable for testing)
 * @returns DateRange with gte/lte ISO date strings, or null if no match
 */
export function resolveDateExpression(expr: string, now = new Date()): DateRange | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  function toISODate(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  const lower = expr.toLowerCase().trim();

  if (lower === 'today') {
    const todayStr = toISODate(today);
    return { gte: todayStr, lte: todayStr };
  }

  if (lower === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const s = toISODate(yesterday);
    return { gte: s, lte: s };
  }

  if (lower === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const s = toISODate(tomorrow);
    return { gte: s, lte: s };
  }

  if (lower === 'this week') {
    // Monday to Sunday of current week
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
    const monday = new Date(today);
    // If today is Sunday (0), go back 6 days; otherwise go back (dayOfWeek - 1) days
    const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(today.getDate() - daysBack);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { gte: toISODate(monday), lte: toISODate(sunday) };
  }

  if (lower === 'next week') {
    const dayOfWeek = today.getDay();
    const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() - daysBack);
    const nextMonday = new Date(currentMonday);
    nextMonday.setDate(currentMonday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    return { gte: toISODate(nextMonday), lte: toISODate(nextSunday) };
  }

  if (lower === 'this month') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { gte: toISODate(firstDay), lte: toISODate(lastDay) };
  }

  if (lower === 'last 7 days') {
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    return { gte: toISODate(weekAgo), lte: toISODate(today) };
  }

  if (lower === 'last 30 days') {
    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);
    return { gte: toISODate(monthAgo), lte: toISODate(today) };
  }

  return null;
}

/**
 * Parse a natural language query into a structured QueryFilter.
 * Pattern-based, rule-based — no LLM required.
 *
 * @param query - The natural language query string
 * @param now - Current date (injectable for testing), defaults to new Date()
 * @returns ParsedQuery with parsedFilter, freeText, and originalQuery
 */
export function parseQuery(query: string, now = new Date()): ParsedQuery {
  const originalQuery = query.trim();

  if (!originalQuery) {
    return {
      originalQuery,
      parsedFilter: {},
      freeText: null,
    };
  }

  let remaining = originalQuery.toLowerCase();
  const filter: QueryFilter = {};

  // 1. Tag matcher - extract FIRST so tags don't interfere with priority matching
  // Pattern 1: tag:tagname or tag:tag1,tag2
  const tagColonRegex = /\btag:([a-zA-Z0-9,_-]+)\b/i;
  const tagColonMatch = tagColonRegex.exec(remaining);
  if (tagColonMatch) {
    const tagStr = tagColonMatch[1];
    filter.tags = tagStr.split(',').map((t) => t.trim());
    remaining = remaining.replace(tagColonRegex, ' ').replace(/\s+/g, ' ').trim();
  }

  // Pattern 2: #tagname
  if (!filter.tags) {
    const hashRegex = /#([a-zA-Z0-9_-]+)/g;
    const matches = remaining.match(hashRegex);
    if (matches) {
      filter.tags = matches.map((m) => m.substring(1));
      remaining = remaining.replace(hashRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Pattern 3: 'tagged tagname'
  if (!filter.tags) {
    const taggedRegex = /\btagged\s+([a-zA-Z0-9_-]+)\b/i;
    const taggedMatch = taggedRegex.exec(remaining);
    if (taggedMatch) {
      filter.tags = [taggedMatch[1]];
      remaining = remaining.replace(taggedRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 2. Type matcher
  // Check for "my [optional words] <type>" pattern BEFORE extracting type, to capture assignee=self
  // Supports "my tasks", "my urgent tasks", "my high priority notes", etc.
  const myTypeRegex = /\bmy\s+(?:\w+\s+)*(?:tasks?|stor(?:y|ies)|notes?|projects?|meetings?|journals?)\b/i;
  if (myTypeRegex.test(remaining)) {
    filter.assignee = 'self';
    remaining = remaining.replace(/\bmy\b/i, ' ').replace(/\s+/g, ' ').trim();
  }

  const typePatterns: Record<string, string> = {
    'tasks?': 'task',
    'notes?': 'note',
    'stor(?:y|ies)': 'story',
    'projects?': 'project',
    'meetings?': 'meeting',
    'persons?|people': 'person',
    'services?': 'service',
    'journals?': 'journal',
  };
  for (const [pattern, value] of Object.entries(typePatterns)) {
    const regex = new RegExp(`\\b(${pattern})\\b`, 'i');
    const match = regex.exec(remaining);
    if (match) {
      filter.type = value;
      remaining = remaining.replace(regex, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // 3. Status matcher
  const statusPatterns: Record<string, string> = {
    'open': 'open',
    'in\\s*-?progress|wip': 'in-progress',
    'blocked': 'blocked',
    'done|completed': 'done',
    'archived': 'archived',
    'cancel(?:led|ed)': 'cancelled',
    'active': 'active',
    'paused': 'paused',
  };
  for (const [pattern, value] of Object.entries(statusPatterns)) {
    const regex = new RegExp(`\\b(${pattern})\\b`, 'i');
    const match = regex.exec(remaining);
    if (match) {
      filter.status = value;
      remaining = remaining.replace(regex, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // 4. Priority matcher - don't match words that are already parsed as tags
  const priorityPatterns: Record<string, string> = {
    'p0|\\bcritical\\b': 'P0-critical',
    'p1|\\burgent\\b|high\\s*priority': 'P1-high',
    'p2|\\bmedium\\b\\s*priority|\\bmedium\\b(?!\\s*priority)': 'P2-medium',
    'p3|\\blow\\b\\s*priority|\\blow\\b(?!\\s*priority)': 'P3-low',
  };
  for (const [pattern, value] of Object.entries(priorityPatterns)) {
    const regex = new RegExp(`\\b(${pattern})\\b`, 'i');
    const match = regex.exec(remaining);
    if (match) {
      filter.priority = value;
      remaining = remaining.replace(regex, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // Clean up known priority word aliases left in remaining after priority matching.
  // e.g. "P0 critical tasks" → P0 matched first, "critical" stays as residue
  if (filter.priority) {
    const priorityAliases: Record<string, string[]> = {
      'P0-critical': ['critical'],
      'P1-high': ['urgent'],
      'P2-medium': [],
      'P3-low': [],
    };
    for (const alias of (priorityAliases[filter.priority] ?? [])) {
      remaining = remaining.replace(new RegExp(`\\b${alias}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 5. Due date matcher
  const dueDatePatterns = [
    'due\\s+today',
    'due\\s+tomorrow',
    'due\\s+yesterday',
    'due\\s+this\\s+week',
    'due\\s+next\\s+week',
    'due\\s+this\\s+month',
    'due\\s+soon',
    'due\\s+in\\s+the\\s+next\\s+7\\s+days',
    'due\\s+in\\s+the\\s+next\\s+30\\s+days',
    'due\\s+last\\s+7\\s+days',
    'overdue',
    'past\\s+due',
  ];

  for (const pattern of dueDatePatterns) {
    const regex = new RegExp(`\\b(${pattern})\\b`, 'i');
    const match = regex.exec(remaining);
    if (match) {
      const matched = match[0].toLowerCase();

      if (matched.includes('overdue') || matched.includes('past due')) {
        const yesterday = new Date(now);
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        filter.due = { lte: yesterdayStr };
      } else if (matched.includes('due soon') || matched.includes('due this month')) {
        const dateRange = resolveDateExpression('this month', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('due today')) {
        const dateRange = resolveDateExpression('today', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('due tomorrow')) {
        const dateRange = resolveDateExpression('tomorrow', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('due yesterday')) {
        const dateRange = resolveDateExpression('yesterday', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('due this week')) {
        const dateRange = resolveDateExpression('this week', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('due next week')) {
        const dateRange = resolveDateExpression('next week', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('next 7')) {
        const dateRange = resolveDateExpression('last 7 days', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('next 30')) {
        const dateRange = resolveDateExpression('last 30 days', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      } else if (matched.includes('last 7')) {
        const dateRange = resolveDateExpression('last 7 days', now);
        if (dateRange) {
          filter.due = dateRange;
        }
      }

      remaining = remaining.replace(regex, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // 6. Assignee matcher - must handle "my tasks" specially
  // Pattern 1: 'assigned to me', 'my tasks', 'mine'
  const selfRegex = /\b(?:assigned\s+to\s+me|my\s+tasks|mine)\b/i;
  if (selfRegex.test(remaining)) {
    filter.assignee = 'self';
    remaining = remaining.replace(selfRegex, ' ').replace(/\s+/g, ' ').trim();
  }

  // Pattern 2: 'assigned to Name'
  if (!filter.assignee) {
    const assignedRegex = /\bassigned\s+to\s+([a-zA-Z0-9\s_-]+?)(?:\s+|$)/i;
    const assignedMatch = assignedRegex.exec(remaining);
    if (assignedMatch) {
      let name = assignedMatch[1].trim();
      // Remove any trailing pattern words
      name = name.replace(/\b(?:due|tag|tagged|at|work|personal|context)\b.*$/, '').trim();
      if (name && name.length > 0) {
        filter.assignee = name.toLowerCase();
        remaining = remaining.replace(assignedRegex, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Pattern 3: 'assignee:Name'
  if (!filter.assignee) {
    const assigneeColonRegex = /\bassignee:([a-zA-Z0-9_-]+)\b/i;
    const assigneeMatch = assigneeColonRegex.exec(remaining);
    if (assigneeMatch) {
      filter.assignee = assigneeMatch[1].toLowerCase();
      remaining = remaining.replace(assigneeColonRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 7. Scope matcher
  // Context patterns run FIRST so 'personal' is captured before 'about X' can grab it.

  // Pattern 1: 'work context' or 'at work'
  const workRegex = /\b(?:work\s+context|at\s+work)\b/i;
  if (workRegex.test(remaining)) {
    filter.scope = { context: 'work' };
    remaining = remaining.replace(workRegex, ' ').replace(/\s+/g, ' ').trim();
  }

  // Pattern 2: 'personal context' (MUST come before standalone 'personal')
  if (!filter.scope) {
    const personalContextRegex = /\bpersonal\s+context\b/i;
    if (personalContextRegex.test(remaining)) {
      filter.scope = { context: 'personal' };
      remaining = remaining.replace(personalContextRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Pattern 3: standalone 'personal'
  if (!filter.scope) {
    const personalRegex = /\bpersonal\b/i;
    if (personalRegex.test(remaining)) {
      filter.scope = { context: 'personal' };
      remaining = remaining.replace(personalRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // Pattern 4: 'about ServiceName' or 'for ServiceName'
  // Always remove the matched text to prevent it becoming freeText,
  // but only SET scope.service if a context scope wasn't already detected above.
  const aboutRegex = /\b(?:about|for)\s+([a-zA-Z0-9\s_-]+?)(?:\s+|$)/i;
  const aboutMatch = aboutRegex.exec(remaining);
  if (aboutMatch) {
    let serviceName = aboutMatch[1].trim();
    // Remove any trailing pattern words that might have been caught
    serviceName = serviceName.replace(/\b(?:due|tag|tagged|assigned|assignee|at|work|context)\b.*$/, '').trim();
    if (serviceName && serviceName.length > 0) {
      if (!filter.scope) {
        filter.scope = { service: serviceName.toLowerCase() };
      }
      // Always consume the 'about/for X' text so it doesn't become freeText
      remaining = remaining.replace(aboutRegex, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  const freeText = remaining.length > 0 ? remaining.trim() : null;
  if (freeText) {
    filter.query = freeText;
  }

  return {
    originalQuery,
    parsedFilter: filter,
    freeText,
  };
}
