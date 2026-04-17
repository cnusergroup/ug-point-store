# Bugfix Requirements Document

## Introduction

下架商品（status='inactive'）在用户端完全不可见，包括商品详情页和商品列表。当管理员将商品下架后，用户无法查看该商品的任何信息，即使用户已经持有该商品的直接链接。这导致用户体验不佳——例如用户收藏了某个商品或从历史订单中点击商品链接，会看到"商品不存在"的错误提示，而非合理的下架状态展示。

**Bug 根因分析：**
- 后端 `getProductDetail`（`packages/backend/src/products/detail.ts`）在商品 status 不为 'active' 时直接返回 `PRODUCT_NOT_FOUND` 错误
- 后端 `listProducts`（`packages/backend/src/products/list.ts`）仅查询 status='active' 的商品，完全过滤掉下架商品
- 前端商品详情页收到 404 后显示通用错误信息，无法区分"商品不存在"和"商品已下架"

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 用户通过直接链接访问一个 status='inactive' 的商品详情页 THEN 系统返回 PRODUCT_NOT_FOUND 错误（HTTP 404），用户看到"商品不存在"或加载失败的提示

1.2 WHEN 后端 `getProductDetail` 函数查询到一个 status='inactive' 的商品 THEN 系统将其视为不存在，返回 `{ success: false, error: { code: 'PRODUCT_NOT_FOUND' } }`，与商品真正不存在的情况无法区分

1.3 WHEN 用户浏览商品列表 THEN 系统仅返回 status='active' 的商品，所有下架商品完全不可见，用户无法得知某商品已下架

### Expected Behavior (Correct)

2.1 WHEN 用户通过直接链接访问一个 status='inactive' 的商品详情页 THEN 系统 SHALL 返回该商品的完整信息（包含 status='inactive' 字段），前端展示商品详情但明确标注"已下架"状态，并禁用兑换/加入购物车按钮

2.2 WHEN 后端 `getProductDetail` 函数查询到一个 status='inactive' 的商品 THEN 系统 SHALL 正常返回商品数据（包含 status 字段），不再将其视为不存在

2.3 WHEN 用户浏览商品列表 THEN 系统 SHALL 继续仅返回 status='active' 的商品（下架商品不出现在列表中），保持列表的整洁性

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 用户访问一个 status='active' 的商品详情页 THEN 系统 SHALL CONTINUE TO 正常返回商品数据，兑换和加入购物车功能正常可用

3.2 WHEN 用户访问一个真正不存在的商品 ID（数据库中无此记录）THEN 系统 SHALL CONTINUE TO 返回 PRODUCT_NOT_FOUND 错误

3.3 WHEN 管理员在后台查看商品列表（includeInactive=true）THEN 系统 SHALL CONTINUE TO 返回所有商品（包括 active 和 inactive）

3.4 WHEN 用户浏览商品列表（不带 includeInactive 参数）THEN 系统 SHALL CONTINUE TO 仅返回 status='active' 的商品

3.5 WHEN 管理员对商品执行上架/下架操作 THEN 系统 SHALL CONTINUE TO 正常切换商品的 status 字段

---

### Bug Condition (Structured Pseudocode)

**Bug Condition Function** — 识别触发 bug 的输入：

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ProductDetailRequest
  OUTPUT: boolean
  
  // 当请求的商品存在于数据库中但 status 为 'inactive' 时触发 bug
  product ← DB.get(X.productId)
  RETURN product ≠ NULL AND product.status = 'inactive'
END FUNCTION
```

**Property Specification** — 定义修复后的正确行为：

```pascal
// Property: Fix Checking — 下架商品应可查看
FOR ALL X WHERE isBugCondition(X) DO
  result ← getProductDetail'(X.productId)
  ASSERT result.success = true
  ASSERT result.data ≠ NULL
  ASSERT result.data.status = 'inactive'
  ASSERT result.data.productId = X.productId
END FOR
```

**Preservation Goal** — 非 bug 输入的行为不变：

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT getProductDetail(X) = getProductDetail'(X)
END FOR
```
