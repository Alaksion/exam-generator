import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendGeneratorMessage } from './generatorQueue.js';

vi.mock('@aws-sdk/client-sqs', () => {
  class MockSQSClient {
    send = vi.fn();
  }
  return {
    SQSClient: MockSQSClient,
    SendMessageCommand: vi.fn(),
  };
});

describe('sendGeneratorMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates and sends the message to the SQS queue', async () => {
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const message = {
      examId: '11111111-1111-1111-1111-111111111111',
      certificationId: '22222222-2222-2222-2222-222222222222',
      correlationId: 'corr-123',
    };

    await sendGeneratorMessage(message);

    const mockedCommand = vi.mocked(SendMessageCommand);
    expect(mockedCommand).toHaveBeenCalledOnce();
    const sent = mockedCommand.mock.calls[0][0] as { MessageBody: string };
    expect(JSON.parse(sent.MessageBody)).toEqual(message);
  });
});