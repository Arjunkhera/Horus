// Parse and convert Obsidian dataview inline fields

export type DataviewField = {
  field: string;   // field name
  value: string;   // raw value string
  lineIndex: number;  // line number in body
};

/**
 * Extract dataview inline fields from markdown body.
 * Regex: /^([a-zA-Z_][a-zA-Z0-9_]*)::\s*(.+)$/gm
 * Returns array of fields found.
 */
export function extractDataviewFields(body: string): DataviewField[] {
  const fields: DataviewField[] = [];
  const regex = /^([a-zA-Z_][a-zA-Z0-9_]*)::\s*(.+)$/gm;
  const lines = body.split('\n');
  let lineIndex = 0;

  for (const line of lines) {
    // Reset regex lastIndex for this line
    regex.lastIndex = 0;
    const match = regex.exec(line);

    if (match) {
      fields.push({
        field: match[1],
        value: match[2],
        lineIndex,
      });
    }

    lineIndex++;
  }

  return fields;
}

/**
 * Convert dataview inline fields.
 * Remove the inline field lines from body.
 * Return cleaned body and dict of field name → value.
 */
export function convertDataviewFields(
  body: string,
  fields: DataviewField[],
): { newBody: string; convertedFields: Record<string, string> } {
  const convertedFields: Record<string, string> = {};
  const linesToRemove = new Set<number>();

  // Build converted fields dict and mark lines for removal
  for (const field of fields) {
    convertedFields[field.field] = field.value;
    linesToRemove.add(field.lineIndex);
  }

  // Rebuild body, skipping lines that are dataview fields
  const lines = body.split('\n');
  const newLines = lines.filter((_, index) => !linesToRemove.has(index));
  const newBody = newLines.join('\n');

  return { newBody, convertedFields };
}
