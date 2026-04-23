# Implementation Plan: Product Brand Logo

## Overview

为商品添加可选的 `brand` 字段，涵盖共享类型、后端验证、前端选择器和品牌徽章展示。按层级从底向上实现：shared types → shared errors → backend validation → backend handler → frontend admin form → frontend detail page → frontend list page。

## Tasks

- [x] 1. Add shared types and error code for brand
  - [x] 1.1 Add `ProductBrand` type, `VALID_BRANDS` constant, and `brand?` field to `Product` interface in `packages/shared/src/types.ts`
    - Add `export type ProductBrand = 'aws' | 'ug' | 'awscloud';`
    - Add `export const VALID_BRANDS: ProductBrand[] = ['aws', 'ug', 'awscloud'];`
    - Add `brand?: ProductBrand;` to the `Product` interface
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Add `INVALID_BRAND` error code to `packages/shared/src/errors.ts`
    - Add entry to `ErrorCodes`, `ErrorHttpStatus` (400), and `ErrorMessages`
    - Message: `'brand 值无效，仅允许 aws、ug、awscloud'`
    - _Requirements: 2.2_

- [x] 2. Implement backend brand validation and handler passthrough
  - [x] 2.1 Add `validateBrand` function in `packages/backend/src/admin/products.ts`
    - Accept `unknown` input, return `null` for valid values (`undefined`, `null`, `''`, or valid brand string), return error object for invalid non-empty strings
    - Import `VALID_BRANDS` from `@points-mall/shared`
    - Call `validateBrand` at the start of `createPointsProduct`, `createCodeExclusiveProduct`, and `updateProduct`; return early with error if invalid
    - Spread `brand` into the product object in create functions (only when truthy)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.2 Pass `brand` field through `handleCreateProduct` in `packages/backend/src/admin/handler.ts`
    - Add `brand: body.brand as string | undefined` to both points and code_exclusive input objects
    - Update `CreatePointsProductInput` and `CreateCodeExclusiveProductInput` interfaces to include `brand?: string`
    - `handleUpdateProduct` already passes `body` directly to `updateProduct`, so `brand` flows through automatically
    - _Requirements: 2.1, 2.4, 6.1, 6.2, 6.3_
  - [ ]* 2.3 Write property test for brand validation (Property 1)
    - **Property 1: Brand validation accepts valid values and rejects all others**
    - Generate arbitrary strings with `fast-check`; verify `validateBrand` returns `null` iff input is in `VALID_BRANDS` or is `undefined`/`null`/`''`
    - Create file `packages/backend/src/admin/product-brand.property.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add brand selector to admin product form
  - [x] 4.1 Add brand radio buttons to the product form in `packages/frontend/src/pages/admin/products.tsx`
    - Add `brand` field to `EMPTY_FORM` (default `''`)
    - Add `brand` field to `AdminProduct` interface
    - Render three radio buttons (AWS / 亚马逊云科技UG / 亚马逊云科技) below description, above images
    - Support click-to-deselect (clicking selected radio clears to `''`)
    - Pre-select on edit based on existing `product.brand`
    - Include `brand` in the submit body (omit if empty)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5. Add brand badge to product detail page
  - [x] 5.1 Display brand badge in `packages/frontend/src/pages/product/index.tsx`
    - Add `brand?: string` to `ProductDetail` interface
    - Define `BRAND_DISPLAY` mapping: `{ aws: 'AWS', ug: '亚马逊云科技UG', awscloud: '亚马逊云科技' }`
    - Render a styled text badge near the product name when `product.brand` is set
    - Use CSS variables for styling consistent with existing role-badge pattern
    - Do not render anything when `brand` is absent
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 6. Add brand indicator to product list page
  - [x] 6.1 Display brand indicator on product cards in `packages/frontend/src/pages/index/index.tsx`
    - Add `brand?: string` to `ProductListItem` interface
    - Define `BRAND_DISPLAY` mapping (same as detail page)
    - Render a compact brand tag in the card body area, near the product name
    - Do not render anything when `brand` is absent
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Add brand badge styles
  - [x] 7.1 Add `.brand-badge` CSS styles to relevant SCSS files
    - Style in `packages/frontend/src/pages/product/index.scss` for detail page
    - Style in `packages/frontend/src/pages/index/index.scss` for list page
    - Style in `packages/frontend/src/pages/admin/products.scss` for admin form radio buttons
    - Use CSS variables (`--bg-surface`, `--text-secondary`, `--radius-sm`, `--space-*`) per design system
    - _Requirements: 4.2, 5.2_

- [x] 8. Add `brandLogoEnabled` feature toggle to backend and frontend
  - [x] 8.1 Add `brandLogoEnabled` to `FeatureToggles` interface and defaults in `packages/backend/src/settings/feature-toggles.ts`
    - Add `brandLogoEnabled: boolean` to `FeatureToggles` interface with JSDoc comment
    - Add `brandLogoEnabled: true` to `DEFAULT_TOGGLES` (default enabled)
    - Add `brandLogoEnabled: boolean` to `UpdateFeatureTogglesInput` interface
    - In `getFeatureToggles`, read `brandLogoEnabled` with `result.Item.brandLogoEnabled !== false` (default true)
    - In `updateFeatureToggles`, add validation (`typeof input.brandLogoEnabled !== 'boolean'`), add to UpdateExpression and ExpressionAttributeValues, and include in returned settings
    - _Requirements: 7.1_
  - [x] 8.2 Add "品牌 Logo 显示" toggle switch to SuperAdmin settings page in `packages/frontend/src/pages/admin/settings.tsx`
    - Add `brandLogoEnabled: boolean` to frontend `FeatureToggles` interface, default `true`
    - Add a Switch toggle in the feature-toggles section with label "品牌 Logo 显示" and description "控制商品详情页和列表页是否展示品牌徽章"
    - Wire the toggle to `settings.brandLogoEnabled` and include in save payload
    - _Requirements: 7.1, 7.2_
  - [x] 8.3 Update product detail page to check `brandLogoEnabled` before rendering brand badge in `packages/frontend/src/pages/product/index.tsx`
    - Fetch feature toggles from store or API (use existing `useAppStore` or fetch `/api/settings/feature-toggles`)
    - Only render Brand_Badge when `brandLogoEnabled` is `true`
    - _Requirements: 7.3, 7.4_
  - [x] 8.4 Update product list page to check `brandLogoEnabled` before rendering brand indicator in `packages/frontend/src/pages/index/index.tsx`
    - Fetch feature toggles from store or API (same approach as detail page)
    - Only render brand indicator when `brandLogoEnabled` is `true`
    - _Requirements: 7.3, 7.4, 7.5_

- [x] 9. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The `brand` field is optional — existing products are unaffected (no migration needed)
- API responses automatically include `brand` since DynamoDB stores it as a product attribute and the scan/get returns all attributes
- Property tests validate the `validateBrand` function against the correctness properties defined in the design
