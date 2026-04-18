# Implementation Plan: 内容编辑解锁与预约用户变更通知（Content Edit Notification）

## Overview

实现两项核心变更：（1）移除"有预约就不能编辑"的限制；（2）内容编辑成功后异步向活跃预约用户发送 `contentUpdated` 邮件通知。涉及后端 edit.ts 逻辑修改、email 模块扩展（NotificationType、模板、通知函数、种子数据）、feature-toggles 新增开关、前端设置页面集成、i18n 翻译。

## Tasks

- [x] 1. Backend — 移除预约编辑限制并扩展 edit 函数签名
  - [x] 1.1 修改 `packages/backend/src/content/edit.ts` — 移除 reservationCount 检查
    - 删除 `if (item.reservationCount > 0)` 返回 `CONTENT_NOT_EDITABLE` 的代码块（当前第 3 步）
    - 编辑操作对任意 reservationCount 值均允许继续执行
    - 确保 likeCount、commentCount、reservationCount 在编辑前后保持不变
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 扩展 `editContentItem` 函数签名 — 新增 `EditNotificationContext` 可选参数
    - 定义 `EditNotificationContext` 接口：dynamoClient、sesClient、reservationsTable、usersTable、emailTemplatesTable、senderEmail
    - 在 `editContentItem` 函数签名末尾新增 `notificationCtx?: EditNotificationContext` 参数
    - 编辑成功后，如果 `reservationCount > 0` 且提供了 `notificationCtx`，fire-and-forget 调用 `sendContentUpdatedNotifications`
    - 通知 Promise 的 `.catch` 仅记录错误日志，不阻塞编辑成功返回
    - _Requirements: 2.1, 3.7_

  - [x] 1.3 实现 `sendContentUpdatedNotifications` 异步通知函数
    - 检查 `emailContentUpdatedEnabled` 开关（通过 `getFeatureToggles`），关闭时直接返回
    - 使用 `contentId-index` GSI 查询 ContentReservations 表中所有匹配 contentId 的记录
    - 筛选 `activityDate > new Date().toISOString()` 的活跃预约
    - 对每个活跃预约的 userId，从 Users 表加载用户信息（email、nickname、locale）
    - 调用 `sendContentUpdatedEmail` 逐个发送邮件（TO 字段）
    - 单个用户发送失败记录日志，继续发送其余用户
    - 预约查询失败记录错误日志，不抛出异常
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.5, 3.6, 4.2, 4.3_

  - [ ]* 1.4 更新 `packages/backend/src/content/edit.test.ts` — 编辑限制移除的单元测试
    - 测试 reservationCount > 0 时编辑不再返回 CONTENT_NOT_EDITABLE 错误
    - 测试编辑成功后 reservationCount、likeCount、commentCount 保持不变
    - 测试编辑成功后异步触发通知（mock 验证 sendContentUpdatedNotifications 被调用）
    - 测试通知查询失败不影响编辑结果返回
    - _Requirements: 1.1, 1.2, 1.4, 2.4_

  - [ ]* 1.5 更新 `packages/backend/src/content/edit.property.test.ts` — 属性测试
    - **Property 1: 编辑不受 reservationCount 限制**
    - **Validates: Requirements 1.1**

  - [ ]* 1.6 更新 `packages/backend/src/content/edit.property.test.ts` — 属性测试
    - **Property 2: 编辑保持计数器不变量**
    - **Validates: Requirements 1.2, 1.4**

  - [ ]* 1.7 更新 `packages/backend/src/content/edit.property.test.ts` — 属性测试
    - **Property 3: 编辑重置状态为 pending**
    - **Validates: Requirements 1.3**

- [x] 2. Backend — Email 模块扩展
  - [x] 2.1 扩展 `packages/backend/src/email/send.ts` — NotificationType 新增 `contentUpdated`
    - 在 `NotificationType` 联合类型中新增 `'contentUpdated'`
    - _Requirements: 5.2_

  - [x] 2.2 扩展 `packages/backend/src/email/templates.ts` — TEMPLATE_VARIABLE_MAP 新增条目
    - 在 `TEMPLATE_VARIABLE_MAP` 中新增 `contentUpdated: ['contentTitle', 'userName', 'activityTopic', 'activityDate']`
    - _Requirements: 5.2_

  - [x] 2.3 扩展 `packages/backend/src/email/notifications.ts` — 新增 sendContentUpdatedEmail 和 TOGGLE_MAP 条目
    - 在 `TOGGLE_MAP` 中新增 `contentUpdated: 'emailContentUpdatedEnabled'`
    - 新增 `sendContentUpdatedEmail(ctx, userId, contentTitle, activityTopic, activityDate)` 函数
    - 实现模式与 `sendPointsEarnedEmail` 一致：检查 toggle → loadUser → loadTemplateWithFallback → replaceVariables → sendEmail
    - 模板变量映射：`contentTitle`、`userName`（= nickname）、`activityTopic`、`activityDate`
    - 用户无 locale 偏好时使用 `zh` 作为默认
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.3_

  - [x] 2.4 扩展 `packages/backend/src/email/seed.ts` — 新增 contentUpdated 默认模板
    - 新增 `contentUpdatedTemplates` 对象，包含 5 种语言的默认模板（zh/en/ja/ko/zh-TW）
    - zh subject: "📝 您预约的内容有更新，请确认最新版本"
    - en subject: "📝 Reserved content has been updated, please review the latest version"
    - ja subject: "📝 予約したコンテンツが更新されました。最新版をご確認ください"
    - ko subject: "📝 예약한 콘텐츠가 업데이트되었습니다. 최신 버전을 확인해 주세요"
    - zh-TW subject: "📝 您預約的內容有更新，請確認最新版本"
    - 所有模板 body 包含 `{{contentTitle}}`、`{{userName}}`、`{{activityTopic}}`、`{{activityDate}}` 四个变量，末尾包含自动发送声明
    - 将 `contentUpdated` 加入 `ALL_TYPES` 数组和 `TEMPLATE_MAP`
    - `getDefaultTemplates()` 返回 30 条模板（6 类型 × 5 语言）
    - **重要**：`seedDefaultTemplates` 需要分两批写入（DynamoDB BatchWrite 限制每次最多 25 条），修改为分批处理
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 2.5 新建 `packages/backend/src/content/edit-notification.test.ts` — 通知流程单元测试
    - 测试 `sendContentUpdatedNotifications` 完整流程（mock DynamoDB 和 SES）
    - 测试活跃预约筛选逻辑（过去/未来日期）
    - 测试单个邮件发送失败不中断其余发送
    - 测试无活跃预约时不发送邮件
    - 测试开关关闭时不发送邮件
    - 测试用户无 email 时跳过该用户
    - 测试用户无 locale 时使用 zh 默认
    - _Requirements: 2.2, 2.4, 3.1, 3.2, 3.3, 3.6, 4.3_

  - [ ]* 2.6 新建 `packages/backend/src/content/edit-notification.property.test.ts` — 属性测试
    - **Property 4: 活跃预约筛选正确性**
    - **Validates: Requirements 2.2**

  - [ ]* 2.7 新建 `packages/backend/src/content/edit-notification.property.test.ts` — 属性测试
    - **Property 5: 开关控制通知发送**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 2.8 更新 `packages/backend/src/email/seed.test.ts` — 种子模板测试
    - 验证 `getDefaultTemplates()` 返回 30 条模板（含 contentUpdated 的 5 条）
    - 验证 contentUpdated 模板包含正确的变量占位符
    - 验证 `seedDefaultTemplates` 分批写入逻辑（两批：25 + 5）
    - _Requirements: 6.1, 6.6, 6.7_

- [x] 3. Backend — Feature Toggles 扩展
  - [x] 3.1 扩展 `packages/backend/src/settings/feature-toggles.ts` — 新增 emailContentUpdatedEnabled
    - 在 `FeatureToggles` 接口新增 `emailContentUpdatedEnabled: boolean`
    - 在 `DEFAULT_TOGGLES` 中新增 `emailContentUpdatedEnabled: false`
    - 在 `getFeatureToggles` 读取逻辑中新增 `emailContentUpdatedEnabled: result.Item.emailContentUpdatedEnabled === true`
    - 在 `UpdateFeatureTogglesInput` 接口新增 `emailContentUpdatedEnabled: boolean`
    - 在 `updateFeatureToggles` 函数的验证、UpdateExpression、ExpressionAttributeValues 中新增该字段
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [ ]* 3.2 更新 feature-toggles 测试 — 验证新开关
    - 验证 `emailContentUpdatedEnabled` 默认值为 false
    - 验证更新和读取 round-trip
    - _Requirements: 4.1, 4.2_

- [x] 4. Backend — Content Handler 集成
  - [x] 4.1 修改 `packages/backend/src/content/handler.ts` — 传递 EditNotificationContext
    - 在 handler 顶部新增 `import { SESClient } from '@aws-sdk/client-ses'` 和 `const sesClient = new SESClient({})`
    - 读取环境变量 `EMAIL_TEMPLATES_TABLE` 和 `SENDER_EMAIL`
    - 在 `handleEditContentItem` 中构建 `EditNotificationContext` 对象
    - 将 `notificationCtx` 作为新参数传递给 `editContentItem`
    - _Requirements: 2.1, 3.7_

- [x] 5. Checkpoint — 确保所有后端测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend — 设置页面集成
  - [x] 6.1 修改 `packages/frontend/src/pages/admin/settings.tsx` — 新增 contentUpdated 开关和模板编辑
    - 在 `FeatureToggles` 接口新增 `emailContentUpdatedEnabled: boolean`
    - 在 `NotificationType` 联合类型新增 `'contentUpdated'`
    - 在 `NOTIFICATION_TYPE_LABELS` 新增 `contentUpdated: 'admin.settings.email.contentUpdatedLabel'`
    - 在邮件通知开关列表中新增 contentUpdated 开关项（key: `emailContentUpdatedEnabled`，notificationType: `contentUpdated`）
    - 复用现有 `EmailTemplateEditorModal` 组件，支持 Locale 切换、subject/body 编辑、变量参考面板
    - 更新 `seedTemplateHint` 文案为 30 条模板（6 种通知 × 5 种语言）
    - 仅 SuperAdmin 可见邮件通知设置区域
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Frontend — i18n 翻译
  - [x] 7.1 更新 `packages/frontend/src/i18n/types.ts` — 新增翻译键类型
    - 在 `admin.settings.email` 接口中新增 `contentUpdatedLabel: string` 和 `contentUpdatedDesc: string`
    - _Requirements: 8.6_

  - [x] 7.2 更新所有 5 种语言文件 — 新增 contentUpdated 翻译
    - `packages/frontend/src/i18n/zh.ts`：contentUpdatedLabel = "内容更新通知"，contentUpdatedDesc = "内容编辑后自动通知活跃预约用户"
    - `packages/frontend/src/i18n/en.ts`：contentUpdatedLabel = "Content Update Notification"，contentUpdatedDesc = "Automatically notify active reservation users after content is edited"
    - `packages/frontend/src/i18n/ja.ts`：contentUpdatedLabel = "コンテンツ更新通知"，contentUpdatedDesc = "コンテンツ編集後、アクティブな予約ユーザーに自動通知"
    - `packages/frontend/src/i18n/ko.ts`：contentUpdatedLabel = "콘텐츠 업데이트 알림"，contentUpdatedDesc = "콘텐츠 편집 후 활성 예약 사용자에게 자동 알림"
    - `packages/frontend/src/i18n/zh-TW.ts`：contentUpdatedLabel = "內容更新通知"，contentUpdatedDesc = "內容編輯後自動通知活躍預約用戶"
    - 使用 `useTranslation` hook 获取翻译文本，不硬编码任何用户可见字符串
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 8. Final checkpoint — 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- 邮件发送采用 fire-and-forget 模式，失败仅记录日志，不影响编辑操作的成功返回
- `seedDefaultTemplates` 新增 5 条模板后总数为 30，需分两批写入（DynamoDB BatchWrite 限制 25 条/次）
- `contentId-index` GSI 已存在于 ContentReservations 表，无需 CDK 变更
