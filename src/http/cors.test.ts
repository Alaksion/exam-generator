import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildCorsHeaders, isOriginAllowed, parseAllowedOrigins } from './cors.js';

const ENV_KEY = 'ALLOWED_ORIGINS';
const original = process.env[ENV_KEY];

function withEnv(value: string | undefined, fn: () => void) {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  }
}

describe('parseAllowedOrigins', () => {
  it('reads a comma-separated list from ALLOWED_ORIGINS', () => {
    withEnv('http://localhost:5173, https://app.example.com', () => {
      expect(parseAllowedOrigins()).toEqual([
        'http://localhost:5173',
        'https://app.example.com',
      ]);
    });
  });

  it('returns the default when ALLOWED_ORIGINS is unset', () => {
    withEnv(undefined, () => {
      expect(parseAllowedOrigins()).toEqual(['http://localhost:5173']);
    });
  });
});

describe('isOriginAllowed', () => {
  it('returns true for an allowed origin', () => {
    withEnv('http://localhost:5173', () => {
      expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    });
  });

  it('returns false for a disallowed origin', () => {
    withEnv('http://localhost:5173', () => {
      expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    });
  });

  it('returns false when there is no origin', () => {
    withEnv('http://localhost:5173', () => {
      expect(isOriginAllowed(undefined)).toBe(false);
    });
  });
});

describe('buildCorsHeaders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('echoes the origin when it is allowed', () => {
    withEnv('http://localhost:5173', () => {
      const headers = buildCorsHeaders('http://localhost:5173');
      expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
      expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET,POST,PUT,DELETE,OPTIONS');
      expect(headers['Access-Control-Max-Age']).toBe('600');
    });
  });

  it('returns no Access-Control-Allow-Origin for a disallowed origin', () => {
    withEnv('http://localhost:5173', () => {
      const headers = buildCorsHeaders('https://evil.example.com');
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });

  it('returns no CORS headers when there is no origin', () => {
    withEnv('http://localhost:5173', () => {
      const headers = buildCorsHeaders(undefined);
      expect(Object.keys(headers)).toHaveLength(0);
    });
  });
});
