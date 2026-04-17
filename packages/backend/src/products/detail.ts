import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { PointsProduct, CodeExclusiveProduct } from '@points-mall/shared';

export interface ProductDetailResult {
  success: boolean;
  data?: PointsProduct | CodeExclusiveProduct;
  error?: { code: string; message: string };
}

/**
 * Get product detail by productId.
 * - Returns full product info
 * - For points products: includes allowedRoles info
 * - For code_exclusive products: includes eventInfo
 * - Returns 404 if product not found
 */
export async function getProductDetail(
  productId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ProductDetailResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { productId },
    }),
  );

  const item = result.Item;

  if (!item) {
    return {
      success: false,
      error: { code: 'PRODUCT_NOT_FOUND', message: '商品不存在' },
    };
  }

  return {
    success: true,
    data: item as PointsProduct | CodeExclusiveProduct,
  };
}
