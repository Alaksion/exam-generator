import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

type UserRow = { userId: string; email: string; role: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findUser(
  client: DynamoDBDocumentClient,
  table: string,
  subOrEmail: string,
): Promise<UserRow | null> {
  if (subOrEmail.includes('@')) {
    const result = await client.send(
      new GetCommand({
        TableName: table,
        Key: { email: normalizeEmail(subOrEmail) },
      }),
    );
    return (result.Item as UserRow | undefined) ?? null;
  }

  const result = await client.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': subOrEmail },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as UserRow | undefined) ?? null;
}

async function promoteAdmin(subOrEmail: string): Promise<void> {
  const table = process.env.DYNAMODB_USERS_TABLE;
  if (!table) {
    throw new Error('DYNAMODB_USERS_TABLE is required');
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const user = await findUser(client, table, subOrEmail);
  if (!user) {
    throw new Error(`No user found for ${subOrEmail}`);
  }

  if (user.role === 'admin') {
    console.log(`User ${user.email} is already an admin.`);
    return;
  }

  await client.send(
    new UpdateCommand({
      TableName: table,
      Key: { email: user.email },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': 'admin' },
      ConditionExpression: 'attribute_exists(email)',
    }),
  );
  console.log(`Promoted ${user.email} (${user.userId}) to admin.`);
}

const subOrEmail = process.argv[2];
if (!subOrEmail) {
  console.error('Usage: npm run promote:admin -- <sub-or-email>');
  process.exitCode = 1;
} else {
  promoteAdmin(subOrEmail).catch((error) => {
    console.error('Failed to promote admin', error);
    process.exitCode = 1;
  });
}