const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173';

export function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    return [DEFAULT_ALLOWED_ORIGIN];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  return parseAllowedOrigins().includes(origin);
}

export function buildCorsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) {
    return {};
  }
  if (!isOriginAllowed(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}