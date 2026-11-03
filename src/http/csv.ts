export interface CsvColumn {
  key: string;
  header: string;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
