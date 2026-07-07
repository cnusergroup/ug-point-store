# Requirements Document

## Introduction

本功能在现有「Code 兑换码」能力基础上扩展两个核心方向：

1. **多商品候选兑换码（择一兑换）**：允许一个兑换码绑定多个 Code 专属商品作为**候选集合**（最多 10 个）。兑换码仍为单次使用（maxUses = 1）。兑换时，用户从绑定的候选商品中**选择恰好 1 个**进行兑换；完成该次兑换后兑换码即耗尽。绑定多个候选商品的语义是"多选一"，而非"一次发放全部商品"。
2. **按用户列表生成并邮件分发**：在「生成兑换码」页面，将原本的"数量"输入改造为"选择用户列表"。管理员可按昵称/邮箱查询、按身份（role）过滤用户，为每个被选用户设置"可收到的兑换码数量"（默认 1），系统据此计算应生成的兑换码总数，确保生成的码数与发送目标一致；生成后自动将兑换码通过邮件发送到对应用户邮箱。邮件模板复用 SuperAdmin 邮件管理功能进行配置，并包含返回商城的链接/CTA 按钮。

本文档以现有系统为基础（`packages/backend/src/admin/codes.ts`、`packages/backend/src/redemptions/code-redemption.ts`、`packages/backend/src/email/*`、`packages/frontend/src/pages/admin/codes.tsx`）。所有此前的待确认事项已由需求方确认并落实到下述需求中。

## Glossary

- **Code（兑换码）**: 系统中 `CodeInfo` 记录，`type` 为 `product`，`maxUses` 为 1，绑定一个或多个 Code 专属商品作为候选集合。
- **Code_Exclusive_Product（Code 专属商品）**: `Product.type === 'code_exclusive'` 的商品，只能通过兑换码兑换。
- **Candidate_Product_Set（候选商品集合）**: 一个兑换码所绑定的、供用户兑换时择一选择的 Code 专属商品有序列表，数量范围为 1–10。
- **Multi_Candidate_Code（多候选兑换码）**: 绑定 2 个或以上 Code 专属商品作为候选集合的兑换码；兑换时用户从中选择恰好 1 个。
- **Selected_Product（已选商品）**: 用户在兑换时从 Candidate_Product_Set 中选择的、实际用于本次兑换的那 1 个商品。
- **Code_Generation_Service（兑换码生成服务）**: 后端负责生成兑换码记录的服务（现 `codes.ts` 中的生成函数）。
- **Code_Distribution_Service（兑换码分发服务）**: 后端负责"按用户分配兑换码并触发邮件发送"的服务（本功能新增）。
- **Code_Redemption_Flow（Code 兑换流程）**: 后端兑换服务（现 `code-redemption.ts` 中的 `redeemWithCode`），用户提交兑换码并完成兑换。
- **Code_Admin_Page（兑换码管理页面）**: 前端管理页 `admin/codes.tsx`，含生成兑换码表单与兑换码一览。
- **User_Query_Service（用户查询服务）**: 后端按昵称/邮箱关键字、身份过滤用户的服务。
- **Email_Distribution_Service（邮件分发服务）**: 后端将兑换码以邮件形式发送到用户邮箱的服务（基于现 `email/send.ts`、`email/notifications.ts`）。
- **Email_Template_Manager（邮件模板管理）**: SuperAdmin 邮件管理功能（现 `email/templates.ts` 与对应前端），用于配置邮件主题与正文模板。
- **User_Role（用户身份）**: `UserGroupLeader`、`Speaker`、`Volunteer`、`Admin`、`SuperAdmin`、`OrderAdmin`。
- **Recipient（收件用户）**: 被管理员选中、将收到一个或多个兑换码的用户。
- **Allocated_Code_Count（分配码数）**: 管理员为单个收件用户设置的"可收到的兑换码数量"，默认 1，必须为正整数。
- **Total_Code_Count（应生成码数）**: 所有收件用户 Allocated_Code_Count 之和。
- **Distribution_Batch（分发批次）**: 一次"选择用户 + 生成 + 发送"操作所对应的一组兑换码及其发送结果，由唯一批次标识 `batchId` 标识。
- **MAX_CANDIDATE_PRODUCTS（候选商品数上限）**: 单个兑换码可绑定的候选商品数量上限，取值为 10。

## Requirements

### Requirement 1: 多商品候选兑换码数据模型

**User Story:** 作为管理员，我希望一个兑换码可以绑定多个 Code 专属商品作为候选集合，以便用户在兑换时从中选择一个想要的商品。

#### Acceptance Criteria

1. THE Code_Generation_Service SHALL 支持在创建兑换码时绑定 1 至 10 个 Code_Exclusive_Product 标识符作为 Candidate_Product_Set。
2. WHEN 管理员创建兑换码并绑定 N 个候选商品（1 ≤ N ≤ 10），THE Code_Generation_Service SHALL 在兑换码记录的 `productIds` 字段中持久化该 N 个商品标识符的有序列表。
3. WHERE 兑换码的 Candidate_Product_Set 恰好包含 1 个商品，THE Code_Generation_Service SHALL 同时将该商品标识符写入 `productId` 字段以保持向后兼容。
4. THE Code_Generation_Service SHALL 将每个生成的兑换码的 maxUses 设置为 1。
5. THE Code_Generation_Service SHALL 将每个生成的兑换码的 type 设置为 `product`。
6. IF 绑定的候选商品列表为空，THEN THE Code_Generation_Service SHALL 拒绝创建并返回错误码 `INVALID_PRODUCT_SELECTION`。
7. IF 绑定的候选商品数量大于 MAX_CANDIDATE_PRODUCTS（10），THEN THE Code_Generation_Service SHALL 拒绝创建并返回错误码 `TOO_MANY_PRODUCTS`。
8. IF 绑定列表中存在不属于 Code_Exclusive_Product 的商品，THEN THE Code_Generation_Service SHALL 拒绝创建并返回错误码 `INVALID_PRODUCT_TYPE`。
9. IF 绑定列表中存在重复的商品标识符，THEN THE Code_Generation_Service SHALL 拒绝创建并返回错误码 `DUPLICATE_PRODUCT`。
10. THE Code_Generation_Service SHALL 保持对现有单商品兑换码（仅含 `productId`、无 `productIds`）的兼容，使既有兑换记录与兑换流程不受影响。

### Requirement 2: 多商品候选择一兑换流程

**User Story:** 作为用户，我希望在使用一个绑定了多个候选商品的兑换码时，从候选商品中选择一个进行兑换，以便兑换到我真正想要的商品。

#### Acceptance Criteria

1. WHEN 用户从现有兑换码兑换入口提交一个有效兑换码，THE Code_Redemption_Flow SHALL 返回该兑换码 Candidate_Product_Set 中全部候选商品供用户选择。
2. THE Code_Redemption_Flow SHALL 在兑换前要求用户从 Candidate_Product_Set 中选择恰好 1 个商品作为 Selected_Product。
3. IF 用户提交的 Selected_Product 不属于该兑换码的 Candidate_Product_Set，THEN THE Code_Redemption_Flow SHALL 拒绝兑换并返回错误码 `INVALID_PRODUCT_SELECTION`。
4. WHEN 用户对一个候选数量为 1 的兑换码发起兑换，THE Code_Redemption_Flow SHALL 直接以该唯一候选商品作为 Selected_Product，无需额外选择步骤。
5. WHEN 兑换成功，THE Code_Redemption_Flow SHALL 仅扣减 Selected_Product 的库存 1，且不修改其余候选商品的库存。
6. WHEN 兑换成功，THE Code_Redemption_Flow SHALL 生成 1 个订单，且该订单恰好包含 1 个订单项（对应 Selected_Product）。
7. THE Code_Redemption_Flow SHALL 在兑换时为 Selected_Product 收集 1 个收货地址。
8. WHEN 兑换成功，THE Code_Redemption_Flow SHALL 将该兑换码的 currentUses 增加 1 并将 status 置为 `exhausted`。
9. IF 兑换码已被使用（currentUses ≥ maxUses）或已在 usedBy 中记录该用户，THEN THE Code_Redemption_Flow SHALL 拒绝兑换并返回错误码 `CODE_EXHAUSTED` 或 `CODE_ALREADY_USED`。
10. IF Selected_Product 已下架或库存不足，THEN THE Code_Redemption_Flow SHALL 拒绝本次兑换并返回错误码 `OUT_OF_STOCK`，且不消耗该兑换码、不扣减任何库存。
11. WHEN 兑换成功，THE Code_Redemption_Flow SHALL 在同一原子事务内完成兑换码状态更新、Selected_Product 库存扣减、兑换记录与订单写入。

### Requirement 3: 生成页面改造为"选择用户列表"

**User Story:** 作为管理员，我希望在生成兑换码时不再填写"数量"，而是选择要发送的用户列表，以便直接把码发给指定的人。

#### Acceptance Criteria

1. WHERE 管理员进入多商品兑换码生成表单，THE Code_Admin_Page SHALL 以"选择用户列表"控件替代原"数量（count）"输入。
2. THE Code_Admin_Page SHALL 支持选择 1 至 10 个 Code_Exclusive_Product 作为兑换码的候选商品集合。
3. IF 管理员选择的候选商品数量超过 10，THEN THE Code_Admin_Page SHALL 阻止提交并提示候选商品最多为 10 个。
4. THE Code_Admin_Page SHALL 展示当前已选用户数量与 Total_Code_Count（应生成码数）的实时汇总。
5. IF 管理员未选择任何商品，THEN THE Code_Admin_Page SHALL 阻止提交并提示需至少选择一个商品。
6. IF 管理员未选择任何用户，THEN THE Code_Admin_Page SHALL 阻止提交并提示需至少选择一个用户。

### Requirement 4: 用户查询与身份过滤

**User Story:** 作为管理员，我希望按昵称/邮箱搜索并按身份过滤用户，以便快速找到目标收件人。

#### Acceptance Criteria

1. WHEN 管理员输入查询关键字，THE User_Query_Service SHALL 返回昵称或邮箱以不区分大小写方式包含（contains）该关键字的用户列表。
2. WHERE 管理员选择一个身份过滤条件，THE User_Query_Service SHALL 仅返回拥有该身份的用户。
3. THE User_Query_Service SHALL 支持的身份过滤值为 `UserGroupLeader`、`Speaker`、`Volunteer`、`Admin`、`SuperAdmin`、`OrderAdmin`。
4. THE User_Query_Service SHALL 在返回的每个用户条目中包含 userId、昵称、邮箱与身份信息。
5. THE User_Query_Service SHALL 复用现有用户列表 GSI（参考 users-gsi-pagination spec）并支持分页查询，每次返回一页结果及用于加载下一页的游标。
6. WHEN 查询无匹配结果，THE User_Query_Service SHALL 返回空列表并由 Code_Admin_Page 显示无结果提示。
7. THE Code_Admin_Page SHALL 支持用户选择器的分页/滚动加载，并在加载更多或切换查询条件时保留管理员已选中的用户，使既有选择不被清除。

### Requirement 5: 每用户分配码数与总数一致性

**User Story:** 作为管理员，我希望为每个选中用户单独设置可收到的兑换码数量（默认 1），并确保实际生成的码数与发送目标完全一致。

#### Acceptance Criteria

1. WHEN 管理员将某用户加入收件列表，THE Code_Admin_Page SHALL 为该用户初始化 Allocated_Code_Count 为 1。
2. THE Code_Admin_Page SHALL 允许管理员将任一收件用户的 Allocated_Code_Count 修改为任意正整数。
3. IF 任一收件用户的 Allocated_Code_Count 小于 1 或非整数，THEN THE Code_Admin_Page SHALL 阻止提交并提示该值必须为正整数。
4. THE Code_Distribution_Service SHALL 将 Total_Code_Count 计算为所有收件用户 Allocated_Code_Count 之和。
5. WHEN 分发批次生成完成，THE Code_Distribution_Service SHALL 使生成的兑换码总数等于 Total_Code_Count。
6. THE Code_Distribution_Service SHALL 为每个收件用户独占分配恰好等于其 Allocated_Code_Count 数量的兑换码，且任一兑换码只分配给一个用户。
7. THE Code_Distribution_Service SHALL 使所有收件用户被分配的兑换码数量之和等于生成的兑换码总数（不存在未分配或重复分配的兑换码）。
8. WHEN 生成分发批次的兑换码，THE Code_Distribution_Service SHALL 在每个兑换码记录中持久化其被分配到的用户标识（`allocatedUserId`）与所属分发批次标识（`batchId`），以支持审计与重发。

### Requirement 6: 生成后邮件分发

**User Story:** 作为管理员，我希望兑换码生成后自动发送到对应用户的邮箱，以便用户直接收到属于自己的兑换码。

#### Acceptance Criteria

1. WHEN 分发批次的兑换码生成成功，THE Email_Distribution_Service SHALL 向每个拥有有效邮箱的收件用户发送一封包含其被分配兑换码的邮件。
2. THE Email_Distribution_Service SHALL 在邮件中包含该用户被分配的全部兑换码值。
3. WHERE 某收件用户的 Allocated_Code_Count 大于 1，THE Email_Distribution_Service SHALL 在该用户的邮件中列出其全部被分配的兑换码值。
4. THE Email_Distribution_Service SHALL 仅将每个用户被分配的兑换码发送给该用户本人，不发送给其他收件人。
5. WHEN 全部邮件发送流程结束，THE Code_Distribution_Service SHALL 返回包含成功数、失败数及失败用户标识的分发结果摘要。

### Requirement 7: 邮件模板管理

**User Story:** 作为超级管理员，我希望在邮件管理功能中配置兑换码分发邮件的主题与正文模板，以便统一管理邮件内容。

#### Acceptance Criteria

1. THE Email_Template_Manager SHALL 提供兑换码分发邮件对应的可编辑模板（主题与 HTML 正文）。
2. THE Email_Distribution_Service SHALL 使用 Email_Template_Manager 中配置的模板渲染发送内容。
3. WHEN 模板中存在 `{{变量名}}` 占位符，THE Email_Distribution_Service SHALL 用对应收件用户的实际值替换占位符。
4. THE 兑换码分发邮件模板 SHALL 定义并支持以下模板变量：`nickname`（收件用户昵称）、`codeList`（该用户被分配的全部兑换码）、`productNames`（兑换码绑定的候选商品名称列表）、`codeCount`（该用户被分配的兑换码数量）、`storeUrl`（返回商城的链接地址）。
5. THE 兑换码分发邮件模板 SHALL 包含一个使用 `storeUrl` 的商城链接/CTA 按钮，其样式与现有邮件模板（参见 `email/seed.ts` 中的 `STORE_LINK`）保持一致。
6. IF 兑换码分发邮件模板不存在或未配置，THEN THE Email_Distribution_Service SHALL 使用系统默认模板发送，确保邮件仍可送达，且默认模板同样包含 `storeUrl` 商城链接。
7. WHERE 管理员保存模板，THE Email_Template_Manager SHALL 校验主题长度为 1–200 字符、正文长度为 1–10000 字符，否则拒绝保存。

### Requirement 8: 失败与部分失败处理

**User Story:** 作为管理员，我希望系统在用户无邮箱、商品异常、邮件发送失败等情况下给出明确反馈并保留已生成的码，以便我能跟进处理与重发。

#### Acceptance Criteria

1. IF 某收件用户没有有效邮箱地址，THEN THE Code_Distribution_Service SHALL 跳过对该用户的邮件发送并在分发结果中标记该用户为失败及原因，但保留已为其生成的兑换码记录。
2. IF 绑定的候选商品中存在不存在或已下架的商品，THEN THE Code_Generation_Service SHALL 在生成前拒绝整个分发批次并返回错误码 `INVALID_PRODUCT_SELECTION`。
3. IF 某用户的邮件发送失败，THEN THE Email_Distribution_Service SHALL 继续处理其余用户，并在分发结果中记录失败用户标识与错误信息。
4. WHEN Total_Code_Count 超过单批次写入上限，THE Code_Generation_Service SHALL 将兑换码记录分批写入（每批不超过 DynamoDB 批量写入上限）。
5. WHILE 分发批次处理过程中发生部分失败，THE Code_Distribution_Service SHALL 保留已成功生成的兑换码记录，不因部分邮件失败或用户无邮箱而删除已生成的码（不回滚）。
6. THE Code_Distribution_Service SHALL 在分发结果摘要中区分"生成成功且发送成功"、"生成成功但发送失败"、"生成成功但用户无邮箱被跳过"三类状态。

### Requirement 9: 兑换码一览的发送对象展示与邮件重发

**User Story:** 作为管理员，我希望在兑换码一览中看到每个码发送给了谁及发送状态，并能对单个码/收件人重发邮件，以便处理发送失败或用户未收到的情况。

#### Acceptance Criteria

1. THE Code_Admin_Page SHALL 在兑换码一览中为每个属于分发批次的兑换码展示其收件人信息（昵称/邮箱）与该码的邮件发送状态。
2. THE Code_Admin_Page SHALL 为每个具有收件人的兑换码提供一个邮件"重发"按钮。
3. WHEN 管理员对某个兑换码点击"重发"，THE Email_Distribution_Service SHALL 依据该码持久化的 `allocatedUserId` 向对应收件用户重新发送包含该码的分发邮件。
4. IF 重发目标用户没有有效邮箱地址，THEN THE Email_Distribution_Service SHALL 拒绝重发并返回错误码 `NO_EMAIL`。
5. WHEN 重发完成，THE Email_Distribution_Service SHALL 返回重发结果（成功或失败及原因）并由 Code_Admin_Page 更新该码的发送状态显示。
6. THE Email_Distribution_Service SHALL 仅将重发的兑换码邮件发送给该码持久化记录的收件用户本人。

### Requirement 10: 权限控制

**User Story:** 作为系统，我希望仅授权管理员能生成、分发与重发兑换码，以避免越权操作。

#### Acceptance Criteria

1. IF 请求者不具备 Admin 或 SuperAdmin 身份，THEN THE Code_Distribution_Service SHALL 拒绝生成、分发与重发请求并返回错误码 `FORBIDDEN`。
2. THE Code_Distribution_Service SHALL 对生成、分发与重发操作沿用现有兑换码管理（`/api/admin/codes`）一致的鉴权策略。
3. WHERE 邮件模板编辑操作，THE Email_Template_Manager SHALL 仅允许 SuperAdmin 身份执行。
4. THE User_Query_Service SHALL 仅对 Admin 或 SuperAdmin 身份开放用户查询接口。
