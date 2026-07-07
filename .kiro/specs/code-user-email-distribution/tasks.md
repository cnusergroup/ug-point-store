# Implementation Plan: Code 兑换码多候选与按用户邮件分发

## Overview

本实现计划在现有「Code 兑换码」系统上扩展两条能力：(1) 多商品候选兑换码（择一兑换），(2) 按用户列表生成并邮件分发。实现顺序遵循自底向上、增量集成的原则：先扩展共享类型与后端纯逻辑（候选校验、分配规划、候选解析），再叠加分发编排、用户查询、邮件模板与发送，随后改造兑换流程，最后接线后端路由与前端页面/兑换入口。每一步都建立在前一步之上，测试紧贴对应实现以尽早发现问题。

属性测试覆盖设计文档中的 Property 1–19（库：`vitest` + `fast-check`，每个属性 ≥ 100 次迭代，按设计「属性到测试文件映射」放置），与单元/示例测试、集成测试互补。

## Tasks

- [x] 1. 扩展共享类型 `CodeInfo`
  - [x] 1.1 在 `packages/shared/src/types.ts` 中扩展 `CodeInfo` 与新增 `CodeEmailStatus`
    - 为 `CodeInfo` 新增可选字段：`productIds?: string[]`（有序候选集合，1–10）、`allocatedUserId?: string`、`batchId?: string`、`emailStatus?: CodeEmailStatus`
    - 保留现有 `productId?: string` 作为兼容镜像字段
    - 新增类型 `export type CodeEmailStatus = 'sent' | 'failed' | 'no_email' | 'pending';`
    - 确认导出且不破坏现有引用（编译通过）
    - _Requirements: 1.2, 1.3, 5.8, 9.1_

- [x] 2. 后端：候选商品校验与分发码生成（`admin/codes.ts`）
  - [x] 2.1 实现 `validateCandidateProducts` 与 `MAX_CANDIDATE_PRODUCTS`
    - 在 `packages/backend/src/admin/codes.ts` 新增 `export const MAX_CANDIDATE_PRODUCTS = 10;` 与 `CandidateValidationResult` 接口
    - 校验顺序与错误码：空列表→`INVALID_PRODUCT_SELECTION`；长度 >10→`TOO_MANY_PRODUCTS`；含重复标识符→`DUPLICATE_PRODUCT`；查商品后含非 `code_exclusive`→`INVALID_PRODUCT_TYPE`；含不存在或非 active（已下架）→`INVALID_PRODUCT_SELECTION`
    - 校验通过返回 `{ valid: true, products: [{ productId, name }] }`（供邮件 `productNames` 使用，保持输入顺序）
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 8.2_

  - [x]* 2.2 编写候选集合校验属性测试
    - **Property 2: 候选集合校验**
    - 文件：`packages/backend/src/admin/codes.property.test.ts`（扩展）
    - 生成含空/超 10/重复/非 code_exclusive/不存在或下架的候选列表与合法列表，mock products 表读取，断言对应错误码与"通过当且仅当全部存在且 active 的 code_exclusive 且 1–10 无重复"
    - `fast-check` ≥ 100 次迭代
    - **Validates: Requirements 1.6, 1.7, 1.8, 1.9, 8.2**

  - [x] 2.3 实现 `buildAllocationPlan` 纯函数
    - 在 `packages/backend/src/admin/codes.ts`（或 `codes-distribution.ts`，与设计一致放在 distribution 服务暴露）实现 `export function buildAllocationPlan(recipients: RecipientAllocation[]): string[]`
    - 将每个 recipient 展开为重复 `allocatedCount` 次的 `userId` 序列，结果长度 = Σ allocatedCount，顺序稳定
    - 定义 `RecipientAllocation { userId: string; allocatedCount: number }`
    - _Requirements: 5.4, 5.6, 5.7_

  - [x] 2.4 实现 `generateDistributionCodes`（25 条/批 BatchWrite）
    - 新增 `GenerateDistributionCodesInput`、`DistributionCodeRecord` 接口
    - 基于 `buildAllocationPlan` 为每个分配生成一条码记录：`type='product'`、`maxUses=1`、`currentUses=0`、`status='active'`、`productIds=候选集合`；候选集合长度为 1 时另写 `productId`；写入 `allocatedUserId`、`batchId`（单批次统一 ULID）、`createdAt`
    - 以每批 ≤25 条 `BatchWriteCommand` 写入 Codes 表
    - 返回 `CodeOperationResult<{ batchId; codes: DistributionCodeRecord[] }>`
    - 保持现有 `generateProductCodes` 不变（兼容 `/api/admin/codes/product-code`）
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 5.5, 5.6, 5.8, 8.4_

- [x] 3. 后端：兑换码分发服务（`admin/codes-distribution.ts`）
  - [x] 3.1 实现 `distributeCodes` 编排
    - 新建 `packages/backend/src/admin/codes-distribution.ts`，定义 `DistributeCodesInput`、`DistributionResultSummary`
    - 流程：二次校验 recipients（非空、各 `allocatedCount` 为正整数，否则 `INVALID_REQUEST`）→ `validateCandidateProducts`（失败整体拒绝，含商品不存在/下架→`INVALID_PRODUCT_SELECTION`，生成前拒绝）→ `generateDistributionCodes` → 逐用户调用邮件发送 → 汇总
    - 生成后不因邮件失败回滚；按用户聚合其全部码值后发送
    - 返回 `{ batchId, totalCodes, sentSuccess[], sentFailed[], skippedNoEmail[] }`，并据发送结果回写每个码的 `emailStatus`
    - _Requirements: 5.4, 5.5, 6.1, 6.5, 8.2, 8.5, 8.6_

  - [x]* 3.2 编写生成码不变量属性测试
    - **Property 1: 生成码不变量**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 随机候选集合(1–10) + recipients，断言每个码 `type==='product'`、`maxUses===1`、`currentUses===0`、`status==='active'`、`productIds` 深度等于输入候选集合（保序），且仅当候选长度为 1 时 `productId` 等于该唯一候选
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**

  - [x]* 3.3 编写分配一致性属性测试
    - **Property 11: 分配一致性**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 随机 recipients 与正整数码数，断言：码总数 = Σ allocatedCount；按 `allocatedUserId` 分组每用户恰好得其 `allocatedCount` 个；跨用户 `codeId` 两两不相交；所有码同一 `batchId` 且 `allocatedUserId` ∈ recipients；无未分配/重复分配
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8**

  - [x]* 3.4 编写总数汇总属性测试
    - **Property 12: 总数汇总计算**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 随机 recipients，断言 `Total_Code_Count` === Σ allocatedCount
    - **Validates: Requirements 3.4, 5.4**

  - [x]* 3.5 编写分发结果三态划分属性测试
    - **Property 15: 分发结果三态划分**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 混合"有邮箱发送成功/发送失败/无邮箱"用户，断言每用户恰属一类（互斥穷尽），且成功+失败+跳过数之和 = 收件用户总数
    - **Validates: Requirements 6.5, 8.6**

  - [x]* 3.6 编写部分失败不回滚属性测试
    - **Property 16: 部分失败不回滚**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 注入部分发送失败/部分无邮箱，断言全部已生成码记录保留（无删除），无邮箱→`skippedNoEmail`、失败→`sentFailed`，其余继续处理
    - **Validates: Requirements 8.1, 8.3, 8.5**

  - [x]* 3.7 编写分批写入上限属性测试
    - **Property 17: 分批写入上限**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 随机较大总数 N，断言 `BatchWrite` 每批 ≤25 条且写入条目总数 = N
    - **Validates: Requirements 8.4**

  - [x] 3.8 实现 `resendCodeEmail` 单码重发
    - 在 `codes-distribution.ts` 实现：按 `codeId` 读取码记录 → 取 `allocatedUserId` → 加载用户，无有效邮箱返回 `NO_EMAIL` → 仅向该用户重发含该码的分发邮件 → 更新该码 `emailStatus`
    - 返回 `CodeOperationResult<{ codeId; emailStatus }>`
    - _Requirements: 9.3, 9.4, 9.5, 9.6_

  - [x]* 3.9 编写收件人隔离属性测试
    - **Property 14: 收件人隔离**
    - 文件：`packages/backend/src/email/code-distribution-email.property.test.ts`
    - 多用户码分配下，断言发给 A 的邮件仅含 A 的码值不含 B 的；重发仅发送给码持久化的 `allocatedUserId`
    - **Validates: Requirements 6.4, 9.3, 9.6**

  - [x]* 3.10 编写分发与重发鉴权属性测试
    - **Property 19: 分发与重发鉴权**
    - 文件：`packages/backend/src/admin/codes-distribution.property.test.ts`
    - 随机角色集合，断言生成/分发/重发当且仅当含 `Admin` 或 `SuperAdmin` 时允许，否则 `FORBIDDEN`
    - **Validates: Requirements 10.1**

- [x] 4. Checkpoint - 分发与生成核心逻辑完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. 后端：用户查询服务（`admin/user-search.ts`）
  - [x] 5.1 实现 `searchUsers`（复用 `entityType-createdAt-index` GSI）
    - 新建 `packages/backend/src/admin/user-search.ts`，定义 `SearchUsersOptions`、`SearchUserItem`、`SearchUsersResult`
    - 以 `entityType-createdAt-index` GSI 查询（`ScanIndexForward=false`），`role` 用 `FilterExpression contains(#roles,:role)` 服务端过滤
    - `keyword` 在每页结果上以 `toLowerCase().includes()` 对 nickname/email 不区分大小写内存过滤
    - `pageSize` 默认 20、clamp 至 [1,100]；`lastKey` 解析失败则从首页查询
    - 返回单页 `users`（含 `userId`、`nickname`、`email`、`roles`）+ `lastKey` 游标
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 5.2 编写关键字不区分大小写匹配属性测试
    - **Property 8: 关键字不区分大小写匹配**
    - 文件：`packages/backend/src/admin/user-search.property.test.ts`
    - 随机用户集合 + 关键字，断言返回集合恰好等于昵称或邮箱以不区分大小写 contains 该关键字的用户
    - **Validates: Requirements 4.1**

  - [x]* 5.3 编写角色过滤属性测试
    - **Property 9: 角色过滤**
    - 文件：`packages/backend/src/admin/user-search.property.test.ts`
    - 随机角色与过滤值，断言返回每个用户均含该角色、不含该角色者不出现
    - **Validates: Requirements 4.2**

  - [x]* 5.4 编写查询结果字段完整属性测试
    - **Property 10: 查询结果字段完整**
    - 文件：`packages/backend/src/admin/user-search.property.test.ts`
    - 随机用户集合，断言每个返回条目同时含 `userId`、`nickname`、`email`、`roles`
    - **Validates: Requirements 4.4**

- [x] 6. 后端：邮件模板（`email/templates.ts` & `email/seed.ts`）
  - [x] 6.1 新增 `codeDistribution` 模板类型与变量映射
    - 在 `packages/backend/src/email/templates.ts` 的 `NotificationType` 增加 `'codeDistribution'`
    - 设置 `TEMPLATE_VARIABLE_MAP.codeDistribution = ['nickname', 'codeList', 'productNames', 'codeCount', 'storeUrl']`
    - 确认 `validateTemplateInput` 适用（主题 1–200、正文 1–10000）
    - _Requirements: 7.1, 7.4, 7.7_

  - [x] 6.2 在 `email/seed.ts` 新增多语言默认模板
    - 为 `codeDistribution` 增加 zh/en/ja/ko/zh-TW 默认模板（主题 + HTML 正文）
    - 正文复用 `STORE_LINK` 风格的 CTA 按钮，并将商城地址参数化为 `{{storeUrl}}`，包含 `{{nickname}}`、`{{codeList}}`、`{{productNames}}`、`{{codeCount}}` 占位符
    - 确保默认模板同样含 `storeUrl` 商城链接（模板缺失时仍可送达）
    - _Requirements: 7.5, 7.6_

  - [x]* 6.3 编写模板长度校验属性测试
    - **Property 18: 模板长度校验**
    - 文件：`packages/backend/src/email/templates.property.test.ts`（扩展）
    - 随机主题/正文长度，断言 `validateTemplateInput` 当且仅当主题 1–200 且正文 1–10000 时返回有效
    - **Validates: Requirements 7.7**

  - [x]* 6.4 编写 codeDistribution 变量集合单元测试
    - 断言 `TEMPLATE_VARIABLE_MAP.codeDistribution` 恰好暴露 `nickname/codeList/productNames/codeCount/storeUrl`，且模板管理可识别该类型（SMOKE）
    - 文件：`packages/backend/src/email/templates.test.ts`（扩展）
    - _Requirements: 7.1, 7.4_

- [x] 7. 后端：发送兑换码分发邮件（`email/notifications.ts`）
  - [x] 7.1 实现 `sendCodeDistributionEmail`
    - 在 `packages/backend/src/email/notifications.ts` 新增，签名含 `userId`、`codeValues`、`productNames`、`storeUrl`
    - 不经过 `isEmailEnabled` 订阅门控（管理员事务性邮件）
    - 加载用户 → 无邮箱返回 `{ status: 'no_email' }`；加载 `codeDistribution` 模板（locale 回退 zh，缺失用默认）→ 渲染 `nickname/codeList/productNames/codeCount/storeUrl`（`codeList` 以 HTML 列表/换行拼接，`codeCount = codeValues.length`）→ 发送
    - 返回 `{ status: 'sent' | 'failed' | 'no_email', error? }`
    - _Requirements: 6.1, 6.2, 6.3, 7.2, 7.3_

  - [x]* 7.2 编写分发邮件含全部码且含商城链接属性测试
    - **Property 13: 分发邮件包含本人全部码且含商城链接**
    - 文件：`packages/backend/src/email/code-distribution-email.property.test.ts`
    - 随机码集合 + storeUrl，断言渲染正文包含该用户全部码值、含一个 `href` 为 storeUrl 的链接、且不残留任何已提供变量的 `{{占位符}}`
    - **Validates: Requirements 6.1, 6.2, 6.3, 7.3, 7.5**

  - [x]* 7.3 编写模板回退示例测试
    - 未配置 `codeDistribution` 模板时使用系统默认模板发送且正文含商城链接（EDGE_CASE）
    - 文件：`packages/backend/src/email/code-distribution-email.property.test.ts` 或对应 `*.test.ts`
    - _Requirements: 7.6_

- [x] 8. Checkpoint - 用户查询与邮件链路完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. 后端：多候选择一兑换（`redemptions/code-redemption.ts`）
  - [x] 9.1 实现 `lookupCodeCandidates`
    - 在 `packages/backend/src/redemptions/code-redemption.ts` 新增：按 `codeValue` 查码 → 取候选集合 `productIds ?? (productId ? [productId] : [])` → 批量取商品详情
    - 返回 `{ success, candidates?: CodeCandidate[], error? }`；码无效/非 product/已耗尽返回对应错误码
    - _Requirements: 2.1_

  - [x]* 9.2 编写候选集合解析向后兼容属性测试
    - **Property 3: 候选集合解析向后兼容**
    - 文件：`packages/backend/src/redemptions/code-candidate-resolve.property.test.ts`
    - 抽取候选解析为可测纯函数 `resolveCandidateIds(code)`，断言旧记录（仅 `productId`）返回 `[productId]`，新记录（含 `productIds`）返回 `productIds`
    - **Validates: Requirements 1.10**

  - [x]* 9.3 编写兑换返回候选集合属性测试
    - **Property 4: 兑换返回候选集合**
    - 文件：`packages/backend/src/redemptions/code-redemption.property.test.ts`（扩展）
    - 随机码 + 候选商品，断言 `lookupCodeCandidates` 返回候选标识集合恰好等于 `productIds ?? [productId]`
    - **Validates: Requirements 2.1**

  - [x] 9.4 改造 `redeemWithCode` 支持多候选择一
    - 候选集合读取改为 `const candidateIds = codeItem.productIds ?? (codeItem.productId ? [codeItem.productId] : []);`
    - 绑定校验由相等改为 `!candidateIds.includes(input.productId)` → 不匹配返回 `INVALID_PRODUCT_SELECTION`，无副作用
    - 单候选码（`candidateIds.length === 1`）：`input.productId` 必须等于该唯一候选
    - 其余原子事务（码 `currentUses+1` 且置 `exhausted`、仅对 Selected_Product 扣库存 1、写 Redemptions、写 1 单 1 项 Orders、地址校验、库存/下架校验）保持现状
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x]* 9.5 编写择一校验属性测试
    - **Property 5: 择一校验**
    - 文件：`packages/backend/src/redemptions/code-redemption.property.test.ts`（扩展）
    - 候选集合 + 集合外商品，断言 `redeemWithCode` 返回 `INVALID_PRODUCT_SELECTION`，不消耗码、不扣任何库存
    - **Validates: Requirements 2.3**

  - [x]* 9.6 编写成功事务不变量属性测试
    - **Property 6: 兑换成功的原子事务不变量**
    - 文件：`packages/backend/src/redemptions/code-redemption.property.test.ts`（扩展）
    - 多候选码任选其一成功兑换，断言单事务内：码 `currentUses+1` 且 `exhausted`；仅 Selected_Product 库存 -1（其余候选不变）；写 1 条兑换记录；写恰好 1 项的 1 个订单
    - **Validates: Requirements 2.5, 2.6, 2.8, 2.11**

  - [x]* 9.7 编写缺货/下架无副作用拒绝属性测试
    - **Property 7: 缺货/下架的无副作用拒绝**
    - 文件：`packages/backend/src/redemptions/code-redemption.property.test.ts`（扩展）
    - 所选商品下架/缺货，断言返回 `OUT_OF_STOCK`，不消耗码、不扣库存、不写订单或兑换记录
    - **Validates: Requirements 2.10**

- [x] 10. 后端路由接线（`admin/handler.ts` & `redemptions/handler.ts`）
  - [x] 10.1 在 `admin/handler.ts` 添加分发相关路由
    - `GET /api/admin/user-search` → `handleSearchUsers`（解析 keyword/role/pageSize/lastKey，调用 `searchUsers`）
    - `POST /api/admin/codes/distribute` → `handleDistributeCodes`（调用 `distributeCodes`，成功返回 201 + 分发摘要）
    - `POST /api/admin/codes/{codeId}/resend` → `handleResendCodeEmail`（调用 `resendCodeEmail`）
    - 沿用顶层 `isAdmin` 守卫（Admin/SuperAdmin，OrderAdmin 一律 403）
    - _Requirements: 4.4, 9.3, 10.1, 10.2, 10.4_

  - [x] 10.2 在 `redemptions/handler.ts` 添加候选查询路由
    - `POST /api/redemptions/code/lookup` → `handleLookupCodeCandidates`（已登录用户）
    - 确认现有 `POST /api/redemptions/code`（`handleRedeemWithCode`）转发 `productId`（Selected_Product）
    - _Requirements: 2.1, 2.2_

  - [x]* 10.3 编写路由鉴权与转发集成测试
    - `admin/handler.test.ts`：非 Admin/SuperAdmin 调用 user-search/distribute/resend 返回 403（10.2/10.4）；模板编辑仅 SuperAdmin（10.3）
    - `redemptions/handler.test.ts`：lookup 与 redeem 参数正确转发
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 11. Checkpoint - 后端路由与兑换流程完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 前端：生成表单改造与一览增强（`pages/admin/codes.tsx`）
  - [x] 12.1 新增 `multi-candidate-distribute` 生成模式与候选商品多选
    - 从 `code_exclusive` 商品中选 1–10 个；超 10 阻止提交并提示；未选商品阻止提交并提示
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 12.2 实现用户选择器（关键字/角色过滤 + 分页加载 + 保留已选）
    - 调用 `GET /api/admin/user-search`，支持关键字输入、角色下拉过滤、分页/滚动加载（用 `lastKey` 游标）
    - 切换查询条件或加载更多时保留已选用户；无结果显示空提示；未选用户阻止提交并提示
    - _Requirements: 4.5, 4.6, 4.7, 3.6_

  - [x] 12.3 实现每用户码数与实时汇总
    - 用户加入即默认 `allocatedCount=1`，可改为任意正整数；非正整数阻止提交并提示
    - 实时显示已选用户数与 `Total_Code_Count`
    - 提交 `POST /api/admin/codes/distribute` 并展示分发结果摘要（成功/失败/无邮箱跳过）
    - _Requirements: 5.1, 5.2, 5.3, 3.4_

  - [x] 12.4 一览增强：收件人/邮件状态展示 + 重发
    - 对属于分发批次（有 `batchId`/`allocatedUserId`）的码展示收件人（昵称/邮箱）与 `emailStatus`
    - 为具有收件人的码提供"重发"按钮，调用 `POST /api/admin/codes/{codeId}/resend`，结果更新该码状态显示
    - 样式遵循前端设计规范（CSS 变量、`--space-*`、`.btn-*`、`--font-mono` 展示码值；clickable 元素 `cursor-pointer`）
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 13. 前端：兑换入口择一选择流程
  - [x] 13.1 改造兑换入口支持候选查询与择一
    - 用户提交兑换码后调用 `POST /api/redemptions/code/lookup` 获取候选商品
    - 候选 >1 时展示选择列表，择一后连同收货地址提交 `POST /api/redemptions/code`
    - 候选 =1 时自动选中、直接进入地址选择
    - 处理 `INVALID_PRODUCT_SELECTION`/`OUT_OF_STOCK`/`CODE_EXHAUSTED` 等错误提示
    - _Requirements: 2.1, 2.2, 2.4, 2.7_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（测试相关），可为快速 MVP 跳过；非标记任务必须实现。
- 每个任务引用具体需求子条款以保证可追溯。
- 属性测试覆盖设计文档 Property 1–19；库为 `vitest` + `fast-check`，每个属性 ≥100 次迭代，并以注释标注 `Feature: code-user-email-distribution, Property {N}`。
- 属性到测试文件映射严格遵循设计「Testing Strategy」：P1/P11/P12/P15/P16/P17/P19 → `admin/codes-distribution.property.test.ts`；P2 → `admin/codes.property.test.ts`（扩展）；P3 → `redemptions/code-candidate-resolve.property.test.ts`；P4/P5/P6/P7 → `redemptions/code-redemption.property.test.ts`（扩展）；P8/P9/P10 → `admin/user-search.property.test.ts`；P13/P14 → `email/code-distribution-email.property.test.ts`；P18 → `email/templates.property.test.ts`（扩展）。
- 分发生成与发送解耦、不回滚：任何邮件失败或无邮箱都保留已生成码。
- 候选集合统一通过 `productIds ?? (productId ? [productId] : [])` 读取，老单商品码天然兼容。
- 分发邮件不经过 `isEmailEnabled` 订阅门控（管理员事务性邮件）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "5.1", "6.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "5.2", "5.3", "5.4", "6.2", "9.2"] },
    { "id": 3, "tasks": ["3.1", "6.3", "6.4", "7.1", "9.4"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "7.2", "7.3", "9.3", "9.5", "9.6", "9.7"] },
    { "id": 5, "tasks": ["3.9", "3.10", "10.1", "10.2"] },
    { "id": 6, "tasks": ["10.3", "12.1"] },
    { "id": 7, "tasks": ["12.2", "12.3", "12.4", "13.1"] }
  ]
}
```
