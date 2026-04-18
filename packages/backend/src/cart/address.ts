import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { AddressRequest, AddressResponse } from '@points-mall/shared';

export interface AddressMutationResult {
  success: boolean;
  data?: AddressResponse;
  error?: { code: string; message: string };
}

export interface AddressListResult {
  success: boolean;
  data?: AddressResponse[];
  error?: { code: string; message: string };
}

/** Generate a simple unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Validate address input fields */
function validateAddressInput(data: AddressRequest): { code: string; message: string } | null {
  if (!data.phone || !/^\+\d{1,4}-\d{4,15}$/.test(data.phone)) {
    return { code: ErrorCodes.INVALID_PHONE, message: ErrorMessages.INVALID_PHONE };
  }
  if (!data.recipientName || data.recipientName.length < 1 || data.recipientName.length > 20) {
    return { code: ErrorCodes.INVALID_RECIPIENT_NAME, message: ErrorMessages.INVALID_RECIPIENT_NAME };
  }
  if (!data.detailAddress || data.detailAddress.length < 1 || data.detailAddress.length > 200) {
    return { code: ErrorCodes.INVALID_DETAIL_ADDRESS, message: ErrorMessages.INVALID_DETAIL_ADDRESS };
  }
  return null;
}

/**
 * Create a new address for a user.
 * - Validates phone, recipientName, detailAddress
 * - Checks address limit (max 10 per user)
 * - Creates address record with generated ID
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.9
 */
export async function createAddress(
  userId: string,
  data: AddressRequest,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<AddressMutationResult> {
  // 1. Validate input
  const validationError = validateAddressInput(data);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // 2. Check address limit (max 10)
  const existingResult = await dynamoClient.send(
    new QueryCommand({
      TableName: addressesTable,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      Select: 'COUNT',
    }),
  );

  if ((existingResult.Count ?? 0) >= 10) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_LIMIT_REACHED, message: ErrorMessages.ADDRESS_LIMIT_REACHED },
    };
  }

  // 3. Create address record
  const now = new Date().toISOString();
  const addressId = generateId();
  const isDefault = data.isDefault ?? false;

  // If setting as default, unset previous default
  if (isDefault) {
    await unsetPreviousDefault(userId, dynamoClient, addressesTable);
  }

  const address: AddressResponse = {
    addressId,
    userId,
    recipientName: data.recipientName,
    phone: data.phone,
    detailAddress: data.detailAddress,
    isDefault,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: addressesTable,
      Item: address,
    }),
  );

  return { success: true, data: address };
}

/**
 * Get all addresses for a user, sorted with default address first.
 *
 * Requirements: 3.2, 3.11
 */
export async function getAddresses(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<AddressListResult> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: addressesTable,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const addresses = (result.Items ?? []) as AddressResponse[];

  // Sort: default address first, then by createdAt descending
  addresses.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return { success: true, data: addresses };
}

/**
 * Update an existing address.
 * - Validates input same as create
 * - Verifies address belongs to user
 * - Returns ADDRESS_NOT_FOUND if not found or not owned
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6
 */
export async function updateAddress(
  addressId: string,
  userId: string,
  data: AddressRequest,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<AddressMutationResult> {
  // 1. Validate input
  const validationError = validateAddressInput(data);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // 2. Fetch existing address and verify ownership
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: addressesTable,
      Key: { addressId },
    }),
  );

  if (!existing.Item || existing.Item.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_NOT_FOUND, message: ErrorMessages.ADDRESS_NOT_FOUND },
    };
  }

  // 3. Update address
  const now = new Date().toISOString();
  const isDefault = data.isDefault ?? existing.Item.isDefault ?? false;

  // If setting as default, unset previous default
  if (isDefault && !existing.Item.isDefault) {
    await unsetPreviousDefault(userId, dynamoClient, addressesTable);
  }

  const updated: AddressResponse = {
    addressId,
    userId,
    recipientName: data.recipientName,
    phone: data.phone,
    detailAddress: data.detailAddress,
    isDefault,
    createdAt: existing.Item.createdAt as string,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: addressesTable,
      Item: updated,
    }),
  );

  return { success: true, data: updated };
}

/**
 * Delete an address.
 * - Verifies address belongs to user
 * - Returns ADDRESS_NOT_FOUND if not found or not owned
 *
 * Requirements: 3.7
 */
export async function deleteAddress(
  addressId: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<AddressMutationResult> {
  // 1. Fetch existing address and verify ownership
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: addressesTable,
      Key: { addressId },
    }),
  );

  if (!existing.Item || existing.Item.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_NOT_FOUND, message: ErrorMessages.ADDRESS_NOT_FOUND },
    };
  }

  // 2. Delete address
  await dynamoClient.send(
    new DeleteCommand({
      TableName: addressesTable,
      Key: { addressId },
    }),
  );

  return { success: true };
}

/**
 * Set an address as the default.
 * - Verifies address belongs to user
 * - Unsets previous default address
 * - Returns ADDRESS_NOT_FOUND if not found or not owned
 *
 * Requirements: 3.8
 */
export async function setDefaultAddress(
  addressId: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<AddressMutationResult> {
  // 1. Fetch existing address and verify ownership
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: addressesTable,
      Key: { addressId },
    }),
  );

  if (!existing.Item || existing.Item.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_NOT_FOUND, message: ErrorMessages.ADDRESS_NOT_FOUND },
    };
  }

  // 2. Unset previous default
  await unsetPreviousDefault(userId, dynamoClient, addressesTable);

  // 3. Set this address as default
  const now = new Date().toISOString();
  const updated: AddressResponse = {
    ...(existing.Item as AddressResponse),
    isDefault: true,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: addressesTable,
      Item: updated,
    }),
  );

  return { success: true, data: updated };
}

/**
 * Helper: unset the current default address for a user.
 */
async function unsetPreviousDefault(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  addressesTable: string,
): Promise<void> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: addressesTable,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const addresses = result.Items ?? [];
  for (const addr of addresses) {
    if (addr.isDefault) {
      await dynamoClient.send(
        new PutCommand({
          TableName: addressesTable,
          Item: { ...addr, isDefault: false, updatedAt: new Date().toISOString() },
        }),
      );
    }
  }
}
