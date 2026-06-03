# Implementation Plan: 证书自助申请（Credential Self-Application）

## Overview

本实现计划在现有「社区凭证系统」（community-credentials）基础上扩展，新增用户自助申请证书路径，保持现有批量导入证书、公开页面、撤销逻辑零改动。采用自底向上、逐步集成的顺序：类型扩展与凭证 ID 适配 → 活动-证书模版关联（校验 + CRUD）→ 资格判定（纯函数 + I/O 编排）→ 自助申请生成（含并发去重与序号分配）→ 公开页面渲染适配 → 我的证书查询与 Handler 路由集成 → CDK 基础设施 → 前端（证书申请标签、我的证书、后台关联管理）。

全部后端代码位于 `packages/backend/src/credentials/`，复用现有 `types.ts`、`credential-id.ts`、`sequence.ts`、`render.ts`、`revoke.ts` 与现有 Credential Lambda（`handler.ts`）；不新建 Lambda 函数，不触碰积分商城核心数据。13 条 Correctness Properties 全部以 fast-check 属性测试覆盖（`numRuns: 100`），标签格式为 `// Feature: credential-self-application, Property {N}: {标题}`，并辅以单元/集成测试。

## Tasks

- [x] 1. 类型扩展与凭证 ID 适配
  - [x] 1.1 在 `packages/backend/src/credentials/types.ts` 扩展类型定义
    - 新增 `SourceRole`（`'Speaker' | 'UserGroupLeader' | 'Volunteer'`）与 `SOURCE_ROLE_CODES` 固定映射（`Speaker→SPK`、`Volunteer→VOL`、`UserGroupLeader→UGL`）
    - 新增 `Season`（`'Spring' | 'Summer' | 'Fall' | 'Winter'`）、`AllowedRoleConfig`（`role`/`roleCode`/`identityText`）、`ActivityTemplateAssociation`（`associationId`/`activityId`/`eventName`/`eventPrefix`/`year`/`season`/`allowedRoles`/`locale='en'`/`issuingOrganization`/`createdAt`/`createdBy` 及可选 `eventDate`/`eventLocation`/`updatedAt`/`updatedBy`）
    - 扩展 `Credential` 接口以支持自助证书的非空标识字段：`appliedByUserId?`、`sourceActivityId?`、`sourceRole?`、`identityText?`、`appliedDedupeKey?`，并使 `role` 可承载 `SourceRole` 值
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 10.2_

  - [x] 1.2 扩展 `packages/backend/src/credentials/credential-id.ts` 以接受 `UGL` 角色代码
    - 将 `CREDENTIAL_ID_REGEX` 的角色代码分组由 `VOL|SPK|WKS|ORG` 扩展为 `VOL|SPK|WKS|ORG|UGL`
    - 同步更新 `validateCredentialId` 中角色代码校验的错误提示文案
    - 确认 `formatCredentialId` 无需改动（已通用，序号四位零填充）
    - _Requirements: 6.2, 6.4_

  - [x]* 1.3 编写属性测试：凭证 ID 往返一致性（含 UGL）
    - **Property 6: 凭证 ID 往返一致性**
    - 在现有 `packages/backend/src/credentials/credential-id.property.test.ts` 中新增用例，覆盖 `roleCode ∈ {SPK, VOL, UGL, WKS, ORG}`：`parseCredentialId(formatCredentialId(c))` 与原始组件完全一致、序号四位零填充；非法字符串返回描述性错误
    - 标签：`// Feature: credential-self-application, Property 6: 凭证 ID 往返一致性`
    - **Validates: Requirements 6.2**

- [x] 2. 活动-证书模版关联：校验与 CRUD
  - [x] 2.1 创建 `packages/backend/src/credentials/association.ts` 校验与角色派生纯函数
    - 实现 `deriveRoleCode(role: SourceRole): string`（依据 `SOURCE_ROLE_CODES`）
    - 实现 `validateAssociationInput(input): AssociationValidationResult`（纯函数，不访问 DynamoDB）：校验 `eventName`（1–200）、`eventPrefix`（`/^[A-Z-]{1,20}$/`）、`year`（四位且 2000–2100）、`season ∈ {Spring,Summer,Fall,Winter}`、`allowedRoles`（1–3 项、`role` 取值合法且互不重复、`identityText` 1–100）、可选 `eventLocation`/`issuingOrganization`（提供时 1–200）；规范化时回填各项 `roleCode` 与 `issuingOrganization` 默认值 `AWS User Group China`；非法/重复/缺失必填返回指明问题字段的描述性错误
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.3, 2.4, 2.5, 2.7_

  - [x]* 2.2 编写属性测试：角色代码派生固定且全覆盖
    - **Property 1: 角色代码派生固定且全覆盖**
    - 测试文件：`packages/backend/src/credentials/source-role.property.test.ts`
    - 对 `Speaker/Volunteer/UserGroupLeader` 恒返回 `SPK/VOL/UGL`；对集合外任意字符串返回错误或不产生有效代码
    - 标签：`// Feature: credential-self-application, Property 1: 角色代码派生固定且全覆盖`
    - **Validates: Requirements 1.4, 2.4, 6.4**

  - [x]* 2.3 编写属性测试：关联输入校验正确性
    - **Property 2: 关联输入校验正确性**
    - 测试文件：`packages/backend/src/credentials/association.property.test.ts`
    - 当且仅当全部字段约束满足时判定合法；非法/重复/缺失必填返回描述性错误且不产生规范化结果；`issuingOrganization` 未提供时规范化为默认值
    - 标签：`// Feature: credential-self-application, Property 2: 关联输入校验正确性`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.7, 2.3, 2.5, 2.7**

  - [x] 2.4 在 `packages/backend/src/credentials/association.ts` 实现关联 CRUD 与授权
    - 实现 `createAssociation`（校验 → 经 `activityId-index` 查重 → 条件写入兜底，已存在返回 `DUPLICATE_ASSOCIATION`「该活动已存在证书模版关联」）、`updateAssociation`（保留 `createdAt`/`createdBy`，写 `updatedAt`/`updatedBy`）、`deleteAssociation`、`listAssociations`、`getAssociationByActivityId`
    - 实现 `assertSuperAdmin(roles)` 授权辅助：仅当角色集合含 `SuperAdmin` 时通过，否则返回 403 且不创建/修改/删除任何关联
    - 创建/编辑时校验 `activityId` 存在（只读 `PointsMall-Activities`），不写入任何积分商城核心数据
    - _Requirements: 1.6, 2.1, 2.2, 2.6, 2.8, 9.4, 9.7, 11.2, 11.3_

  - [x]* 2.5 编写属性测试：关联管理操作仅限 SuperAdmin
    - **Property 10: 关联管理操作仅限 SuperAdmin**
    - 测试文件：`packages/backend/src/credentials/association.property.test.ts`
    - 创建/编辑/删除被允许当且仅当角色集合含 `SuperAdmin`；不含时返回 403 且不变更任何关联
    - 标签：`// Feature: credential-self-application, Property 10: 关联管理操作仅限 SuperAdmin`
    - **Validates: Requirements 2.8, 2.9, 9.7, 9.8**

  - [x]* 2.6 编写关联唯一性单元/集成测试
    - 测试文件：`packages/backend/src/credentials/association.test.ts`
    - mock DynamoDB 验证同一 `activityId` 二次创建被拒、原关联不变；缺失必填字段返回指明缺失字段的错误
    - _Requirements: 1.6, 2.6_

- [x] 3. 证书申请资格判定
  - [x] 3.1 创建 `packages/backend/src/credentials/eligibility.ts` 资格判定纯函数
    - 定义 `EligibleItem` 接口（`activityId`/`sourceRole`/`eventName`/`identityText`/`applied`/`credentialId?`/`status?`）
    - 实现 `computeEligibleApplications(args)`：仅取 `targetRole ∈ {Speaker, UserGroupLeader, Volunteer}` 且 `activityId` 非空的积分记录，显式排除 `SpecialActivity`；按 `(activityId, sourceRole)` 去重；命中关联且 `sourceRole ∈ allowedRoles` 才保留；据已申请证书集合标记 `applied`（`active`/`revoked` 均视为已申请）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 3.2 编写属性测试：资格判定正确性
    - **Property 3: 资格判定正确性**
    - 测试文件：`packages/backend/src/credentials/eligibility.property.test.ts`
    - 当且仅当满足全部条件时判定为恰好一个可申请项；`SpecialActivity` 与无 `activityId` 记录绝不产生可申请项；同一三元组多条记录只产生一项；已存在证书的三元组标记为已申请
    - 标签：`// Feature: credential-self-application, Property 3: 资格判定正确性`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 3.3 在 `packages/backend/src/credentials/eligibility.ts` 实现 `getMyApplications` I/O 编排
    - 经 `userId-createdAt-index` 查询用户身份积分记录、按出现的 `activityId` 查询关联、经 `appliedByUserId-index` 查询本人已申请证书，归约后调用纯函数返回合并列表
    - 读数据失败时抛错（由 handler 返回描述性错误而非空列表）；仅使用入参 `userId`，忽略任何客户端标识
    - _Requirements: 3.7, 4.2, 9.1, 9.5_

  - [x]* 3.4 编写资格判定 I/O 失败单元测试
    - 测试文件：`packages/backend/src/credentials/eligibility.test.ts`
    - mock DynamoDB 抛错，断言 `getMyApplications` 返回错误而非空列表或部分结果
    - _Requirements: 3.7_

- [x] 4. Checkpoint - 确保前述测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. 自助申请生成与序号/并发安全
  - [x] 5.1 创建 `packages/backend/src/credentials/self-apply.ts` 姓名校验纯函数
    - 定义 `ApplyInput`、`ApplyResult` 类型
    - 实现 `validateRecipientName(name)`：去首尾空白后长度 1–100 判定合法，否则返回描述性错误
    - _Requirements: 5.1, 5.2, 5.4_

  - [x]* 5.2 编写属性测试：收件人姓名校验
    - **Property 4: 收件人姓名校验**
    - 测试文件：`packages/backend/src/credentials/self-apply.property.test.ts`
    - 当且仅当去空白后长度 1–100 判定合法；空串/纯空白/超 100 判定非法并返回描述性错误
    - 标签：`// Feature: credential-self-application, Property 4: 收件人姓名校验`
    - **Validates: Requirements 5.2, 5.4**

  - [x] 5.3 在 `packages/backend/src/credentials/self-apply.ts` 实现 `applyForCredential` 主流程
    - 校验姓名 → 资格复核（查关联 + 查身份积分 + 查是否已申请，不合格返回 403 `NOT_ELIGIBLE`，已申请返回 `ALREADY_APPLIED`）→ 选取 `allowedRoles` 中 `role===sourceRole` 的 `identityText`/`roleCode`（缺失则中止并报错 `INTERNAL_ERROR`）
    - 以 `appliedDedupeKey = {userId}#{activityId}#{sourceRole}` 作为 `sequenceKey` 对 `PointsMall-CredentialSequences` 条件写入（`attribute_not_exists`）抢申请锁，失败映射为 `ALREADY_APPLIED`
    - 抢锁成功后调用现有 `getNextSequence` 取序号 → `formatCredentialId` 生成凭证 ID → 组装 `Credential`（`status='active'`、`locale='en'`、`issueDate=今日 YYYY-MM-DD`、`identityText`、`appliedByUserId`/`sourceActivityId`/`sourceRole`/`appliedDedupeKey`、`issuingOrganization` 来自关联）写入 `PointsMall-Credentials`，返回 `{ credentialId, url }`
    - 全程不写任何积分相关表
    - _Requirements: 5.3, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.5, 7.1, 7.3, 7.5, 7.6, 9.2, 9.5, 10.2, 11.1_

  - [x]* 5.4 编写属性测试：自助证书生成不变式
    - **Property 5: 自助证书生成不变式**
    - 测试文件：`packages/backend/src/credentials/self-apply.property.test.ts`
    - 合格三元组生成的证书满足 `status='active'`/`locale='en'`/`issueDate` 为生成当日、`identityText` 与关联一致、三个来源字段非空且与输入一致、`url === baseUrl + '/c/' + credentialId`；不合格返回 403 且不写入；缺失匹配身份配置时中止并返回描述性错误
    - 标签：`// Feature: credential-self-application, Property 5: 自助证书生成不变式`
    - **Validates: Requirements 5.3, 5.7, 6.1, 6.5, 7.5, 7.6, 10.2**

  - [x]* 5.5 编写属性测试：同一三元组至多一张证书（并发互斥）
    - **Property 8: 同一三元组至多一张证书（并发互斥）**
    - 测试文件：`packages/backend/src/credentials/self-apply.property.test.ts`
    - 用内存版条件写入模拟 `attribute_not_exists` 语义，断言对同一三元组并发 N 次申请恰一次成功、其余返回「该证书已申请」；对已存在证书的三元组再次申请被拒且不改变已有证书
    - 标签：`// Feature: credential-self-application, Property 8: 同一三元组至多一张证书（并发互斥）`
    - **Validates: Requirements 5.5, 5.6**

  - [x]* 5.6 编写属性测试：积分数据零副作用
    - **Property 12: 积分数据零副作用**
    - 测试文件：`packages/backend/src/credentials/self-apply.property.test.ts`
    - 对资格判定、申请、生成、查询及关联增删改操作，断言不调用任何积分商城核心数据表（商品、订单、积分记录、用户余额）的写入操作，执行前后积分记录不变
    - 标签：`// Feature: credential-self-application, Property 12: 积分数据零副作用`
    - **Validates: Requirements 5.8, 11.1, 11.3**

  - [x]* 5.7 编写属性测试：序号分配唯一且单调递增
    - **Property 7: 序号分配唯一且单调递增**
    - 测试文件：`packages/backend/src/credentials/sequence.property.test.ts`
    - 以内存版原子计数器模拟 `getNextSequence` 的 `ADD` 语义，断言同一 `{eventPrefix}-{year}-{season}-{roleCode}` 下 N 次分配序号互不重复、构成自当前最大值加 1 起的连续递增区间（model-based）
    - 标签：`// Feature: credential-self-application, Property 7: 序号分配唯一且单调递增`
    - **Validates: Requirements 6.3**

- [x] 6. 公开页面渲染适配
  - [x] 6.1 适配 `packages/backend/src/credentials/render.ts` 以展示 `identityText`
    - 当 `credential.identityText` 存在时优先用其作为展示身份，否则回退现有 `s.roles[role]` 逻辑；LinkedIn / OG / QR / 撤销标记等保持不变；自助证书 `locale='en'` 走英文文案分支
    - _Requirements: 7.2, 7.3, 7.4, 7.7, 11.6_

  - [x]* 6.2 编写属性测试：自助证书公开页面渲染完整性
    - **Property 9: 自助证书公开页面渲染完整性**
    - 在现有 `packages/backend/src/credentials/render.property.test.ts` 中新增用例：自助证书渲染 HTML 同时包含收件人姓名、`identityText`、活动名称、签发日期、凭证 ID、签发组织、含完整 URL 的 QR 码、五个 OG meta 标签且固定文案为英文；`revoked` 时含撤销标记且无「Add to LinkedIn」按钮
    - 标签：`// Feature: credential-self-application, Property 9: 自助证书公开页面渲染完整性`
    - **Validates: Requirements 7.2, 7.4, 7.7**

- [x] 7. 我的证书查询与 Handler 路由集成
  - [x] 7.1 创建 `packages/backend/src/credentials/my-credentials.ts` 实现 `getMyCredentials`
    - 经 `appliedByUserId-index` 查询本人全部自助证书（含 `active` 与 `revoked`），按 `issueDate` 降序排序，组装含 `url` 的列表；仅用入参 `userId`
    - _Requirements: 8.2, 9.3, 9.5, 10.3_

  - [x]* 7.2 编写属性测试：我的证书查询完整性与排序
    - **Property 13: 我的证书查询完整性与排序**
    - 测试文件：`packages/backend/src/credentials/my-credentials.property.test.ts`
    - 返回列表恰好等于该用户全部自助证书（含两态）、按 `issueDate` 降序；每条来源类型按 `appliedByUserId` 是否存在被正确判定为自助申请
    - 标签：`// Feature: credential-self-application, Property 13: 我的证书查询完整性与排序`
    - **Validates: Requirements 8.2, 10.3**

  - [x] 7.3 扩展 `packages/backend/src/credentials/handler.ts` 新增路由分发
    - 用户侧（`withAuth` 鉴权，仅用 `event.user.userId`，忽略客户端传入标识）：`GET /api/credentials/my-applications`→`getMyApplications`、`POST /api/credentials/apply`→`applyForCredential`、`GET /api/credentials/my-credentials`→`getMyCredentials`
    - 管理侧（`withAuth` 后额外校验 `SuperAdmin`，否则 403）：`GET/POST /api/admin/credential-associations`、`GET/PUT/DELETE /api/admin/credential-associations/{id}`
    - 保持现有 `/c/*` 与 `/api/admin/credentials/*` 路由不变；新增路由前缀不与现有路由重叠；各分支以 try/catch 包裹返回结构化错误
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.6, 10.7, 11.5_

  - [x]* 7.4 编写属性测试：用户侧数据隔离
    - **Property 11: 用户侧数据隔离**
    - 测试文件：`packages/backend/src/credentials/self-apply.property.test.ts`
    - 对请求体/查询参数中任意伪造的用户标识符，用户侧接口返回的数据仅属于认证身份确定的 `userId`，客户端提交的标识符被忽略
    - 标签：`// Feature: credential-self-application, Property 11: 用户侧数据隔离`
    - **Validates: Requirements 9.5**

  - [x]* 7.5 编写 Handler 路由与鉴权单元测试
    - 测试文件：`packages/backend/src/credentials/handler.test.ts`（扩展现有）
    - 验证新增用户/管理路由分发、未认证返回认证错误、非 SuperAdmin 访问管理接口返回 403 且不暴露内部结构
    - _Requirements: 2.9, 9.7, 9.8, 9.9_

  - [x]* 7.6 编写自助证书撤销复用测试
    - 测试文件：`packages/backend/src/credentials/revoke.test.ts`（扩展现有）
    - 补充一条针对自助证书（`appliedByUserId` 存在）的用例，确认撤销行为与批量证书一致：仅 SuperAdmin 可撤销、`active→revoked` 记录 `revokedAt/revokedBy/revokeReason`、撤销不存在或已撤销证书被拒
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

- [x] 8. Checkpoint - 确保后端测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. CDK 基础设施
  - [x] 9.1 更新 `packages/cdk/lib/database-stack.ts`
    - 新增 `PointsMall-ActivityTemplateAssociations` 表（PK=`associationId`）及 GSI `activityId-index`（PK=`activityId`）
    - 为现有 `PointsMall-Credentials` 表新增 GSI `appliedByUserId-index`（PK=`appliedByUserId`，SK=`issueDate`）与 `appliedDedupeKey-index`（PK=`appliedDedupeKey`）
    - _Requirements: 1.1, 7.1, 8.2, 10.1, 11.2_

  - [x] 9.2 更新 `packages/cdk/lib/api-stack.ts`
    - 为 `credentialFn` 新增 `ASSOCIATIONS_TABLE`、`POINTS_RECORDS_TABLE`、`ACTIVITIES_TABLE` 环境变量及权限：关联表读写、积分记录表/活动表只读、Credentials 表新 GSI 读写
    - 在 `api` 根资源下注册 `credentials` 用户路由、在 `admin` 资源 `addProxy` 之前注册 `credential-associations` 显式路由，均指向 `credentialInt`，确保不覆盖现有路由
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 11.5_

- [x] 10. 前端：证书申请标签、我的证书、后台关联管理
  - [x] 10.1 在 `packages/frontend/src/pages/index/index.tsx` 新增「证书申请」标签与可申请项视图
    - 在筛选标签栏「差旅申请」右侧新增 `credential` 标签；选中时调用 `GET /api/credentials/my-applications` 渲染可申请项与已申请项列表（展示活动名称与 `identityText`）
    - 已申请项标记「已申请」并提供查看 `/c/{credentialId}` 公开页面入口；未申请项展示「申请」入口
    - 加载/空态（「暂无可申请的证书」）/错误态处理；在 `index.scss` 补充对应样式（cursor-pointer、hover 反馈、状态徽章）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 10.2 在 `packages/frontend/src/pages/index/index.tsx` 实现申请提交流程
    - 申请时弹出可编辑收件人姓名输入框；前端在去空白后长度为 0 时阻止提交、不发请求并提示「姓名不能为空」
    - 合法时调用 `POST /api/credentials/apply`，成功后展示生成结果与公开页面入口，刷新列表并将该项标记为「已申请」
    - _Requirements: 5.1, 5.2, 5.9_

  - [x] 10.3 在 `packages/frontend/src/pages/profile/index.tsx` 新增「获得证书管理」区域
    - 提供入口调用 `GET /api/credentials/my-credentials`，按 `issueDate` 降序展示活动名称、`identityText`、凭证 ID、签发日期、状态
    - 点击证书打开 `/c/{credentialId}`；「复制链接」复制完整 URL 并提示成功/失败（失败时展示完整 URL 供手动复制）
    - 加载中/空态/错误态（带重试入口）分别处理；在 `profile/index.scss` 补充样式
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 10.4 在 `packages/frontend/src/pages/admin/credentials.tsx` 新增「活动-证书模版关联」管理
    - 新增关联列表与创建/查看/编辑/删除入口，表单支持填写关联活动、活动名称、活动日期、活动地点、签发组织、`eventPrefix`/`year`/`season`、允许身份集合及各身份 `identityText`，对接 `/api/admin/credential-associations[/{id}]`
    - 在 `credentials.scss` 补充关联管理表单与列表样式
    - _Requirements: 2.1, 2.2_

  - [x] 10.5 在 `packages/frontend/src/pages/admin/credentials.tsx` 增加来源类型标签
    - 依据 `appliedByUserId` 是否存在为凭证列表每条记录展示来源类型标签（自助申请 / 批量导入）；确认现有按凭证 ID/姓名/活动名不区分大小写搜索与状态筛选对自助证书同样生效
    - _Requirements: 10.1, 10.3_

  - [x] 10.6 为新增前端文案补充 i18n
    - 向 `packages/frontend/src/i18n/` 的 `zh.ts`、`en.ts`、`zh-TW.ts`、`ja.ts`、`ko.ts` 添加证书申请标签、申请按钮/弹窗、已申请、空态、错误态、我的证书、复制成功/失败、来源类型标签等键
    - _Requirements: 4.3, 4.7, 5.2, 8.4, 8.6_

  - [x]* 10.7 编写前端组件/示例测试
    - 覆盖：证书申请标签位置（差旅右侧）、可申请/已申请态切换、空态/错误态/加载态、复制链接成功与失败路径、姓名为空的前端拦截、后台来源类型标签展示
    - 测试文件置于对应页面目录（如 `packages/frontend/src/pages/index/`、`profile/`、`admin/`）
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 5.2, 8.6, 8.7, 8.8, 10.3_

- [x] 11. Final checkpoint - 确保全部测试通过且构建成功
  - 运行 `npm run build` 验证无 TypeScript 错误
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试、单元/集成/组件测试），可为更快 MVP 跳过；核心实现任务不可跳过。
- 每个任务引用具体需求条款以保证可追溯性，检查点（Checkpoint）保证增量验证。
- 13 条 Correctness Properties 各以**单个** fast-check 属性测试实现，`numRuns: 100`，标签格式 `// Feature: credential-self-application, Property {N}: {标题}`。
- 撤销相关验收标准（10.4–10.7）由自助证书与批量证书结构一致而复用 community-credentials 既有撤销逻辑/属性，仅补充任务 7.6 的自助证书示例确认行为一致。
- 全部后端代码位于 `packages/backend/src/credentials/`，复用现有 `credential-id.ts`、`sequence.ts`、`render.ts`、`revoke.ts` 与现有 Credential Lambda（不新建函数）。
- 并发「至多一张」由任务 5.3 的去重键条件写入保证；凭证 ID 唯一性由原子序号保证；关联与申请均不触碰积分商城核心数据，满足数据隔离与向后兼容（需求 11.x）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "9.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "3.1", "5.1", "6.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "5.2", "6.2", "7.2"] },
    { "id": 3, "tasks": ["2.5", "2.6", "3.4", "5.3"] },
    { "id": 4, "tasks": ["5.4", "5.7", "7.3"] },
    { "id": 5, "tasks": ["5.5", "7.5", "7.6", "9.2"] },
    { "id": 6, "tasks": ["5.6", "10.1", "10.3", "10.4", "10.6"] },
    { "id": 7, "tasks": ["7.4", "10.2", "10.5"] },
    { "id": 8, "tasks": ["10.7"] }
  ]
}
```
