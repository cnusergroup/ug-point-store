# 实现计划：内容编辑与预约数展示增强（Content Edit & Reservation Count Display）

## 概述

为现有 Content Hub 模块新增内容编辑功能，涉及：新增错误码 `CONTENT_NOT_EDITABLE`、新增后端编辑模块 `content/edit.ts`、修改 `getContentDetail` 允许上传者查看非 approved 内容、Content Handler 新增 PUT 路由、CDK 新增 PUT 方法和 S3 DeleteObject 权限、前端 upload.tsx 复用为编辑页、前端 detail.tsx 增强编辑按钮与状态展示、5 种语言 i18n 翻译扩展。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 新增错误码与共享类型扩展
  - [x] 1.1 在 shared/errors.ts 中新增 CONTENT_NOT_EDITABLE 错误码
    - 在 `packages/shared/src/errors.ts` 的 `ErrorCodes` 中新增 `CONTENT_NOT_EDITABLE: 'CONTENT_NOT_EDITABLE'`
    - 在 `ErrorHttpStatus` 中新增 `[ErrorCodes.CONTENT_NOT_EDITABLE]: 400`
    - 在 `ErrorMessages` 中新增 `[ErrorCodes.CONTENT_NOT_EDITABLE]: '该内容当前状态不允许编辑（仅 pending/rejected 可编辑）'`
    - _需求: 1.4, 8.3_

- [x] 2. 后端编辑模块实现
  - [x] 2.1 创建 content/edit.ts 编辑核心逻辑
    - 创建 `packages/backend/src/content/edit.ts`
    - 实现 `editContentItem(input, dynamoClient, s3Client, tables, bucket)` 函数：
      - GetCommand 获取 ContentItem，不存在返回 CONTENT_NOT_FOUND
      - 权限校验：`uploaderId === userId`，不一致返回 FORBIDDEN
      - 状态校验：status 为 pending 或 rejected，否则返回 CONTENT_NOT_EDITABLE
      - 字段校验（仅对提供的字段）：title 1~100 字符、description 1~2000 字符、categoryId 存在于 Categories 表、videoUrl 空字符串清除/非空需合法 URL
      - 文件替换：如果提供新 fileKey 且与原 fileKey 不同，记录旧 fileKey
      - DynamoDB UpdateCommand 更新提供的字段 + status=pending + 清除 rejectReason/reviewerId/reviewedAt + 更新 updatedAt
      - 旧文件清理：fileKey 变更时使用 DeleteObjectCommand 删除旧 S3 文件，失败仅 console.error
      - 不修改 likeCount、commentCount、reservationCount
    - _需求: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4_

  - [x] 2.2 修改 content/list.ts 的 getContentDetail 接口
    - 在 `packages/backend/src/content/list.ts` 的 `getContentDetail` 函数中：
      - 现有逻辑：非 approved 状态一律返回 CONTENT_NOT_FOUND
      - 新增逻辑：非 approved 状态时，检查 `userId === item.uploaderId`，如果是上传者本人则正常返回内容
      - 非上传者访问非 approved 内容仍返回 CONTENT_NOT_FOUND
    - _需求: 6.3_

  - [x] 2.3 扩展 content/handler.ts 新增 PUT 路由
    - 在 `packages/backend/src/content/handler.ts` 中：
      - 导入 `editContentItem` 从 `./edit`
      - 在 `authenticatedHandler` 中新增 PUT 方法分支，匹配 `CONTENT_ID_REGEX`（已存在，复用）
      - 实现 `handleEditContentItem` 路由处理函数：解析请求体、调用 `getUserInfo` 获取用户信息、调用 `editContentItem`
    - _需求: 8.1, 8.2_

- [x] 3. 后端编辑模块测试
  - [x] 3.1 编写 content/edit.test.ts 单元测试
    - 创建 `packages/backend/src/content/edit.test.ts`
    - 测试场景：
      - 上传者编辑自己的 pending 内容成功
      - 上传者编辑自己的 rejected 内容成功
      - 非上传者编辑被拒绝（FORBIDDEN）
      - 编辑 approved 内容被拒绝（CONTENT_NOT_EDITABLE）
      - 编辑不存在的内容被拒绝（CONTENT_NOT_FOUND）
      - 标题超长被拒绝、描述超长被拒绝
      - 无效分类 ID 被拒绝、无效视频 URL 被拒绝
      - 空字符串视频 URL 清除字段
      - 文件替换时旧文件被删除
      - S3 删除失败不阻塞编辑成功
      - 编辑后 status 重置为 pending
      - 编辑后 rejectReason/reviewerId/reviewedAt 被清除
      - 编辑后 likeCount/commentCount/reservationCount 不变
      - 部分字段更新（仅提供 title）
      - 部分字段更新（仅提供 description）
    - _需求: 1.1, 1.2, 1.3, 1.4, 2.1~2.7, 3.1~3.5, 4.1~4.4_

  - [x] 3.2 编写属性测试 - Property 1: 编辑权限与状态门控
    - **Property 1: 编辑权限与状态门控**
    - 创建 `packages/backend/src/content/edit.property.test.ts`
    - 使用 fast-check 生成随机 userId + 随机 ContentItem（随机 uploaderId、随机 status）
    - 验证：userId === uploaderId 且 status ∈ {pending, rejected} 时成功；userId !== uploaderId 时返回 FORBIDDEN；status === approved 时返回 CONTENT_NOT_EDITABLE
    - **验证: 需求 1.1, 1.2, 1.3, 1.4**

  - [x] 3.3 编写属性测试 - Property 2: 部分更新正确性
    - **Property 2: 部分更新正确性**
    - 在 `packages/backend/src/content/edit.property.test.ts` 中添加
    - 使用 fast-check 生成随机 ContentItem + 随机字段子集
    - 验证：请求中提供的字段被更新为新值，未提供的字段保留原始值不变
    - **验证: 需求 2.1, 2.7, 3.1, 3.4, 3.5**

  - [x] 3.4 编写属性测试 - Property 3: 编辑输入校验正确性
    - **Property 3: 编辑输入校验正确性**
    - 在 `packages/backend/src/content/edit.property.test.ts` 中添加
    - 使用 fast-check 生成随机长度字符串（title/description）+ 随机 URL + 随机 categoryId
    - 验证：title 为空或超过 100 字符时被拒绝；description 为空或超过 2000 字符时被拒绝；categoryId 不存在时被拒绝；videoUrl 非空且非合法 URL 时被拒绝；合法值通过校验
    - **验证: 需求 2.2, 2.3, 2.4, 2.5**

  - [x] 3.5 编写属性测试 - Property 4: 文件替换时旧文件删除
    - **Property 4: 文件替换时旧文件删除**
    - 在 `packages/backend/src/content/edit.property.test.ts` 中添加
    - 使用 fast-check 生成随机旧/新 fileKey 对
    - 验证：新 fileKey 与原 fileKey 不同时发起 S3 DeleteObject 调用；fileKey 未变更时不发起删除调用
    - **验证: 需求 3.2**

  - [x] 3.6 编写属性测试 - Property 5: 编辑后状态重置不变量
    - **Property 5: 编辑后状态重置不变量**
    - 在 `packages/backend/src/content/edit.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效编辑输入 + 随机初始计数器值
    - 验证：编辑后 status 为 pending，rejectReason/reviewerId/reviewedAt 被清除，updatedAt 被更新，likeCount/commentCount/reservationCount 与编辑前完全一致
    - **验证: 需求 4.1, 4.2, 4.3, 4.4, 7.3**

  - [x] 3.7 编写属性测试 - Property 6: 上传者可查看自己的非 approved 内容
    - **Property 6: 上传者可查看自己的非 approved 内容**
    - 在 `packages/backend/src/content/edit.property.test.ts` 中添加
    - 使用 fast-check 生成随机 userId + 随机 ContentItem（随机 status）
    - 验证：userId === uploaderId 时 getContentDetail 返回内容（无论 status）；userId !== uploaderId 且 status !== approved 时返回 CONTENT_NOT_FOUND
    - **验证: 需求 6.3**

  - [x] 3.8 更新 content/list.test.ts 详情接口增强测试
    - 在 `packages/backend/src/content/list.test.ts` 中新增测试用例：
      - 上传者可查看自己的 pending 内容
      - 上传者可查看自己的 rejected 内容
      - 非上传者无法查看非 approved 内容（仍返回 CONTENT_NOT_FOUND）
    - _需求: 6.3_

  - [x] 3.9 更新 content/handler.test.ts 新增 PUT 路由测试
    - 在 `packages/backend/src/content/handler.test.ts` 中新增 PUT `/api/content/:id` 路由分发测试
    - _需求: 8.1, 8.2_

- [x] 4. 检查点 - 后端模块验证
  - 运行所有后端内容模块测试（edit、list、handler），确保编辑逻辑、权限校验、状态门控、详情接口增强全部正确。如有问题请向用户确认。

- [x] 5. CDK 配置变更
  - [x] 5.1 在 api-stack.ts 中新增 PUT 路由和 S3 DeleteObject 权限
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 在 `contentById` 资源上添加 `PUT` 方法，指向 `contentInt`（Content Lambda Integration）
      - 在 `configureImagesBucket` 方法中为 Content Lambda 添加 `s3:DeleteObject` 权限（`content/*` 路径）
    - _需求: 8.1, 8.3, 8.4_

- [x] 6. 前端编辑页面（复用 upload.tsx）
  - [x] 6.1 修改 upload.tsx 支持编辑模式
    - 在 `packages/frontend/src/pages/content/upload.tsx` 中：
      - 通过 URL 参数 `id` 区分新建模式和编辑模式
      - 编辑模式下：调用 GET `/api/content/:id` 获取现有内容数据，预填充表单所有字段
      - 编辑模式下：页面标题显示为编辑相关文案（使用 i18n）
      - 编辑模式下：文件上传区域展示当前文件名和大小，允许选择新文件替换
      - 编辑模式下：未选择新文件时保留原有文件信息不变
      - 编辑模式下：提交时调用 PUT `/api/content/:id`（仅发送变更的字段），如果选择了新文件则先上传到 S3
      - 编辑成功后返回内容详情页
    - _需求: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 6.2 修改 detail.tsx 增加编辑按钮和状态展示
    - 在 `packages/frontend/src/pages/content/detail.tsx` 中：
      - 当 `userId === item.uploaderId` 时展示"编辑"按钮
      - 当 `item.status === 'approved'` 时隐藏编辑按钮或置为不可点击
      - 点击编辑按钮导航至 `/pages/content/upload?id={contentId}`
      - 当 `userId === item.uploaderId` 时展示内容审核状态（pending/approved/rejected）
      - 当 `item.status === 'rejected'` 时展示拒绝原因（rejectReason）
    - _需求: 5.1, 5.2, 5.3, 6.1, 6.2_

- [x] 7. 检查点 - 前端页面验证
  - 确保 upload.tsx 编辑模式和 detail.tsx 增强编译通过，编辑流程逻辑完整。如有问题请向用户确认。

- [x] 8. i18n 多语言翻译扩展
  - [x] 8.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `contentHub.upload` 中新增编辑相关键：
      - `editTitle`：编辑页标题
      - `editSubmitButton`：编辑提交按钮文案
      - `editSubmitting`：编辑提交中文案
      - `editSubmitSuccess`：编辑成功提示
      - `editSubmitFailed`：编辑失败提示
      - `currentFile`：当前文件标签
      - `replaceFile`：替换文件提示
    - 在 `contentHub.detail` 中新增编辑相关键：
      - `editButton`：编辑按钮文案
      - `statusPending`：待审核状态标签
      - `statusApproved`：已通过状态标签
      - `statusRejected`：已拒绝状态标签
      - `rejectReasonLabel`：拒绝原因标签
      - `statusLabel`：状态标签
    - _需求: 5.1, 6.1, 6.2_

  - [x] 8.2 添加 5 种语言编辑相关翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加编辑相关简体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加编辑相关英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加编辑相关日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加编辑相关韩文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加编辑相关繁体中文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 5.1, 6.1, 6.2_

- [x] 9. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确，i18n 翻译完整，CDK 编译通过。如有问题请向用户确认。

## 备注

- 编辑模块独立为 `edit.ts`，与 `upload.ts` 职责分离
- 前端编辑页复用 `upload.tsx`，通过 URL 参数 `id` 区分新建/编辑模式
- 编辑后状态强制重置为 pending，确保修改内容经过重新审核
- 旧 S3 文件删除为异步操作，失败仅记录日志不阻塞编辑
- likeCount、commentCount、reservationCount 在编辑操作中保持不变
- 属性测试验证设计文档中定义的 6 个正确性属性
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
