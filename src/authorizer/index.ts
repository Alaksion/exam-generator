import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { fetchExpectedKey } from './apiKey.js';

export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const providedKey = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'] ?? '';
  const expectedKey = await fetchExpectedKey();

  if (!providedKey || providedKey !== expectedKey) {
    throw new Error('Unauthorized');
  }

  return generatePolicy('user', 'Allow', event.methodArn);
};

function generatePolicy(principalId: string, effect: 'Allow' | 'Deny', resource: string): APIGatewayAuthorizerResult {
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
