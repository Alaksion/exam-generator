import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export function notFound(): APIGatewayProxyResult {
  return jsonResponse(404, { error: 'NotFound', message: 'The requested resource was not found.' });
}

export function parseBody(event: APIGatewayProxyEvent): unknown {
  if (!event.body) return {};
  const decoded = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function getQueryParam(event: APIGatewayProxyEvent, name: string): string | undefined {
  const raw = event.queryStringParameters?.[name];
  return raw ? decodeURIComponent(raw) : undefined;
}