import { DynamoDBDocumentClient, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ulid } from 'ulid';
import type { UserRole, Product, PointsProduct, CodeExclusiveProduct, ProductStatus, ProductImage, SizeOption } from '@points-mall/shared';
import { ErrorCodes, ErrorMessages, VALID_BRANDS } from '@points-mall/shared';
import { moveTempImages, isTempImage } from './images';

export interface CreatePointsProductInput {
  name: string;
  description: string;
  imageUrl: string;
  pointsCost: number;
  stock: number;
  allowedRoles: UserRole[] | 'all';
  images?: ProductImage[];
  sizeOptions?: SizeOption[];
  purchaseLimitEnabled?: boolean;
  purchaseLimitCount?: number;
  brand?: string;
}

export interface CreateCodeExclusiveProductInput {
  name: string;
  description: string;
  imageUrl: string;
  eventInfo: string;
  stock: number;
  images?: ProductImage[];
  sizeOptions?: SizeOption[];
  purchaseLimitEnabled?: boolean;
  purchaseLimitCount?: number;
  brand?: string;
}

export interface ProductOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Validate size options: must be non-empty and have no duplicate names.
 * Returns an error result if invalid, or null if valid.
 */
export function validateSizeOptions(
  sizeOptions: SizeOption[],
): { code: string; message: string } | null {
  if (sizeOptions.length === 0) {
    return { code: ErrorCodes.SIZE_OPTIONS_REQUIRED, message: ErrorMessages.SIZE_OPTIONS_REQUIRED };
  }
  const names = new Set<string>();
  for (const opt of sizeOptions) {
    if (names.has(opt.name)) {
      return { code: ErrorCodes.DUPLICATE_SIZE_NAME, message: ErrorMessages.DUPLICATE_SIZE_NAME };
    }
    names.add(opt.name);
  }
  return null;
}

/**
 * Validate purchase limit: when enabled, count must be a positive integer (>= 1).
 * Returns an error result if invalid, or null if valid.
 */
export function validatePurchaseLimit(
  enabled: boolean | undefined,
  count: number | undefined,
): { code: string; message: string } | null {
  if (!enabled) return null;
  if (count === undefined || count === null || !Number.isInteger(count) || count < 1) {
    return { code: ErrorCodes.PURCHASE_LIMIT_INVALID, message: ErrorMessages.PURCHASE_LIMIT_INVALID };
  }
  return null;
}

/**
 * Validate brand value: accepts undefined, null, empty string, or a valid brand string.
 * Returns null for valid values, error object for invalid non-empty strings.
 */
export function validateBrand(
  brand: unknown,
): { code: string; message: string } | null {
  if (brand === undefined || brand === null || brand === '') return null;
  if (typeof brand !== 'string' || !VALID_BRANDS.includes(brand as any)) {
    return { code: ErrorCodes.INVALID_BRAND, message: ErrorMessages.INVALID_BRAND };
  }
  return null;
}

/**
 * Sync imageUrl from images array.
 * When images is non-empty, return images[0].url; otherwise return empty string.
 */
export function syncImageUrl(images: ProductImage[] | undefined): string {
  if (images && images.length > 0) {
    return images[0].url;
  }
  return '';
}

/**
 * Create a points product.
 * Generates a productId with ulid, sets type='points', status='active', redemptionCount=0.
 */
export async function createPointsProduct(
  input: CreatePointsProductInput,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  s3Client?: S3Client,
  bucketName?: string,
): Promise<ProductOperationResult<PointsProduct>> {
  // Validate brand
  const brandError = validateBrand(input.brand);
  if (brandError) return { success: false, error: brandError };

  // Validate size options if provided
  if (input.sizeOptions) {
    const sizeError = validateSizeOptions(input.sizeOptions);
    if (sizeError) return { success: false, error: sizeError };
  }

  // Validate purchase limit
  const limitError = validatePurchaseLimit(input.purchaseLimitEnabled, input.purchaseLimitCount);
  if (limitError) return { success: false, error: limitError };

  // Calculate stock from size options if provided
  const stock = input.sizeOptions
    ? input.sizeOptions.reduce((sum, s) => sum + s.stock, 0)
    : input.stock;

  // Sync imageUrl from images array
  const imageUrl = input.images ? syncImageUrl(input.images) : input.imageUrl;

  const now = new Date().toISOString();
  const productId = ulid();

  // Move temp images to permanent location
  let finalImages = input.images;
  if (finalImages && s3Client && bucketName && finalImages.some(img => isTempImage(img.key))) {
    finalImages = await moveTempImages(finalImages, productId, s3Client, bucketName);
  }

  // Re-sync imageUrl after potential move
  const finalImageUrl = finalImages ? syncImageUrl(finalImages) : imageUrl;

  const product: PointsProduct = {
    productId,
    name: input.name,
    description: input.description,
    imageUrl: finalImageUrl,
    type: 'points',
    status: 'active',
    stock,
    redemptionCount: 0,
    pointsCost: input.pointsCost,
    allowedRoles: input.allowedRoles,
    createdAt: now,
    updatedAt: now,
    ...(finalImages !== undefined && { images: finalImages }),
    ...(input.sizeOptions !== undefined && { sizeOptions: input.sizeOptions }),
    ...(input.purchaseLimitEnabled !== undefined && { purchaseLimitEnabled: input.purchaseLimitEnabled }),
    ...(input.purchaseLimitCount !== undefined && { purchaseLimitCount: input.purchaseLimitCount }),
    ...(input.brand && { brand: input.brand }),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: product,
    }),
  );

  return { success: true, data: product };
}

/**
 * Create a code-exclusive product.
 * Generates a productId with ulid, sets type='code_exclusive', status='active', redemptionCount=0.
 */
export async function createCodeExclusiveProduct(
  input: CreateCodeExclusiveProductInput,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  s3Client?: S3Client,
  bucketName?: string,
): Promise<ProductOperationResult<CodeExclusiveProduct>> {
  // Validate brand
  const brandError = validateBrand(input.brand);
  if (brandError) return { success: false, error: brandError };

  // Validate size options if provided
  if (input.sizeOptions) {
    const sizeError = validateSizeOptions(input.sizeOptions);
    if (sizeError) return { success: false, error: sizeError };
  }

  // Validate purchase limit
  const limitError = validatePurchaseLimit(input.purchaseLimitEnabled, input.purchaseLimitCount);
  if (limitError) return { success: false, error: limitError };

  // Calculate stock from size options if provided
  const stock = input.sizeOptions
    ? input.sizeOptions.reduce((sum, s) => sum + s.stock, 0)
    : input.stock;

  // Sync imageUrl from images array
  const imageUrl = input.images ? syncImageUrl(input.images) : input.imageUrl;

  const now = new Date().toISOString();
  const productId = ulid();

  // Move temp images to permanent location
  let finalImages = input.images;
  if (finalImages && s3Client && bucketName && finalImages.some(img => isTempImage(img.key))) {
    finalImages = await moveTempImages(finalImages, productId, s3Client, bucketName);
  }

  // Re-sync imageUrl after potential move
  const finalImageUrl = finalImages ? syncImageUrl(finalImages) : imageUrl;

  const product: CodeExclusiveProduct = {
    productId,
    name: input.name,
    description: input.description,
    imageUrl: finalImageUrl,
    type: 'code_exclusive',
    status: 'active',
    stock,
    redemptionCount: 0,
    eventInfo: input.eventInfo,
    createdAt: now,
    updatedAt: now,
    ...(finalImages !== undefined && { images: finalImages }),
    ...(input.sizeOptions !== undefined && { sizeOptions: input.sizeOptions }),
    ...(input.purchaseLimitEnabled !== undefined && { purchaseLimitEnabled: input.purchaseLimitEnabled }),
    ...(input.purchaseLimitCount !== undefined && { purchaseLimitCount: input.purchaseLimitCount }),
    ...(input.brand && { brand: input.brand }),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: product,
    }),
  );

  return { success: true, data: product };
}

/**
 * Update editable fields of a product.
 * Builds a dynamic UpdateExpression from the provided partial updates.
 */
export async function updateProduct(
  productId: string,
  updates: Record<string, unknown>,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ProductOperationResult> {
  // Validate brand if provided in updates
  if (updates.brand !== undefined) {
    const brandError = validateBrand(updates.brand);
    if (brandError) return { success: false, error: brandError };
  }

  // Validate size options if provided in updates
  if (updates.sizeOptions !== undefined) {
    const sizeOptions = updates.sizeOptions as SizeOption[];
    const sizeError = validateSizeOptions(sizeOptions);
    if (sizeError) return { success: false, error: sizeError };
    // Recalculate stock from size options
    updates.stock = sizeOptions.reduce((sum, s) => sum + s.stock, 0);
  }

  // Validate purchase limit if provided in updates
  const purchaseLimitEnabled = updates.purchaseLimitEnabled as boolean | undefined;
  const purchaseLimitCount = updates.purchaseLimitCount as number | undefined;
  if (purchaseLimitEnabled !== undefined) {
    const limitError = validatePurchaseLimit(purchaseLimitEnabled, purchaseLimitCount);
    if (limitError) return { success: false, error: limitError };
  }

  // Sync imageUrl from images if provided in updates
  if (updates.images !== undefined) {
    updates.imageUrl = syncImageUrl(updates.images as ProductImage[] | undefined);
  }

  // Fields that are not allowed to be updated directly
  const immutableFields = new Set(['productId', 'type', 'createdAt', 'redemptionCount']);

  const filteredEntries = Object.entries(updates).filter(
    ([key, value]) => !immutableFields.has(key) && value !== undefined,
  );

  if (filteredEntries.length === 0) {
    return { success: false, error: { code: 'NO_UPDATES', message: '没有可更新的字段' } };
  }

  const now = new Date().toISOString();
  const expressionParts: string[] = [];
  const expressionAttrNames: Record<string, string> = {};
  const expressionAttrValues: Record<string, unknown> = {};

  for (const [key, value] of filteredEntries) {
    const nameAlias = `#${key}`;
    const valueAlias = `:${key}`;
    expressionParts.push(`${nameAlias} = ${valueAlias}`);
    expressionAttrNames[nameAlias] = key;
    expressionAttrValues[valueAlias] = value;
  }

  // Always update updatedAt
  expressionParts.push('#updatedAt = :updatedAt');
  expressionAttrNames['#updatedAt'] = 'updatedAt';
  expressionAttrValues[':updatedAt'] = now;

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { productId },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttrNames,
      ExpressionAttributeValues: expressionAttrValues,
    }),
  );

  return { success: true };
}

/**
 * Toggle product status between active and inactive.
 * When set to 'inactive', the product is hidden from user-facing queries.
 */
export async function setProductStatus(
  productId: string,
  status: ProductStatus,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ProductOperationResult> {
  if (status !== 'active' && status !== 'inactive') {
    return { success: false, error: { code: 'INVALID_STATUS', message: '状态只能为 active 或 inactive' } };
  }

  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { productId },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': now },
    }),
  );

  return { success: true };
}


/**
 * List all products for admin view.
 * Returns all products (both active and inactive) sorted by createdAt descending.
 * Each product includes redemptionCount and stock for admin statistics.
 */
export async function listAdminProducts(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<Product[]> {
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
    }),
  );

  const items = (result.Items ?? []) as Product[];

  // Sort by createdAt descending (newest first)
  items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));

  return items;
}
