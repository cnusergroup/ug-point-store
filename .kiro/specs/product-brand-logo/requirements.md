# Requirements Document

## Introduction

为商品添加品牌 Logo 字段（`brand`），管理员在创建/编辑商品时可通过单选按钮选择品牌，商品详情页和商品列表页展示对应的品牌 Logo 徽章。该字段为可选字段，已有商品默认无品牌标识。

## Glossary

- **Product**: 积分商城中的商品实体，存储在 DynamoDB Products 表中，由 `Product` 接口定义
- **Brand**: 商品所属的品牌标识，取值为 `'aws'`、`'ug'`、`'awscloud'` 三者之一，或为空（未设置）
- **Brand_Selector**: 商品创建/编辑表单中的品牌单选组件，位于描述字段下方
- **Brand_Badge**: 商品详情页和列表页中展示品牌 Logo 的视觉徽章组件
- **Admin_Products_Page**: 管理员商品管理页面（`/pages/admin/products`）
- **Product_Detail_Page**: 商品详情页面（`/pages/product/index`）
- **Product_List_Page**: 商品列表首页（`/pages/index/index`）

## Requirements

### Requirement 1: Brand 字段数据模型

**User Story:** As a developer, I want the Product data model to include an optional `brand` field, so that brand information can be stored and retrieved consistently across the system.

#### Acceptance Criteria

1. THE Product interface SHALL include an optional `brand` field of type `'aws' | 'ug' | 'awscloud'`
2. WHEN a product has no `brand` value set, THE System SHALL treat the product as having no brand affiliation
3. THE `brand` field SHALL be included in the shared type definitions (`@points-mall/shared`) so that both frontend and backend reference the same type

### Requirement 2: Brand 字段验证

**User Story:** As a system administrator, I want the backend to validate the brand field value, so that only valid brand values are persisted.

#### Acceptance Criteria

1. WHEN a product is created or updated with a `brand` value, THE Backend SHALL accept only the values `'aws'`、`'ug'`、`'awscloud'`
2. WHEN a product is created or updated with an invalid `brand` value, THE Backend SHALL return an error with code `INVALID_BRAND` and a descriptive message
3. WHEN a product is created or updated without a `brand` field, THE Backend SHALL accept the request and store the product without a brand value
4. THE Backend SHALL pass the `brand` field through the existing `updateProduct` function without treating it as an immutable field

### Requirement 3: Admin 商品表单品牌选择器

**User Story:** As an administrator, I want to select a brand logo when creating or editing a product, so that the product is associated with the correct brand.

#### Acceptance Criteria

1. THE Brand_Selector SHALL appear in the product creation and editing form, positioned below the description field and above the images field
2. THE Brand_Selector SHALL display three radio button options with labels: "AWS"、"亚马逊云科技UG"、"亚马逊云科技"
3. THE Brand_Selector SHALL map the three options to values `'aws'`、`'ug'`、`'awscloud'` respectively
4. THE Brand_Selector SHALL allow deselecting the current choice to set brand to empty (no brand)
5. WHEN editing an existing product that has a `brand` value, THE Brand_Selector SHALL pre-select the corresponding option
6. WHEN editing an existing product that has no `brand` value, THE Brand_Selector SHALL show no option selected
7. WHEN the form is submitted, THE Admin_Products_Page SHALL include the selected `brand` value in the API request body

### Requirement 4: 商品详情页品牌 Logo 展示

**User Story:** As a user, I want to see the brand logo on the product detail page, so that I can identify which brand the product belongs to.

#### Acceptance Criteria

1. WHEN a product has a `brand` value, THE Product_Detail_Page SHALL display the corresponding Brand_Badge in the product info section
2. THE Brand_Badge SHALL display the brand-specific logo image or styled text for each brand value
3. WHEN a product has no `brand` value, THE Product_Detail_Page SHALL not display any Brand_Badge
4. THE Brand_Badge SHALL be positioned near the product name area for clear visibility

### Requirement 5: 商品列表页品牌 Logo 展示

**User Story:** As a user, I want to see a small brand indicator on product cards in the list, so that I can quickly identify brand-affiliated products while browsing.

#### Acceptance Criteria

1. WHEN a product has a `brand` value, THE Product_List_Page SHALL display a small brand indicator on the product card
2. THE brand indicator SHALL be compact enough to not disrupt the existing card layout
3. WHEN a product has no `brand` value, THE Product_List_Page SHALL not display any brand indicator on the product card
4. THE brand indicator SHALL use the same brand-to-visual mapping as the Brand_Badge on the detail page

### Requirement 6: API 响应包含 Brand 字段

**User Story:** As a frontend developer, I want the product API responses to include the brand field, so that the frontend can render brand information.

#### Acceptance Criteria

1. WHEN a product has a `brand` value, THE product list API (`GET /api/products`) SHALL include the `brand` field in each product item
2. WHEN a product has a `brand` value, THE product detail API (`GET /api/products/:id`) SHALL include the `brand` field in the response
3. WHEN a product has no `brand` value, THE API responses SHALL omit the `brand` field (consistent with other optional fields like `sizeOptions`)

### Requirement 7: SuperAdmin 品牌 Logo 显示控制

**User Story:** As a super administrator, I want to control whether brand logos are displayed on product pages, so that I can toggle this feature on or off as needed.

#### Acceptance Criteria

1. THE feature-toggles settings SHALL include a `brandLogoEnabled` boolean field, defaulting to `true`
2. THE SuperAdmin settings page SHALL display a toggle switch for "品牌 Logo 显示" under the existing feature toggles section
3. WHEN `brandLogoEnabled` is `true`, THE Product_Detail_Page and Product_List_Page SHALL display brand badges/indicators as normal
4. WHEN `brandLogoEnabled` is `false`, THE Product_Detail_Page and Product_List_Page SHALL hide all brand badges/indicators
5. THE Admin_Products_Page brand selector SHALL remain functional regardless of the `brandLogoEnabled` toggle state (admins can always set brand)
