import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export const ssmClient = new SSMClient({});

export type KeyFetchError = 'missing-parameter' | 'empty-parameter' | 'ssm-error';

export type FetchKeyResult = { ok: true; key: string } | { ok: false; error: KeyFetchError };

export async function fetchExpectedKey(): Promise<FetchKeyResult> {
  const parameterName = process.env.API_KEY_PARAMETER_NAME;
  if (!parameterName) {
    return { ok: false, error: 'missing-parameter' };
  }

  let response;
  try {
    response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
      }),
    );
  } catch {
    return { ok: false, error: 'ssm-error' };
  }

  const value = response.Parameter?.Value;
  if (!value) {
    return { ok: false, error: 'empty-parameter' };
  }

  return { ok: true, key: value };
}
