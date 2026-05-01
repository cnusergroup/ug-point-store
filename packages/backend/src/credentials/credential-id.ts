// Credential ID generation, parsing, and validation module

export interface CredentialIdComponents {
  eventPrefix: string; // e.g. "ACD-BASE"
  year: string; // e.g. "2026"
  season: string; // e.g. "Summer"
  roleCode: string; // e.g. "VOL"
  sequence: number; // e.g. 2
}

/**
 * Regex for parsing a credential ID string.
 *
 * Groups:
 *  1 – eventPrefix  (uppercase letters, may contain hyphens between letters)
 *  2 – year         (4 digits)
 *  3 – season       (Spring|Summer|Fall|Winter)
 *  4 – roleCode     (VOL|SPK|WKS|ORG)
 *  5 – sequence     (4 digits, zero-padded)
 */
const CREDENTIAL_ID_REGEX =
  /^([A-Z](?:[A-Z-]*[A-Z])?)-(\d{4})-(Spring|Summer|Fall|Winter)-(VOL|SPK|WKS|ORG)-(\d{4})$/;

/**
 * Format credential ID components into a string.
 *
 * Example: { eventPrefix: "ACD-BASE", year: "2026", season: "Summer", roleCode: "VOL", sequence: 2 }
 *        → "ACD-BASE-2026-Summer-VOL-0002"
 */
export function formatCredentialId(components: CredentialIdComponents): string {
  const { eventPrefix, year, season, roleCode, sequence } = components;
  const paddedSeq = String(sequence).padStart(4, '0');
  return `${eventPrefix}-${year}-${season}-${roleCode}-${paddedSeq}`;
}

/**
 * Parse a credential ID string back into its components.
 *
 * Throws an error with a descriptive message when the ID is invalid.
 */
export function parseCredentialId(id: string): CredentialIdComponents {
  const result = validateCredentialId(id);
  if (!result.valid) {
    throw new Error(result.error);
  }

  const match = CREDENTIAL_ID_REGEX.exec(id)!;
  return {
    eventPrefix: match[1],
    year: match[2],
    season: match[3],
    roleCode: match[4],
    sequence: parseInt(match[5], 10),
  };
}

/**
 * Validate a credential ID string and return a descriptive error when invalid.
 */
export function validateCredentialId(
  id: string,
): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Credential ID must be a non-empty string' };
  }

  if (!CREDENTIAL_ID_REGEX.test(id)) {
    // Provide more specific error messages for common issues
    const parts = id.split('-');

    if (parts.length < 3) {
      return {
        valid: false,
        error: `Invalid credential ID format: expected at least 5 hyphen-separated segments, got "${id}"`,
      };
    }

    // Try to identify which part is wrong by checking from the end
    const lastPart = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const thirdLast = parts[parts.length - 3];
    const fourthLast = parts.length >= 4 ? parts[parts.length - 4] : undefined;

    // Check sequence (last segment)
    if (!/^\d{4}$/.test(lastPart)) {
      return {
        valid: false,
        error: `Invalid sequence "${lastPart}": must be a 4-digit zero-padded number`,
      };
    }

    // Check role code (second-to-last segment)
    if (!/^(VOL|SPK|WKS|ORG)$/.test(secondLast)) {
      return {
        valid: false,
        error: `Invalid role code "${secondLast}": must be one of VOL, SPK, WKS, ORG`,
      };
    }

    // Check season (third-to-last segment)
    if (!/^(Spring|Summer|Fall|Winter)$/.test(thirdLast)) {
      return {
        valid: false,
        error: `Invalid season "${thirdLast}": must be one of Spring, Summer, Fall, Winter`,
      };
    }

    // Check year (fourth-to-last segment)
    if (fourthLast && !/^\d{4}$/.test(fourthLast)) {
      return {
        valid: false,
        error: `Invalid year "${fourthLast}": must be a 4-digit year`,
      };
    }

    // If we get here, the event prefix is likely invalid
    const prefixParts = parts.slice(0, parts.length - 4);
    const prefix = prefixParts.join('-');
    if (prefix && !/^[A-Z](?:[A-Z-]*[A-Z])?$/.test(prefix)) {
      return {
        valid: false,
        error: `Invalid event prefix "${prefix}": must be uppercase letters, optionally separated by hyphens`,
      };
    }

    return {
      valid: false,
      error: `Invalid credential ID format: "${id}" does not match expected pattern {PREFIX}-{YEAR}-{SEASON}-{ROLE}-{SEQ}`,
    };
  }

  return { valid: true };
}
