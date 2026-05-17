/**
 * Streaming event log.
 *
 * Collects EventLogEntry objects and optionally streams them to stdout as NDJSON.
 * The corpus-ready format is defined in @horus/testenv (EventLogEntrySchema / RunResultSchema).
 */

import type { EventLogEntry, EventSeverity, PhaseId } from '@akhera-horus/testenv';

export interface EventLogOptions {
  /** If true, emit each event to stdout as NDJSON immediately. Default: true. */
  stream?: boolean;
  /** Redactor function — applied to message and payload before emission. */
  redact?: (s: string) => string;
}

export class EventLog {
  private readonly entries: EventLogEntry[] = [];
  private readonly stream: boolean;
  private readonly redact: (s: string) => string;

  constructor(opts: EventLogOptions = {}) {
    this.stream = opts.stream ?? true;
    this.redact = opts.redact ?? ((s) => s);
  }

  emit(
    severity: EventSeverity,
    phase: PhaseId,
    message: string,
    opts?: { action?: string; payload?: Record<string, unknown> },
  ): void {
    const entry: EventLogEntry = {
      ts: new Date().toISOString(),
      severity,
      phase,
      action: opts?.action,
      message: this.redact(message),
      payload: opts?.payload
        ? (JSON.parse(this.redact(JSON.stringify(opts.payload))) as Record<string, unknown>)
        : undefined,
    };
    this.entries.push(entry);

    if (this.stream) {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
  }

  info(phase: PhaseId, message: string, opts?: { action?: string; payload?: Record<string, unknown> }): void {
    this.emit('info', phase, message, opts);
  }

  warn(phase: PhaseId, message: string, opts?: { action?: string; payload?: Record<string, unknown> }): void {
    this.emit('warn', phase, message, opts);
  }

  error(phase: PhaseId, message: string, opts?: { action?: string; payload?: Record<string, unknown> }): void {
    this.emit('error', phase, message, opts);
  }

  debug(phase: PhaseId, message: string, opts?: { action?: string; payload?: Record<string, unknown> }): void {
    this.emit('debug', phase, message, opts);
  }

  getEntries(): EventLogEntry[] {
    return [...this.entries];
  }
}
