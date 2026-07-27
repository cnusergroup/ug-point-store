/**
 * Stand-in for a production call path, used by `orphan-mock.fixture.ts`.
 *
 * Shaped like the real backend list helpers (e.g. `listMyTravelApplications` in
 * `packages/backend/src/travel/apply.ts`): send a command through an injected DynamoDB document
 * client and read `Items` off the response. When a mock has been wiped mid-flight, `send()` returns
 * `undefined` and the `.Items` read throws
 * `TypeError: Cannot read properties of undefined (reading 'Items')` from inside this file - i.e.
 * attributed to the "production" call path rather than to the test that wiped the mock.
 */

export interface DocClientLike {
  send: (command: unknown) => Promise<unknown>;
}

export interface ListItemsResult {
  success: boolean;
  items: unknown[];
}

export async function listItemsForUser(
  client: DocClientLike,
  userId: string,
): Promise<ListItemsResult> {
  const response = await client.send({
    TableName: 'FixtureItems',
    IndexName: 'userId-createdAt-index',
    ExpressionAttributeValues: { ':uid': userId },
  });

  // Deliberately written the way production code is written: the response is assumed to exist.
  const items = (response as { Items?: unknown[] }).Items ?? [];
  return { success: true, items };
}
