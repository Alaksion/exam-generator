import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export const ssmClient = new SSMClient({});

export async function fetchExpectedKey(): Promise<string> {
  const parameterName = process.env.API_KEY_PARAMETER_NAME;
  if (!parameterName) {
    throw new Error('Missing API_KEY_PARAMETER_NAME');
  }

  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: parameterName,
    }),
  );

  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error('API key parameter is empty');
  }

  return value;
}
