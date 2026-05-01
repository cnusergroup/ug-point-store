# Tasks: Simplified Shipping

## Task 1: Remove TRACKING_NUMBER_REQUIRED from shared package

- [x] 1.1 Remove `TRACKING_NUMBER_REQUIRED` entry from `ErrorCodes` object in `packages/shared/src/errors.ts`
- [x] 1.2 Remove `TRACKING_NUMBER_REQUIRED` entry from `ErrorHttpStatus` record in `packages/shared/src/errors.ts`
- [x] 1.3 Remove `TRACKING_NUMBER_REQUIRED` entry from `ErrorMessages` record in `packages/shared/src/errors.ts`
- [x] 1.4 Verify `trackingNumber` remains optional in `UpdateShippingRequest` and `OrderResponse` types in `packages/shared/src/types.ts` (no change needed, just confirm)
- [x] 1.5 Run `npm run build` in packages/shared to verify no compile errors

## Task 2: Remove tracking number validation from backend updateShipping

- [x] 2.1 Remove the tracking number required validation block from `updateShipping()` in `packages/backend/src/orders/admin-order.ts` (remove the `if (status === 'shipped' && (!trackingNumber || trackingNumber.trim() === ''))` block)
- [x] 2.2 Keep the existing logic that stores `trackingNumber` when provided (backward compatibility)
- [x] 2.3 Update existing unit tests in `packages/backend/src/orders/admin-order.test.ts`: change the two `TRACKING_NUMBER_REQUIRED` tests to verify shipping without tracking number now succeeds
- [x] 2.4 Add unit test: shipping with a non-empty tracking number still stores it on the order
- [x] 2.5 Run backend tests to verify all pass

## Task 3: Update shipped email notification to handle missing tracking number

- [x] 3.1 Update `sendOrderShippedEmail()` in `packages/backend/src/email/notifications.ts` to substitute contact email message (`yuanliang@busite.cn`) when `trackingNumber` is undefined or empty
- [x] 3.2 Add unit test: `sendOrderShippedEmail` without tracking number passes contact email in template variables
- [x] 3.3 Add unit test: `sendOrderShippedEmail` with tracking number still passes the tracking number in template variables
- [x] 3.4 Run backend tests to verify all pass

## Task 4: Add i18n translation keys for contact message

- [x] 4.1 Add `shippingContactMessage: string` to the `orderDetail` section in `packages/frontend/src/i18n/types.ts`
- [x] 4.2 Add zh translation: `shippingContactMessage: '如需查询发货状态，请邮件联系 yuanliang@busite.cn'` in `packages/frontend/src/i18n/zh.ts`
- [x] 4.3 Add en translation: `shippingContactMessage: 'To check shipping status, please email yuanliang@busite.cn'` in `packages/frontend/src/i18n/en.ts`
- [x] 4.4 Add ja translation: `shippingContactMessage: '配送状況を確認するには、yuanliang@busite.cn までメールでお問い合わせください'` in `packages/frontend/src/i18n/ja.ts`
- [x] 4.5 Add ko translation: `shippingContactMessage: '배송 상태를 확인하려면 yuanliang@busite.cn으로 이메일 문의해 주세요'` in `packages/frontend/src/i18n/ko.ts`
- [x] 4.6 Add zh-TW translation: `shippingContactMessage: '如需查詢發貨狀態，請郵件聯繫 yuanliang@busite.cn'` in `packages/frontend/src/i18n/zh-TW.ts`
- [x] 4.7 Run TypeScript type check to verify all locale files satisfy `TranslationDict`

## Task 5: Update admin orders page to remove tracking number input

- [x] 5.1 In `packages/frontend/src/pages/admin/orders.tsx`, remove the tracking number input field from the ship form when `shipTargetStatus === 'shipped'` (remove the conditional block that renders the tracking number input)
- [x] 5.2 Remove the client-side validation that checks `shipTrackingNumber.trim()` is non-empty when `shipTargetStatus === 'shipped'`
- [x] 5.3 Hide the tracking number display section in admin order detail view (remove or conditionally hide the `trackingNumberTitle` / `trackingNumber` display block)
- [x] 5.4 Verify the ship form still works for other status transitions and the remark field remains functional

## Task 6: Update buyer order detail page to show contact email message

- [x] 6.1 In `packages/frontend/src/pages/order-detail/index.tsx`, when `shippingStatus === 'shipped'`, display the i18n `orderDetail.shippingContactMessage` text instead of the tracking number
- [x] 6.2 Hide the tracking number display (`order.trackingNumber` conditional block) for shipped orders
- [x] 6.3 Ensure the contact email message is NOT displayed when `shippingStatus` is `'pending'` or `'cancelled'`
- [x] 6.4 Style the contact message using existing CSS variables (use `--text-secondary` color, appropriate spacing with `--space-*` variables)

## Task 7: Write property-based tests

- [x] 7.1 Write property test for Property 1 (shipping without tracking number always succeeds): generate random pending orders and random trackingNumber values (undefined, empty, whitespace), verify `updateShipping` returns `{ success: true }` — tag: `Feature: simplified-shipping, Property 1: Shipping without tracking number always succeeds`
- [x] 7.2 Write property test for Property 2 (provided tracking number is stored): generate random pending orders and random non-empty tracking number strings, verify the tracking number is stored via the DynamoDB UpdateCommand — tag: `Feature: simplified-shipping, Property 2: Provided tracking number is stored on the order`
- [x] 7.3 Run all property tests and verify they pass with minimum 100 iterations

## Task 8: Final verification

- [x] 8.1 Run full backend test suite (`npm test` in packages/backend) to verify no regressions
- [x] 8.2 Run TypeScript compilation across all packages to verify no type errors
