import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export type RouteHandler = (
  event: APIGatewayProxyEvent,
  params: Record<string, string>,
) => Promise<APIGatewayProxyResult>;

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

  async route(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult | null> {
    const method = event.httpMethod.toUpperCase();
    const path = event.path.replace(/\/$/, '') || '/';

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