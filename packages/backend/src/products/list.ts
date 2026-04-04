import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { UserRole, Product, PointsProduct } from '@points-mall/shared';

export interface ListProductsOptions {
  type?: 'points' | 'code_exclusive';
  roleFilter?: UserRole;
  userRoles?: UserRole[];
  page?: number;
  pageSize?: number;
}

export interface ProductListItem extends Product {
  locked: boolean;
  pointsCost?: number;
  allowedRoles?: UserRole[] | 'all';
  eventInfo?: string;
}

export interface ListProductsResult {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Normalize allowedRoles from DynamoDB (may be Set or Array) to Array | 'all'
 */
function normalizeAllowedRoles(allowedRoles: unknown): UserRole[] | 'all' {
  if (!allowedRoles) return 'all';
  if (allowedRoles === 'all') return 'all';
  if (allowedRoles instanceof Set) return Array.from(allowedRoles) as UserRole[];
  if (Array.isArray(allowedRoles)) return allowedRoles as UserRole[];
  return 'all';
}

/**
 * Check if a user with the given roles can redeem a points product.
 */
function canRedeem(allowedRoles: UserRole[] | 'all', userRoles: UserRole[]): boolean {
  if (allowedRoles === 'all') return true;
  return allowedRoles.some((role) => userRoles.includes(role));
}

/**
 * List products for user-facing queries.
 * - Only returns active products
 * - Supports filtering by type (via GSI) and role
 * - Marks locked status for products the user cannot redeem
 * - Code exclusive products are never locked
 */
export async function listProducts(
  options: ListProductsOptions,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ListProductsResult> {
  const { type, roleFilter, userRoles = [], page = 1, pageSize = 20 } = options;

  let items: Record<string, unknown>[];

  if (type) {
    // Use type-status-index GSI: PK=type, SK=status='active'
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'type-status-index',
        KeyConditionExpression: '#type = :type AND #status = :status',
        ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
        ExpressionAttributeValues: { ':type': type, ':status': 'active' },
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
  } else {
    // Scan with filter for active status
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'active' },
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
  }

  // Apply role filter: keep products where allowedRoles includes roleFilter or is 'all'
  if (roleFilter) {
    items = items.filter((item) => {
      const allowedRoles = normalizeAllowedRoles(item.allowedRoles);
      if (allowedRoles === 'all') return true;
      if (item.type === 'code_exclusive') return true;
      return allowedRoles.includes(roleFilter);
    });
  }

  const total = items.length;

  // Paginate
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  // Map to ProductListItem with locked field
  const result: ProductListItem[] = paged.map((item) => {
    const product = item as Product & { pointsCost?: number; allowedRoles?: UserRole[] | 'all'; eventInfo?: string };
    let locked = false;

    if (product.type === 'points') {
      const allowedRoles = normalizeAllowedRoles(product.allowedRoles);
      if (allowedRoles !== 'all') {
        locked = !canRedeem(allowedRoles, userRoles);
      }
    }
    // Code exclusive products are never locked

    return {
      ...product,
      locked,
    };
  });

  return { items: result, total, page, pageSize };
}

// force-redeploy
