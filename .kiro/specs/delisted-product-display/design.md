# Delisted Product Display Bugfix Design

## Overview

当管理员将商品下架（status='inactive'）后，用户通过直接链接访问该商品详情页时，后端 `getProductDetail` 将其视为不存在并返回 `PRODUCT_NOT_FOUND`，前端显示通用错误信息。修复方案：后端移除 active-only 过滤，正常返回 inactive 商品数据（含 status 字段）；前端根据 status 字段展示"已下架"徽章并禁用兑换/购物车按钮。商品列表行为不变，仍仅返回 active 商品。

## Glossary

- **Bug_Condition (C)**: 用户请求的商品存在于数据库中但 status='inactive'，`getProductDetail` 错误地返回 PRODUCT_NOT_FOUND
- **Property (P)**: 当商品 status='inactive' 时，`getProductDetail` 应正常返回商品数据（含 status 字段），前端展示商品详情并标注"已下架"
- **Preservation**: 活跃商品的详情查看、兑换、加购功能不受影响；真正不存在的商品仍返回 404；商品列表仍仅返回 active 商品
- **getProductDetail**: `packages/backend/src/products/detail.ts` 中的函数，根据 productId 从 DynamoDB 获取商品详情
- **listProducts**: `packages/backend/src/products/list.ts` 中的函数，查询用户端商品列表（仅 active）
- **ProductDetailPage**: `packages/frontend/src/pages/product/index.tsx` 中的前端商品详情页组件

## Bug Details

### Bug Condition

当用户通过直接链接（如收藏、历史订单中的链接）访问一个已下架商品时，`getProductDetail` 在查询到商品后检查 `item.status !== 'active'`，对 inactive 商品返回与"商品不存在"相同的错误码 `PRODUCT_NOT_FOUND`。前端收到错误后显示通用的"加载失败"提示，用户无法得知商品已下架。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { productId: string }
  OUTPUT: boolean
  
  product ← DynamoDB.get(input.productId)
  RETURN product ≠ NULL
         AND product.status = 'inactive'
END FUNCTION
```

### Examples

- 用户访问 `/pages/product/index?id=p3`（p3 status='inactive'）→ 当前返回 `{ success: false, error: { code: 'PRODUCT_NOT_FOUND' } }`，前端显示"加载失败"；**期望**：返回完整商品数据，前端显示商品详情 + "已下架"徽章
- 用户从历史订单点击已下架商品链接 → 当前看到错误页面；**期望**：看到商品信息但无法兑换/加购
- 用户访问 `/pages/product/index?id=nonexistent`（数据库无此记录）→ 当前和修复后均返回 PRODUCT_NOT_FOUND（行为不变）
- 用户访问 `/pages/product/index?id=p1`（p1 status='active'）→ 当前和修复后均正常展示商品详情（行为不变）

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 活跃商品（status='active'）的详情查看、兑换、加入购物车功能完全不受影响
- 真正不存在的商品 ID（数据库无记录）仍返回 PRODUCT_NOT_FOUND 错误
- 商品列表 API（`listProducts`）仍仅返回 status='active' 的商品
- 管理员后台商品列表（`includeInactive=true`）仍返回所有商品
- 管理员上架/下架操作正常工作

**Scope:**
所有不涉及 inactive 商品详情查看的输入不受此修复影响，包括：
- 活跃商品的所有操作（查看、兑换、加购）
- 商品列表浏览
- 管理员后台操作
- 不存在商品的 404 处理

## Hypothesized Root Cause

Based on the code analysis of `packages/backend/src/products/detail.ts`:

1. **Active-Only Filter in getProductDetail**: 函数在第 38-42 行显式检查 `item.status !== 'active'`，对所有非 active 商品返回 PRODUCT_NOT_FOUND。这是 bug 的直接原因——inactive 商品被错误地等同于不存在的商品。

2. **Frontend Lacks Status-Aware Rendering**: `packages/frontend/src/pages/product/index.tsx` 的 `ProductDetail` 接口虽然定义了 `status: string` 字段，但页面逻辑中从未检查 status 值。当 API 返回错误时，前端统一显示 `t('product.loadFailed')` 错误信息，无法区分"不存在"和"已下架"。

3. **No Delisted UI State**: 前端没有"已下架"的视觉状态——没有对应的徽章样式、没有禁用按钮的逻辑分支、没有相关的 i18n 翻译键。

## Correctness Properties

Property 1: Bug Condition - Inactive Products Return Data

_For any_ product detail request where the requested productId exists in the database with status='inactive', the fixed `getProductDetail` function SHALL return `{ success: true, data: <product> }` with the complete product data including `status: 'inactive'`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Active Products and Missing Products Unchanged

_For any_ product detail request where the productId either does not exist in the database OR exists with status='active', the fixed `getProductDetail` function SHALL produce the same result as the original function, preserving the existing 404 behavior for missing products and normal data return for active products.

**Validates: Requirements 3.1, 3.2**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `packages/backend/src/products/detail.ts`

**Function**: `getProductDetail`

**Specific Changes**:
1. **Remove Active-Only Filter**: 删除第 38-42 行的 `if (item.status !== 'active')` 检查，使 inactive 商品也能正常返回数据
2. **Preserve Not-Found Check**: 保留 `if (!item)` 的检查，真正不存在的商品仍返回 PRODUCT_NOT_FOUND

**File**: `packages/backend/src/products/detail.test.ts`

**Specific Changes**:
3. **Update Test for Inactive Products**: 修改 `should return 404 error when product is inactive` 测试用例，改为验证 inactive 商品返回 `success: true` 和完整数据

**File**: `packages/frontend/src/pages/product/index.tsx`

**Specific Changes**:
4. **Add Delisted State Detection**: 在商品数据加载成功后，检查 `product.status === 'inactive'` 来判断是否为已下架商品
5. **Show Delisted Badge**: 当商品已下架时，在商品名称旁显示"已下架"徽章（使用 CSS 变量 `--warning` 色系）
6. **Disable Redeem/Cart Buttons**: 当商品已下架时，禁用兑换按钮和加入购物车按钮，按钮文案改为"商品已下架"
7. **Override canUserRedeem/canAddToCart**: 在这两个函数开头增加 `if (product.status === 'inactive') return false` 的判断

**File**: `packages/frontend/src/pages/product/index.scss`

**Specific Changes**:
8. **Add Delisted Badge Style**: 添加 `.detail-info__delisted-badge` 样式，使用 `--warning` 色系背景和边框

**File**: i18n 翻译文件

**Specific Changes**:
9. **Add Translation Keys**: 添加 `product.delisted`（已下架）和 `product.delistedHint`（该商品已下架，无法兑换）等翻译键

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `getProductDetail` with inactive product data and assert the return value. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Inactive Points Product Test**: 调用 `getProductDetail` 传入 status='inactive' 的积分商品（will fail on unfixed code — returns PRODUCT_NOT_FOUND instead of product data）
2. **Inactive Code Exclusive Product Test**: 调用 `getProductDetail` 传入 status='inactive' 的 code_exclusive 商品（will fail on unfixed code）
3. **Inactive Product with All Fields Test**: 调用 `getProductDetail` 传入包含 images、sizeOptions 等完整字段的 inactive 商品（will fail on unfixed code）

**Expected Counterexamples**:
- `getProductDetail('p3', ...)` 对 inactive 商品返回 `{ success: false, error: { code: 'PRODUCT_NOT_FOUND' } }` 而非商品数据
- Root cause confirmed: `detail.ts` 第 38-42 行的 `item.status !== 'active'` 检查

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := getProductDetail_fixed(input.productId)
  ASSERT result.success = true
  ASSERT result.data ≠ NULL
  ASSERT result.data.status = 'inactive'
  ASSERT result.data.productId = input.productId
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getProductDetail(input) = getProductDetail_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for active products and missing products, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Active Product Preservation**: 验证 active 商品在修复前后返回完全相同的结果
2. **Missing Product Preservation**: 验证不存在的 productId 在修复前后返回完全相同的 PRODUCT_NOT_FOUND 错误
3. **Active Product Fields Preservation**: 验证 active 商品的所有字段（images、sizeOptions、purchaseLimit 等）在修复前后完全一致

### Unit Tests

- 测试 `getProductDetail` 对 inactive 商品返回 success: true 和完整数据
- 测试 `getProductDetail` 对 active 商品行为不变
- 测试 `getProductDetail` 对不存在商品行为不变
- 测试前端 `canUserRedeem` 对 inactive 商品返回 false
- 测试前端 `canAddToCart` 对 inactive 商品返回 false

### Property-Based Tests

- 生成随机商品数据（随机 status、type、字段组合），验证 inactive 商品始终返回 success: true
- 生成随机 active 商品数据，验证修复前后返回结果完全一致
- 生成随机不存在的 productId，验证修复前后返回结果完全一致

### Integration Tests

- 测试完整 API 流程：请求 inactive 商品详情 → 返回 200 + 商品数据
- 测试前端渲染：inactive 商品 → 显示"已下架"徽章 + 禁用按钮
- 测试商品列表不受影响：列表 API 仍仅返回 active 商品
