import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('./index.js');

/**
 * Unit tests for CloudFront Function: cf-country-cookie
 * Validates: Requirements 3.1, 6.3, 6.4
 */

function makeEvent(
  countryHeader: string | null,
  existingCookies?: Array<{ value: string }>
) {
  const headers: Record<string, { value: string }> = {};
  if (countryHeader !== null) {
    headers['cloudfront-viewer-country'] = { value: countryHeader };
  }

  const responseHeaders: Record<string, unknown> = {};
  if (existingCookies) {
    responseHeaders['set-cookie'] = {
      multiValue: existingCookies,
    };
  }

  return {
    request: { headers },
    response: { headers: responseHeaders },
  };
}

describe('CloudFront Function: cf-country-cookie', () => {
  it('sets cf_country cookie when country header is present', () => {
    const event = makeEvent('JP');
    const response = handler(event);

    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'].multiValue).toHaveLength(1);
    expect(response.headers['set-cookie'].multiValue[0].value).toBe(
      'cf_country=JP; Path=/; Secure; SameSite=Lax; Max-Age=86400'
    );
  });

  it('passes response through unchanged when country header is absent', () => {
    const event = makeEvent(null);
    const response = handler(event);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('preserves existing Set-Cookie headers when adding cf_country', () => {
    const existing = [{ value: 'session=abc123; Path=/' }];
    const event = makeEvent('US', existing);
    const response = handler(event);

    expect(response.headers['set-cookie'].multiValue).toHaveLength(2);
    expect(response.headers['set-cookie'].multiValue[0].value).toBe(
      'session=abc123; Path=/'
    );
    expect(response.headers['set-cookie'].multiValue[1].value).toBe(
      'cf_country=US; Path=/; Secure; SameSite=Lax; Max-Age=86400'
    );
  });

  it('sets correct cookie attributes per requirement 3.1', () => {
    const event = makeEvent('KR');
    const response = handler(event);

    const cookieValue = response.headers['set-cookie'].multiValue[0].value;
    expect(cookieValue).toContain('cf_country=KR');
    expect(cookieValue).toContain('Path=/');
    expect(cookieValue).toContain('Secure');
    expect(cookieValue).toContain('SameSite=Lax');
    expect(cookieValue).toContain('Max-Age=86400');
  });

  it('initializes set-cookie header structure when none exists', () => {
    const event = {
      request: {
        headers: {
          'cloudfront-viewer-country': { value: 'TW' },
        },
      },
      response: {
        headers: {},
      },
    };
    const response = handler(event);

    expect(response.headers['set-cookie'].multiValue).toHaveLength(1);
    expect(response.headers['set-cookie'].multiValue[0].value).toContain(
      'cf_country=TW'
    );
  });
});
