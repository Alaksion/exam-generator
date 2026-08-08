import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { fetchExpectedKey } from './apiKey.js';

export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  console.log('Authorizer event:', JSON.stringify(event, null, 2));

  if (isPreflight(event)) {
    return generatePolicy('user', 'Allow', event.methodArn);
  }

  const providedKey = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'] ?? '';
  if (!providedKey) {
    throw new Error('Unauthorized');
  }

  const result = await fetchExpectedKey();

  if (!result.ok) {
    console.error('Error fetching expected API key:', result.error);
    throw new Error('Unauthorized');
  }

  if (providedKey !== result.key) {
    console.error('Error fetching expected API key:', "provided key missing or doesn't match");
    throw new Error('Unauthorized');
  }

  console.log('API key validated successfully.');
  return generatePolicy('user', 'Allow', event.methodArn);
};

function isPreflight(event: APIGatewayRequestAuthorizerEvent): boolean {
  if ((event.httpMethod ?? '').toUpperCase() === 'OPTIONS') {
    return true;
  }
  const verb = event.methodArn.split('/')[2]?.toUpperCase();
  return verb === 'OPTIONS';
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };
}
