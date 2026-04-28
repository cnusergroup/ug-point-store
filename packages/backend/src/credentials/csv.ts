// CSV parser/formatter for community credentials — RFC 4180 compliant

export interface CsvCredentialRow {
  recipientName: string;
  role: string;
  eventName: string;
  locale?: 'zh' | 'en';
  eventDate?: string;
  eventLocation?: string;
  contribution?: string;
  issuingOrganization?: string;
}

export interface CsvParseResult {
  rows: CsvCredentialRow[];
  errors: Array<{ line: number; message: string }>;
}

const VALID_ROLES: readonly string[] = ['Volunteer', 'Speaker', 'Workshop', 'Organizer'];
const VALID_LOCALES: readonly string[] = ['zh', 'en'];

const EXPECTED_HEADERS = [
  'recipientName',
  'role',
  'eventName',
  'locale',
  'eventDate',
  'eventLocation',
  'contribution',
  'issuingOrganization',
];

/**
 * Strip UTF-8 BOM (U+FEFF) from the start of a string.
 */
function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Parse a CSV string into an array of field arrays, one per record.
 * Handles RFC 4180 quoting: fields may be enclosed in double-quotes,
 * and embedded quotes are escaped by doubling ("").
 * Quoted fields may contain commas, newlines (\r\n or \n), and quotes.
 */
function parseRfc4180(csv: string): string[][] {
  const records: string[][] = [];
  let i = 0;
  const len = csv.length;

  // Handle empty input
  if (len === 0) {
    return records;
  }

  while (i <= len) {
    const fields: string[] = [];

    // Parse one record (line)
    while (true) {
      if (i >= len) {
        // End of input — push empty field only if we already started a record
        fields.push('');
        break;
      }

      if (csv[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        let field = '';
        while (i < len) {
          if (csv[i] === '"') {
            if (i + 1 < len && csv[i + 1] === '"') {
              // Escaped quote
              field += '"';
              i += 2;
            } else {
              // Closing quote
              i++; // skip closing quote
              break;
            }
          } else {
            field += csv[i];
            i++;
          }
        }
        fields.push(field);

        // After closing quote, expect comma, newline, or end of input
        if (i < len && csv[i] === ',') {
          i++; // skip comma, continue to next field
          continue;
        }
      } else {
        // Unquoted field — read until comma or newline or end
        let field = '';
        while (i < len && csv[i] !== ',' && csv[i] !== '\r' && csv[i] !== '\n') {
          field += csv[i];
          i++;
        }
        fields.push(field);

        if (i < len && csv[i] === ',') {
          i++; // skip comma, continue to next field
          continue;
        }
      }

      // End of record: consume newline(s)
      if (i < len && csv[i] === '\r') {
        i++;
      }
      if (i < len && csv[i] === '\n') {
        i++;
      }
      break;
    }

    records.push(fields);

    // If we've consumed everything and the last character was a newline,
    // don't add an extra empty record
    if (i >= len) {
      break;
    }
  }

  return records;
}

/**
 * Parse a CSV string into structured credential rows.
 *
 * - Strips UTF-8 BOM
 * - Handles RFC 4180 quoting (commas, newlines, escaped quotes in fields)
 * - Returns empty rows array for empty or header-only CSV
 * - Validates each data row and collects errors
 */
export function parseCsv(csvContent: string): CsvParseResult {
  const content = stripBom(csvContent).trim();

  if (content === '') {
    return { rows: [], errors: [] };
  }

  const records = parseRfc4180(content);

  if (records.length === 0) {
    return { rows: [], errors: [] };
  }

  // First record is the header
  const headers = records[0].map((h) => h.trim());

  if (records.length <= 1) {
    // Header-only CSV
    return { rows: [], errors: [] };
  }

  const rows: CsvCredentialRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let r = 1; r < records.length; r++) {
    const fields = records[r];
    const lineNumber = r + 1; // 1-based, header is line 1

    // Skip completely empty rows (all fields empty or whitespace)
    if (fields.every((f) => f.trim() === '')) {
      continue;
    }

    // Build a record object from headers
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      const value = c < fields.length ? fields[c].trim() : '';
      if (header) {
        record[header] = value;
      }
    }

    const result = validateRow(record, lineNumber);
    if (result.valid) {
      rows.push(result.data);
    } else {
      errors.push({ line: lineNumber, message: result.error });
    }
  }

  return { rows, errors };
}

/**
 * Validate a single row of CSV data.
 *
 * Checks:
 * - recipientName is required (non-empty)
 * - role is required and must be one of Volunteer, Speaker, Workshop, Organizer
 * - eventName is required (non-empty)
 * - locale, if provided, must be zh or en
 */
export function validateRow(
  row: Record<string, string>,
  lineNumber: number,
): { valid: true; data: CsvCredentialRow } | { valid: false; error: string } {
  const recipientName = (row.recipientName ?? '').trim();
  const role = (row.role ?? '').trim();
  const eventName = (row.eventName ?? '').trim();
  const locale = (row.locale ?? '').trim();
  const eventDate = (row.eventDate ?? '').trim();
  const eventLocation = (row.eventLocation ?? '').trim();
  const contribution = (row.contribution ?? '').trim();
  const issuingOrganization = (row.issuingOrganization ?? '').trim();

  // Required field checks
  if (!recipientName) {
    return { valid: false, error: `Line ${lineNumber}: missing required field "recipientName"` };
  }
  if (!role) {
    return { valid: false, error: `Line ${lineNumber}: missing required field "role"` };
  }
  if (!eventName) {
    return { valid: false, error: `Line ${lineNumber}: missing required field "eventName"` };
  }

  // Role validation
  if (!VALID_ROLES.includes(role)) {
    return {
      valid: false,
      error: `Line ${lineNumber}: invalid role "${role}", must be one of ${VALID_ROLES.join(', ')}`,
    };
  }

  // Locale validation (optional, but if provided must be valid)
  if (locale && !VALID_LOCALES.includes(locale)) {
    return {
      valid: false,
      error: `Line ${lineNumber}: invalid locale "${locale}", must be one of ${VALID_LOCALES.join(', ')}`,
    };
  }

  const data: CsvCredentialRow = {
    recipientName,
    role,
    eventName,
  };

  if (locale) data.locale = locale as 'zh' | 'en';
  if (eventDate) data.eventDate = eventDate;
  if (eventLocation) data.eventLocation = eventLocation;
  if (contribution) data.contribution = contribution;
  if (issuingOrganization) data.issuingOrganization = issuingOrganization;

  return { valid: true, data };
}

/**
 * Quote a CSV field if it contains special characters (comma, quote, newline).
 * Quotes are escaped by doubling them.
 */
function quoteField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Format an array of credential rows back to a CSV string.
 *
 * - Always includes the header row
 * - Quotes fields that contain commas, quotes, or newlines
 * - Uses \n line endings
 */
export function formatCsv(rows: CsvCredentialRow[]): string {
  const header = EXPECTED_HEADERS.join(',');
  const lines = [header];

  for (const row of rows) {
    const fields = EXPECTED_HEADERS.map((h) => {
      const value = (row as Record<string, string | undefined>)[h] ?? '';
      return quoteField(value);
    });
    lines.push(fields.join(','));
  }

  return lines.join('\n') + '\n';
}
