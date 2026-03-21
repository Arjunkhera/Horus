// Migration report generation

export type FileStatus = 'ok' | 'skipped' | 'error';

export type FileMigrationResult = {
  filePath: string;
  status: FileStatus;
  noteIdAdded: boolean;
  typeAssigned: string | null;
  dataviewFieldsConverted: string[];
  warnings: string[];
  error?: string;
};

export type MigrationReport = {
  totalFiles: number;
  processed: number;
  noteIdsAdded: number;
  typesAssigned: number;
  dataviewFieldsConverted: number;
  warnings: string[];
  errors: string[];
  files: FileMigrationResult[];
};

/**
 * Create an empty migration report.
 */
export function createEmptyReport(): MigrationReport {
  return {
    totalFiles: 0,
    processed: 0,
    noteIdsAdded: 0,
    typesAssigned: 0,
    dataviewFieldsConverted: 0,
    warnings: [],
    errors: [],
    files: [],
  };
}

/**
 * Add a file result to the report and update counters.
 */
export function addFileResult(
  report: MigrationReport,
  result: FileMigrationResult,
): void {
  report.files.push(result);

  if (result.status !== 'error') {
    report.processed++;
  }

  if (result.noteIdAdded) {
    report.noteIdsAdded++;
  }

  if (result.typeAssigned) {
    report.typesAssigned++;
  }

  report.dataviewFieldsConverted += result.dataviewFieldsConverted.length;

  // Accumulate warnings and errors
  report.warnings.push(...result.warnings);
  if (result.error) {
    report.errors.push(result.error);
  }
}

/**
 * Format migration report as human-readable summary.
 */
export function formatReportSummary(report: MigrationReport): string {
  const lines: string[] = [
    '# Migration Report Summary',
    `Total files scanned: ${report.totalFiles}`,
    `Successfully processed: ${report.processed}`,
    `Note IDs added: ${report.noteIdsAdded}`,
    `Types assigned: ${report.typesAssigned}`,
    `Dataview fields converted: ${report.dataviewFieldsConverted}`,
  ];

  if (report.warnings.length > 0) {
    lines.push(`Warnings: ${report.warnings.length}`);
  }

  if (report.errors.length > 0) {
    lines.push(`Errors: ${report.errors.length}`);
  }

  return lines.join('\n');
}

/**
 * Format migration report as full markdown.
 */
export function formatReportMarkdown(report: MigrationReport): string {
  const lines: string[] = [
    '# Migration Report',
    '',
    '## Summary',
    `- Total files scanned: ${report.totalFiles}`,
    `- Successfully processed: ${report.processed}`,
    `- Note IDs added: ${report.noteIdsAdded}`,
    `- Types assigned: ${report.typesAssigned}`,
    `- Dataview fields converted: ${report.dataviewFieldsConverted}`,
    '',
  ];

  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push('## Errors');
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
    lines.push('');
  }

  if (report.files.length > 0) {
    lines.push('## Files');
    lines.push('');
    for (const file of report.files) {
      lines.push(`### ${file.filePath}`);
      lines.push(`- Status: ${file.status}`);
      if (file.noteIdAdded) {
        lines.push('- Note ID added: yes');
      }
      if (file.typeAssigned) {
        lines.push(`- Type assigned: ${file.typeAssigned}`);
      }
      if (file.dataviewFieldsConverted.length > 0) {
        lines.push(`- Dataview fields converted: ${file.dataviewFieldsConverted.join(', ')}`);
      }
      if (file.warnings.length > 0) {
        lines.push(`- Warnings: ${file.warnings.join('; ')}`);
      }
      if (file.error) {
        lines.push(`- Error: ${file.error}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
