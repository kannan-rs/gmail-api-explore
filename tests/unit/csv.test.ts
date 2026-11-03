import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/http/csv';

describe('CSV export', () => {
  it('escapes commas, quotes, and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://example.com")')).toBe(
      '"\'=HYPERLINK(""http://example.com"")"',
    );
    expect(csvCell('+123')).toBe("'+123");
    expect(csvCell('-123')).toBe("'-123");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('renders null values as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('builds a header and rows with CRLF endings', () => {
    const csv = toCsv(
      [
        { key: 'id', header: 'ID' },
        { key: 'subject', header: 'Subject' },
      ],
      [{ id: 'send-1', subject: 'Hello, world' }],
    );

    expect(csv).toBe('ID,Subject\r\nsend-1,"Hello, world"\r\n');
  });
});
