import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type RouteHandler = (event: APIGatewayProxyEventV2, params: Record<string, string>) => Promise<APIGatewayProxyResultV2>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  register(method: string, path: string, handler: RouteHandler): this {
    const paramNames: string[] = [];
    const regexPattern = path
      .replace(/\/{(.*?)}/g, (_match: string, name: string) => {
        paramNames.push(name);
        return '/([^/]+)';
      })
      .replace(/\/$/, '')
      .replace(/\/$/, '/?');

    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexPattern}$`),
      paramNames,
      handler,
    });

    return this;
  }

  async route(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2 | null> {
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath.replace(/\/$/, '') || '/';

    for (const route of this.routes) {
      const match = route.pattern.exec(path);
      if (route.method === method && match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return route.handler(event, params);
      }
    }

    return null;
  }
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export function notFound(): APIGatewayProxyResultV2 {
  return jsonResponse(404, { error: 'NotFound', message: 'The requested resource was not found.' });
}

export function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const decoded = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function getQueryParam(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const raw = event.queryStringParameters?.[name];
  return raw ? decodeURIComponent(raw) : undefined;
}
