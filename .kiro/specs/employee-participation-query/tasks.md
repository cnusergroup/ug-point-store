# Implementation Plan: 员工活动参与度查询 (Employee Participation Query)

## Overview

按照设计文档的"独立 Lambda + 独立 DynamoDB 表"架构自底向上实现：先构建与外部依赖无关的纯函数模块（凭证哈希/校验、登录锁定、会话签发校验、聚合/过滤/分页），再实现依赖 DynamoDB 的查询编排与导出模块，然后是两个 Lambda 入口（新 Query Lambda + 现有 Admin Lambda 新增路由），最后是 CDK 基础设施与前端页面（独立登录页、查询主页面、管理后台设置页新增区块）。每个纯函数模块伴随其属性测试一起完成，尽早捕获逻辑错误。

## Tasks

- [x] 1. 凭证模块：哈希格式、密码强度、密码剥离
  - [x] 1.1 创建 `packages/backend/src/participation/credential.ts` 中的纯函数部分
    - 定义 `QueryCredentialRecord` 接口（`username`, `passwordHash`, `version`, `createdAt`, `updatedAt`, `updatedBy?`）
    - 实现 `isValidBcryptHash(hash: string): boolean`（校验 `$2[aby]$轮数$53字符` 格式）
    - 实现 `validateQueryPasswordStrength(password: string)`（长度 ≥8 且含至少一个字母和一个数字）
    - 实现 `isAuthorizedToUpdateCredential(roles: string[]): boolean`（仅 `SuperAdmin`）
    - 实现 `stripSecrets<T>(record: T)`（剔除 `passwordHash`/`password` 字段）
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 1.2 编写属性测试：哈希格式校验正确性
    - **Property 3: 哈希格式校验正确性**
    - 创建 `packages/backend/src/participation/credential.property.test.ts`
    - 使用 `fast-check`，最少 100 次迭代；生成有效 bcrypt 哈希（`bcryptjs.hashSync`）与任意不匹配字符串，验证 `isValidBcryptHash` 恒定接受/拒绝
    - **Validates: Requirements 1.6**

  - [ ]* 1.3 编写属性测试：密码强度校验正确性
    - **Property 4: 密码强度校验正确性**
    - 文件：`packages/backend/src/participation/credential.property.test.ts`
    - 生成任意字符串，验证 `validateQueryPasswordStrength` 的结果与"长度≥8 且含字母且含数字"的独立判定完全一致
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 1.4 编写属性测试：API 响应密码字段剥离
    - **Property 2: API 响应密码字段剥离**
    - 文件：`packages/backend/src/participation/credential.property.test.ts`
    - 生成含任意 `passwordHash`/`password` 字段及其他任意字段的对象，验证 `stripSecrets` 输出中不含这两个 key，且其他字段不变
    - **Validates: Requirements 1.5**

  - [ ]* 1.5 编写单元测试：授权判定与常量边界
    - 文件：`packages/backend/src/participation/credential.test.ts`
    - 测试 `isAuthorizedToUpdateCredential(['SuperAdmin'])` → true，`isAuthorizedToUpdateCredential(['Admin'])` → false
    - _Requirements: 2.5, 2.6_

- [x] 2. 凭证模块：DynamoDB 读写（bootstrap、校验登录、修改密码）
  - [x] 2.1 实现 `getOrBootstrapCredential`、`verifyCredential`、`updateCredentialPassword`
    - `getOrBootstrapCredential`：表为空时使用注入的默认用户名/密码哈希创建默认记录（使用条件写 `ConditionExpression: attribute_not_exists(username)` 防止并发重复创建，捕获 `ConditionalCheckFailedException` 并重新读取）；已存在记录但 `passwordHash` 格式不合法时抛出错误（不修改数据）
    - `verifyCredential`：读取当前记录后 `bcrypt.compare`，返回 `{ valid, version }`
    - `updateCredentialPassword`：校验角色 + 密码强度，全部通过才原子更新 `passwordHash` 与 `version = version + 1`；任一失败则不写入
    - _Requirements: 1.1, 1.3, 1.6, 2.7_

  - [ ]* 2.2 编写属性测试：密码哈希存储正确性
    - **Property 1: 密码哈希存储正确性**
    - 创建 `packages/backend/src/participation/credential.property.test.ts`（若已存在则追加）
    - 生成任意密码字符串，mock DynamoDB client，创建/更新凭证后验证：写入的 `passwordHash` 从不等于明文密码；`bcrypt.compare(原密码, 写入哈希)` 为 true；`bcrypt.compare(任意不同密码, 写入哈希)` 为 false
    - **Validates: Requirements 1.2, 1.4**

  - [ ]* 2.3 编写属性测试：密码修改授权正确性
    - **Property 5: 密码修改授权正确性**
    - 文件：`packages/backend/src/participation/credential.property.test.ts`
    - 生成任意 `roles` 数组与任意密码修改请求，mock DynamoDB，验证仅当"角色含 SuperAdmin 且新密码通过强度校验"时凭证记录（`passwordHash`、`version`）才发生变化，其余所有情况记录保持不变
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 2.4 编写属性测试：登录正确性
    - **Property 7: 登录正确性**
    - 文件：`packages/backend/src/participation/credential.property.test.ts`
    - 生成任意存储凭证 `(username, passwordHash)` 与任意登录尝试 `(submittedUsername, submittedPassword)`，验证登录成功当且仅当用户名和密码同时匹配；任何不匹配组合均返回同一通用错误
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 2.5 编写单元测试：bootstrap 与哈希格式异常路径
    - 文件：`packages/backend/src/participation/credential.test.ts`
    - 表为空时创建默认记录（验证条件写参数）；已存在记录直接读取；`passwordHash` 格式不合法时抛出错误且不调用任何写操作
    - _Requirements: 1.1, 1.3, 1.6_

- [x] 3. 会话模块：JWT 签发与校验（版本号吊销机制）
  - [x] 3.1 创建 `packages/backend/src/participation/session.ts`
    - 定义 `QuerySessionPayload`（`credentialVersion`）
    - 实现 `issueQuerySession(payload)`：使用独立 SSM 参数 `QUERY_JWT_SECRET_PARAM`（模式参考 `auth/token.ts` 的 SSM 缓存读取），24 小时有效期
    - 实现 `verifyQuerySession(token, currentVersion)`：区分 `MALFORMED` / `EXPIRED` / `STALE_VERSION`（`credentialVersion` 不匹配）三种失败原因，否则返回 valid
    - _Requirements: 3.2, 4.1, 4.2, 4.3, 4.4_

  - [x]* 3.2 编写属性测试：会话校验正确性
    - **Property 8: 会话校验正确性**
    - 创建 `packages/backend/src/participation/session.property.test.ts`
    - 生成任意当前版本号与任意 token（含：用当前版本正确签发的 token、用不同版本签发的 token、篡改后的字符串、已过期的 token），验证 `verifyQuerySession` 接受当且仅当 token 是格式正确、签名有效、未过期且 `credentialVersion` 与当前版本一致
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x]* 3.3 编写属性测试：密码修改导致会话版本递增
    - **Property 6: 密码修改导致会话版本递增**
    - 文件：`packages/backend/src/participation/session.property.test.ts`
    - 生成任意当前版本 `V`，模拟一次成功的密码修改（`V' = V + 1`），验证携带版本 `V` 的旧 token 在版本变为 `V'` 后被拒绝，而携带 `V'` 的新签发 token 被接受
    - **Validates: Requirements 2.7**

- [x] 4. Checkpoint - 确保凭证与会话模块所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. 登录锁定模块：按来源 IP 的滑动窗口限流
  - [x] 5.1 创建 `packages/backend/src/participation/login-lockout.ts`
    - 定义常量 `MAX_LOGIN_FAILURES = 5`、`SLIDING_WINDOW_MS`、`LOCK_DURATION_MS`（均为 15 分钟），模式参考 `auth/login.ts` 现有账号锁定逻辑
    - 实现纯函数 `evaluateLockout(state, now)`、`recordFailure(state, now)`、`recordSuccess()`
    - 实现 IO 函数 `getLockoutState(ip, dynamoClient, table)`、`saveLockoutState(ip, state, dynamoClient, table)`（附加 TTL 属性）
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 5.2 编写属性测试：按来源隔离的登录失败锁定
    - **Property 9: 按来源隔离的登录失败锁定**
    - 创建 `packages/backend/src/participation/login-lockout.property.test.ts`
    - 生成任意分布在多个来源 IP 上的失败/成功事件序列，验证：每个 IP 的锁定状态只依赖该 IP 自身的历史事件，与其他 IP 的事件无关；15 分钟窗口内累计 5 次失败即锁定 15 分钟并拒绝该 IP 后续所有请求（附带正确剩余时长）；解锁状态下一次成功登录将该 IP 失败计数重置为 0
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 5.3 编写单元测试：滑动窗口边界
    - 文件：`packages/backend/src/participation/login-lockout.test.ts`
    - 测试窗口过期后重新开窗计数；测试锁定截止时刻边界（刚好到期 vs 差 1ms 未到期）
    - _Requirements: 5.1, 5.2_

- [x] 6. 聚合模块：员工过滤、支持次数与总计聚合
  - [x] 6.1 创建 `packages/backend/src/participation/aggregate.ts` 中的过滤与聚合部分
    - 定义 `SupportRecord`、`EmployeeDirectoryEntry`、`ActivityMeta`、`SupportCountRow`、`EmployeeSummaryRow` 类型
    - 实现 `filterCurrentEmployeeRecords(records, directory)`：仅保留关联用户当前 `isEmployee===true` 且账号仍存在于 directory 中的记录
    - 实现 `aggregateSupportCount(records, role, directory)`：按 `userId` 分组、按 `activityId` 去重计数，仅返回 count≥1 的员工
    - 实现 `aggregateEmployeeSummary(records, directory)`：合并 Speaker/Volunteer 的 `activityId` 集合后去重计数，仅返回 total≥1 的员工
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 12.1, 12.2_

  - [ ]* 6.2 编写属性测试：Speaker/志愿者支持次数聚合正确性
    - **Property 10: Speaker/志愿者支持次数聚合正确性**
    - 创建 `packages/backend/src/participation/aggregate.property.test.ts`
    - 生成含重复 `activityId`、非员工用户记录、directory 中不存在的用户记录的支持记录集合，及任意目标角色，验证 `aggregateSupportCount` 恰好为每位在该角色下拥有至少一条合规记录的员工返回一行，`supportCount` 等于该员工在该角色下的去重 `activityId` 数量；该字段恒为正整数；零支持的员工从不出现
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4**

  - [ ]* 6.3 编写属性测试：员工活动支持总计聚合正确性
    - **Property 11: 员工活动支持总计聚合正确性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意员工的合规 Speaker 与 Volunteer 支持记录集合，验证 `aggregateEmployeeSummary` 的 `totalActivityCount` 等于该员工 Speaker `activityId` 集合与 Volunteer `activityId` 集合的并集大小（双身份支持同一活动只计一次）；该字段在员工出现时恒为正整数；零支持员工不出现
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

  - [ ]* 6.4 编写属性测试：当前员工状态关联过滤正确性
    - **Property 18: 当前员工状态关联过滤正确性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意支持记录集合与代表 Users 表当前状态的 directory，验证 `filterCurrentEmployeeRecords` 保留一条记录当且仅当其 `userId` 在 directory 中存在且 `isEmployee===true`；对同一记录集合，在两次调用之间翻转某用户的 `isEmployee` 标志会翻转该用户记录的保留结果，证明过滤器始终使用当前 directory 值而非任何历史值
    - **Validates: Requirements 12.1, 12.2**

  - [ ]* 6.5 编写单元测试：聚合边界场景
    - 文件：`packages/backend/src/participation/aggregate.test.ts`
    - 测试空记录集合返回空数组；测试同一活动同时担任双角色时汇总正确计 1 次
    - _Requirements: 6.3, 7.3, 8.3, 8.4_

- [x] 7. 聚合模块：活动明细聚合、活动过滤与分页
  - [x] 7.1 实现 `aggregateActivityDetail`、`filterActivities`、`paginateActivities`
    - `aggregateActivityDetail(records, directory, activityMeta)`：按活动聚合参与员工及身份（`roles` 数组含 1-2 个元素、无重复），仅返回员工列表非空的活动；活动按 `activityDate` 降序排列，每活动员工按 `nickname` 升序排列
    - `filterActivities(activities, query)`：按 `activityId` 精确匹配 / `topic` 关键字子串匹配（不区分大小写）/ `activityDate` 范围过滤，多条件 AND 组合；无匹配返回空数组而非错误
    - `paginateActivities(activities, page, pageSize?)`：默认/最大 50 条每页，`page` 从 1 开始
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 7.2 编写属性测试：活动支持记录明细聚合正确性
    - **Property 12: 活动支持记录明细聚合正确性**
    - 创建 `packages/backend/src/participation/aggregate.property.test.ts`（追加）
    - 生成任意合规支持记录集合，验证 `aggregateActivityDetail` 恰好返回拥有至少一位合规员工的活动；每个返回活动列出全部不同参与员工，且身份集合正确（同一活动担任 Speaker 与 Volunteer 双身份时同时含 `'Speaker'` 与 `'Volunteer'`），按 nickname 升序排列；活动列表按 `activityDate` 降序排列；无合规员工的活动从不出现
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 7.3 编写属性测试：活动查询过滤正确性
    - **Property 13: 活动查询过滤正确性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意活动集合与任意 `activityId`/topic 关键字/日期范围过滤条件组合，验证 `filterActivities` 恰好返回满足全部给定条件的活动（`activityId` 精确匹配、topic 不区分大小写子串匹配、日期范围为闭区间）；无匹配时返回空数组而非抛出异常
    - **Validates: Requirements 9.5, 9.6**

  - [ ]* 7.4 编写属性测试：活动列表分页往返一致性
    - **Property 14: 活动列表分页往返一致性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意已排序活动列表与任意不超过 50 的页大小，验证 `paginateActivities` 每页最多含 50 条；按页码顺序拼接所有页恰好复现原始排序列表，无重复无遗漏
    - **Validates: Requirements 9.7**

  - [ ]* 7.5 编写单元测试：活动聚合边界场景
    - 文件：`packages/backend/src/participation/aggregate.test.ts`
    - 测试单一活动零参与员工被排除；测试同一活动内多名员工按花名排序
    - _Requirements: 9.4_

- [x] 8. Checkpoint - 确保聚合模块所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. 聚合模块：关键字搜索与日期范围校验/过滤
  - [x] 9.1 实现 `filterByKeyword`、`validateKeyword`、`validateDateRange`、`filterRecordsByDateRange`
    - `filterByKeyword(rows, keyword?)`：`nickname`/`email` 经 trim + 小写后包含 trim + 小写关键字；关键字为空/未提供时原样返回
    - `validateKeyword(keyword?)`：长度 1-100 合法，超长返回校验错误
    - `validateDateRange(startDate?, endDate?)`：都不提供为合法；都提供且均为合法 `YYYY-MM-DD` 日期且 `startDate<=endDate` 为合法；其余组合均不合法
    - `filterRecordsByDateRange(records, activityMeta, startDate?, endDate?)`：按关联活动日期过滤，未提供范围时返回全部
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 9.2 编写属性测试：员工关键字搜索过滤正确性
    - **Property 15: 员工关键字搜索过滤正确性**
    - 创建 `packages/backend/src/participation/aggregate.property.test.ts`（追加）
    - 生成任意关键字字符串与任意 `{nickname, email}` 行列表，验证 `filterByKeyword` 恰好返回 `nickname` 或 `email` 包含 trim+小写关键字子串的行；空/缺失关键字返回完整未过滤列表；`validateKeyword` 拒绝超过 100 字符的关键字；无匹配返回空列表而非错误
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

  - [ ]* 9.3 编写属性测试：日期范围输入校验正确性
    - **Property 16: 日期范围输入校验正确性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意可选的 `(startDate, endDate)` 组合（含合法/非法格式、非法日历日期、`start>end`、仅提供一个），验证 `validateDateRange` 接受当且仅当两者都缺省，或两者都是合法 `YYYY-MM-DD` 日期且 `startDate<=endDate`；其余组合均被拒绝
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5**

  - [ ]* 9.4 编写属性测试：日期范围记录过滤正确性
    - **Property 17: 日期范围记录过滤正确性**
    - 文件：`packages/backend/src/participation/aggregate.property.test.ts`
    - 生成任意（已校验合法的）日期范围或其缺省，及任意关联活动日期的支持记录集合，验证 `filterRecordsByDateRange` 恰好返回活动日期落在闭区间范围内的记录；未提供范围时返回全部记录
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 9.5 编写单元测试：关键字与日期边界场景
    - 文件：`packages/backend/src/participation/aggregate.test.ts`
    - 测试关键字恰好 100/101 字符边界；测试日期范围首尾日期（含边界当天）与跨年场景
    - _Requirements: 10.2, 11.1_

- [x] 10. DynamoDB 查询编排模块
  - [x] 10.1 创建 `packages/backend/src/participation/query.ts`
    - 定义 `ViewFilter`、`ActivityViewFilter`、`QueryContext`、`QueryResult<T>` 接口
    - 实现从 `PointsRecords`（`type-createdAt-index`，过滤 `targetRole in ['Speaker','Volunteer']`）与 `BatchDistributions`（`createdAt-index`）拉取全部历史记录并归一化为 `SupportRecord[]` 的辅助函数
    - 实现通过 `BatchGetCommand` 从 `Users` 表批量获取 `EmployeeDirectoryEntry`、从 `Activities` 表批量获取 `ActivityMeta` 的辅助函数
    - 实现 `querySpeakerSupport`、`queryVolunteerSupport`、`queryEmployeeSummary`、`queryActivityDetail` 四个导出函数，编排"取数 → 关联 → `filterCurrentEmployeeRecords` → 日期范围过滤 → 角色/聚合函数 → 关键字/活动过滤 → （活动明细视图）分页"管道
    - _Requirements: 6.1, 7.1, 8.1, 9.1, 9.7, 10.1, 11.1, 12.1, 12.2, 12.3_

  - [ ]* 10.2 编写单元测试：查询编排管道集成
    - 文件：`packages/backend/src/participation/query.test.ts`
    - Mock DynamoDB client，验证四个查询函数正确调用聚合模块并返回预期结构；验证 `BatchGetCommand` 正确批量获取用户/活动信息
    - _Requirements: 6.1, 7.1, 8.1, 9.1_

- [x] 11. Checkpoint - 确保查询编排模块所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 导出模块
  - [x] 12.1 创建 `packages/backend/src/participation/formatters.ts`
    - 实现 `validateExportFormat(format: unknown)`：仅 `'csv'`/`'xlsx'` 合法
    - 实现 `getColumnDefs(view: ParticipationView)`：四类视图各自固定列定义（顺序即导出顺序，参照设计文档"导出列定义"表格）
    - 实现 `checkExportSizeLimit(count: number)`：超过 50,000 拒绝并返回大小提示错误
    - 复用 `reports/formatters.ts` 中 CSV/Excel 生成的实现模式（`xlsx` 库）
    - _Requirements: 13.2, 13.5, 13.6_

  - [ ]* 12.2 编写属性测试：导出格式校验正确性
    - **Property 19: 导出格式校验正确性**
    - 创建 `packages/backend/src/participation/export.property.test.ts`
    - 生成任意字符串，验证 `validateExportFormat` 接受当且仅当值恰好为 `'csv'` 或 `'xlsx'`
    - **Validates: Requirements 13.2**

  - [ ]* 12.3 编写属性测试：导出记录数上限保护
    - **Property 21: 导出记录数上限保护**
    - 文件：`packages/backend/src/participation/export.property.test.ts`
    - 生成任意候选导出记录数（用计数参数模拟而非真实生成 5 万+对象），验证 `checkExportSizeLimit` 允许导出当且仅当数量 ≤50,000；超过阈值恒被拒绝并返回大小提示错误，且被拒绝的导出不产生任何文件
    - **Validates: Requirements 13.5**

  - [ ]* 12.4 编写属性测试：导出列与页面展示字段一致
    - **Property 22: 导出列与页面展示字段一致**
    - 文件：`packages/backend/src/participation/export.property.test.ts`
    - 对四类视图类型分别验证：导出文件表头行恰好等于该视图 `getColumnDefs` 的结果，顺序与数量一致，且不含导出时间戳、操作者身份等额外列
    - **Validates: Requirements 13.6**

  - [x] 12.5 创建 `packages/backend/src/participation/export.ts`
    - 实现 `executeParticipationExport(input, ctx)`：复用 `query.ts` 中与视图查询相同的查询/聚合/过滤管道（不分页，取全部匹配数据），使用 `checkExportSizeLimit` 校验记录数，生成 CSV/Excel 后上传 S3 `exports/participation-query/*` 前缀，返回 30 分钟有效预签名下载 URL（模式参考 `reports/export.ts`）
    - 导出过程中任何系统错误（文件生成/S3 上传失败）返回失败且不产生部分或损坏文件
    - _Requirements: 13.1, 13.3, 13.4, 13.7_

  - [ ]* 12.6 编写属性测试：导出数据与视图查询结果一致
    - **Property 20: 导出数据与视图查询结果一致**
    - 文件：`packages/backend/src/participation/export.property.test.ts`
    - 对四类视图类型及任意过滤条件（含"无过滤"情况），mock 查询管道，验证写入导出文件的行恰好等于同一查询/聚合/过滤管道针对该过滤条件渲染视图时的格式化输出；包含过滤后结果集为空的边界情况——此时导出仍应成功并只产生表头文件，而非被视为失败
    - **Validates: Requirements 13.3, 13.4**

  - [ ]* 12.7 编写单元测试：导出失败注入
    - 文件：`packages/backend/src/participation/export.test.ts`
    - Mock S3 上传抛出异常，断言返回失败且不残留部分文件
    - _Requirements: 13.7_

- [x] 13. Checkpoint - 确保导出模块所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. 查询鉴权中间件
  - [x] 14.1 创建 `packages/backend/src/participation/auth-middleware.ts`
    - 实现 `withQuerySession(handler)`：解析 `Authorization: Bearer <token>`，缺失或非 Bearer 格式返回 401（`QUERY_UNAUTHORIZED`）；读取当前凭证 version（`getOrBootstrapCredential`）；调用 `verifyQuerySession`，按失败原因映射到 `QUERY_SESSION_EXPIRED`（401）/`QUERY_SESSION_REVOKED`（401）；通过后调用被包装的 handler
    - 凭证记录 `passwordHash` 格式不合法时返回 500（`QUERY_CREDENTIAL_CORRUPTED`）并记录日志
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 1.6_

  - [ ]* 14.2 编写单元测试：会话中间件场景
    - 文件：`packages/backend/src/participation/auth-middleware.test.ts`
    - 测试缺失/畸形 Authorization 头场景；测试过期 token；测试版本不匹配（吊销）场景；测试凭证损坏场景
    - _Requirements: 4.1, 4.2, 4.3, 1.6_

- [x] 15. Query Lambda 入口：登录路由
  - [x] 15.1 创建 `packages/backend/src/participation/handler.ts` 的登录路由
    - 实现 `POST /api/query/login`：从事件中提取客户端来源 IP，先调用 `getLockoutState` 检查锁定；未锁定则调用 `verifyCredential`；成功则 `recordSuccess` 重置计数并 `issueQuerySession`；失败则 `recordFailure` 累加计数，返回 `QUERY_INVALID_CREDENTIALS`（401）或 `QUERY_LOGIN_LOCKED`（403，含剩余锁定时长）
    - 用户名/密码长度校验（≤64 字符）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3_

  - [x] 15.2 添加受保护路由与 CORS 处理
    - 使用 `withQuerySession` 包装：`GET /api/query/speaker-support`、`GET /api/query/volunteer-support`、`GET /api/query/employee-summary`、`GET /api/query/activity-detail`、`POST /api/query/export`
    - 添加 `POST /api/query/logout`：直接返回 200
    - 统一 CORS 头处理（模式参考现有 handler CORS 配置）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.1, 7.1, 8.1, 9.1, 13.1_

  - [ ]* 15.3 编写单元测试：登录路由集成
    - 文件：`packages/backend/src/participation/handler.test.ts`
    - 测试路由分发、CORS 头、登录成功/失败/锁定场景（401/403）、受保护路由缺失 token 返回 401
    - _Requirements: 3.2, 3.3, 5.2_

- [x] 16. Checkpoint - 确保 Query Lambda 所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Admin Lambda 新增路由：SuperAdmin 修改查询密码
  - [x] 17.1 在 `packages/backend/src/admin/handler.ts` 新增路由
    - 新增 `PUT /api/admin/settings/query-credential-password`：复用现有 `isSuperAdmin` 校验，非 SuperAdmin 返回 `FORBIDDEN`（403）
    - 实现 `handleUpdateQueryCredentialPassword(event)`，调用 `participation/credential.ts` 的 `updateCredentialPassword`，成功返回更新结果（不含密码字段），失败返回对应错误码（`FORBIDDEN`/`INVALID_PASSWORD_FORMAT`）
    - 新增环境变量 `QUERY_CREDENTIALS_TABLE`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 17.2 编写单元测试：密码修改路由权限
    - 文件：`packages/backend/src/admin/handler.test.ts`
    - 测试非 SuperAdmin 调用返回 403；测试 SuperAdmin 调用合法/不合法新密码的响应
    - _Requirements: 2.5, 2.6_

- [x] 18. Checkpoint - 确保 Admin Lambda 新增路由测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. CDK 基础设施：DynamoDB 表、SSM 参数、Query Lambda、API 路由
  - [x] 19.1 更新 `packages/cdk/lib/database-stack.ts`
    - 新增 `PointsMall-QueryCredentials` 表：PK=`username`，`PAY_PER_REQUEST` 计费模式，无 GSI
    - 新增 `PointsMall-QueryLoginAttempts` 表：PK=`ip`，`PAY_PER_REQUEST` 计费模式，启用 `ttl` 属性自动清理，无 GSI
    - 添加对应 `CfnOutput`（表名与 ARN）
    - _Requirements: 1.1, 5.1_

  - [x] 19.2 更新 `packages/cdk/lib/api-stack.ts`：新增 Query Lambda 与 SSM 参数
    - 新增 SSM SecureString 参数引用 `/points-mall/query-jwt-secret`（模式参考现有 `jwtSecretParam`）
    - 新增 CDK 参数 `queryDefaultUsername` / SSM SecureString 参数 `/points-mall/query-default-password`（不在代码或模板中出现明文密码）
    - 新增 `QueryFunction`（`NodejsFunction`，`functionName: 'PointsMall-Query'`，`entry: participation/handler.ts`），环境变量含 `QUERY_CREDENTIALS_TABLE`、`QUERY_LOGIN_ATTEMPTS_TABLE`、`QUERY_JWT_SECRET_PARAM`、只读的 `USERS_TABLE`/`POINTS_RECORDS_TABLE`/`BATCH_DISTRIBUTIONS_TABLE`/`ACTIVITIES_TABLE`、导出用的图片 S3 桶名
    - 授予 Query Lambda 对 `QueryCredentials`/`QueryLoginAttempts` 表的读写权限，对 `Users`/`PointsRecords`/`BatchDistributions`/`Activities` 表的只读权限，对图片 S3 桶 `exports/participation-query/*` 前缀的 `PutObject`/`GetObject` 权限
    - 授予 Admin Lambda (`adminFn`) 对 `QueryCredentials` 表的读写权限（不含 `QueryLoginAttempts`），新增 `QUERY_CREDENTIALS_TABLE` 环境变量
    - _Requirements: 1.1, 1.3, 2.1, 3.1, 13.1_

  - [x] 19.3 添加 API Gateway 路由
    - `POST /api/query/login` → Query Lambda（公开）
    - `GET /api/query/speaker-support`、`GET /api/query/volunteer-support`、`GET /api/query/employee-summary`、`GET /api/query/activity-detail`、`POST /api/query/export`、`POST /api/query/logout` → Query Lambda
    - `PUT /api/admin/settings/query-credential-password` → 挂载到现有 Admin Lambda 路由（`admin` resource 下新增 `settings/query-credential-password`）
    - _Requirements: 3.1, 4.1, 6.1, 7.1, 8.1, 9.1, 13.1, 2.1_

  - [ ]* 19.4 编写 CDK 快照/断言测试
    - 文件：`packages/cdk/test/`（沿用现有测试文件模式）
    - 断言 `PointsMall-QueryCredentials`、`PointsMall-QueryLoginAttempts` 表存在且分区键正确；断言 Query Lambda 存在且拥有正确的表读写权限边界
    - _Requirements: 1.1, 5.1_（IaC 配置校验，非属性测试）

- [x] 20. Checkpoint - 确保 CDK 基础设施配置通过 synth/测试
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. 前端：独立查询登录页
  - [x] 21.1 创建 `packages/frontend/src/pages/query-login/index.tsx` 与 `index.config.ts`、`index.scss`
    - 全新页面，不 import `pages/login` 下任何组件，不调用 `useAppStore` 中商城登录 action
    - 表单：用户名/密码输入（各≤64 字符前端校验），提交调用独立请求（`POST /api/query/login`，`skipAuth: true`，不携带商城 `Authorization`）
    - 登录成功后将返回的 Query_Session 存入独立本地存储 key `queryToken`（与商城 `access_token` 区分），跳转至 `pages/query-dashboard/index`
    - 登录失败（401 通用错误 / 403 锁定错误含剩余时长）时展示对应提示
    - 遵循 `.kiro/steering/frontend-design.md` 的颜色/间距/圆角/过渡 CSS 变量规范
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2_

  - [x] 21.2 在 `packages/frontend/src/app.config.ts` 注册新页面
    - 新增 `'pages/query-login/index'` 与 `'pages/query-dashboard/index'` 到 `pages` 数组
    - _Requirements: 3.1_

  - [ ]* 21.3 编写单元测试：登录页表单校验与提交流程
    - 文件：`packages/frontend/src/pages/query-login/index.test.tsx`
    - 测试用户名/密码超长时前端阻止提交；测试登录成功后 `queryToken` 被写入且跳转；测试登录失败展示对应错误提示
    - _Requirements: 3.2, 3.3_

- [x] 22. 前端：查询主页面（四个视图 Tab）
  - [x] 22.1 创建 `packages/frontend/src/pages/query-dashboard/index.tsx` 与 `index.config.ts`、`index.scss`
    - 四个 Tab：Speaker 支持次数、志愿者支持次数、员工活动支持总计、活动支持记录明细
    - 顶部：人员类视图提供花名/邮箱关键字搜索框；活动明细视图提供活动 ID/主题关键字筛选；所有视图提供日期范围选择器；每个视图提供导出按钮
    - 所有请求携带 `Authorization: Bearer <queryToken>`（独立于商城 `request` 工具，或复用其底层 HTTP 客户端但走 `/api/query/*` 且不注入商城 token）
    - 收到 401 响应时清除本地 `queryToken` 并跳转至 `pages/query-login/index`
    - 活动明细视图使用分页组件（每页 50 条）；人员类视图渲染表格列表
    - _Requirements: 4.5, 6.1, 7.1, 8.1, 9.1, 9.2, 9.7, 10.1, 10.4, 11.1_

  - [x] 22.2 实现导出交互
    - 每个视图的导出按钮弹出格式选择（CSV/Excel），触发导出请求并携带当前生效的搜索关键字/日期范围
    - 导出成功后展示预签名下载链接或直接触发浏览器下载；导出失败展示错误提示；记录数超限时展示提示信息告知缩小筛选范围
    - _Requirements: 13.1, 13.2, 13.5, 13.7_

  - [ ]* 22.3 编写单元测试：401 后清除会话并跳转
    - 文件：`packages/frontend/src/pages/query-dashboard/index.test.tsx`
    - Mock 401 响应，断言清除 `queryToken` 并跳转登录页
    - _Requirements: 4.5_

  - [ ]* 22.4 编写单元测试：四个视图导出按钮存在性
    - 文件：`packages/frontend/src/pages/query-dashboard/index.test.tsx`
    - 断言四个视图分别渲染导出按钮
    - _Requirements: 13.1_

- [x] 23. Checkpoint - 确保查询前端页面所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. 前端：管理后台设置页新增"查询系统密码管理"区块
  - [x] 24.1 更新 `packages/frontend/src/pages/settings/index.tsx`
    - 复用现有 `user.roles.includes('SuperAdmin')` 判断模式，仅当当前用户为 SuperAdmin 时渲染新区块
    - 新增密码修改表单：新密码输入 + 前端校验（≥8 位且含字母和数字，与后端规则一致）
    - 提交调用 `PUT /api/admin/settings/query-credential-password`（携带商城管理员 `Authorization`），成功后展示提示；失败展示对应错误（403/400）
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 24.2 更新 `packages/frontend/src/pages/settings/index.scss`
    - 遵循 `.kiro/steering/frontend-design.md` 规范：颜色使用 CSS 变量，间距使用 `--space-*`，圆角使用 `--radius-*`
    - _Requirements: 2.1_

  - [ ]* 24.3 编写属性测试：SuperAdmin 密码入口可见性
    - **属性测试补充**（对应设计文档 Testing Strategy 中"UI 条件渲染，具体场景"，非 22 个正式 Property 之一，采用具体场景测试）
    - 更新 `packages/frontend/src/pages/settings/settings.property.test.tsx`
    - 有 SuperAdmin 角色时区块可见；无 SuperAdmin 角色时区块不可见
    - _Requirements: 2.1, 2.2_

- [x] 25. Final checkpoint - 确保全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- 22 个正式 Correctness Properties（设计文档中 Property 1-22）均已分配到对应任务的属性测试子任务中
- 属性测试统一使用 `fast-check`，最少 100 次迭代，标签格式：`Feature: employee-participation-query, Property {N}: {title}`
- 该模块完全独立于商城用户账号体系：独立 Lambda（`PointsMall-Query`）、独立 DynamoDB 表（`QueryCredentials`、`QueryLoginAttempts`）、独立 JWT 密钥（`/points-mall/query-jwt-secret`），唯一的耦合点是 Admin Lambda 新增的密码修改路由（复用现有权限中间件）与四张只读业务表（`Users`/`PointsRecords`/`BatchDistributions`/`Activities`）
- 导出功能复用 `reports/export.ts` 与 `reports/formatters.ts` 的既有实现模式（S3 预签名下载链接、`xlsx` 库生成 Excel）
- 密码哈希使用 `bcryptjs`（已是 backend 依赖），JWT 使用 `jsonwebtoken`（已是 backend 依赖），属性测试使用 `fast-check`（已是根 devDependency）
- 前端遵循 `.kiro/steering/frontend-design.md`：所有颜色/间距/圆角/过渡使用既有 CSS 变量，不硬编码色值
- 安全注意：初始查询密码通过 SSM SecureString 注入，代码和 CDK 模板中不出现任何明文密码（参见 `.kiro/steering/security-rules.md`）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["4"] },
    { "id": 5, "tasks": ["5.1", "6.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.2", "6.3", "6.4", "6.5", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "7.5", "9.1"] },
    { "id": 8, "tasks": ["8"] },
    { "id": 9, "tasks": ["9.2", "9.3", "9.4", "9.5", "10.1"] },
    { "id": 10, "tasks": ["10.2"] },
    { "id": 11, "tasks": ["11"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["12.2", "12.3", "12.4", "12.5"] },
    { "id": 14, "tasks": ["12.6", "12.7"] },
    { "id": 15, "tasks": ["13"] },
    { "id": 16, "tasks": ["14.1"] },
    { "id": 17, "tasks": ["14.2", "15.1"] },
    { "id": 18, "tasks": ["15.2"] },
    { "id": 19, "tasks": ["15.3", "17.1"] },
    { "id": 20, "tasks": ["16", "17.2"] },
    { "id": 21, "tasks": ["18"] },
    { "id": 22, "tasks": ["19.1"] },
    { "id": 23, "tasks": ["19.2"] },
    { "id": 24, "tasks": ["19.3"] },
    { "id": 25, "tasks": ["19.4"] },
    { "id": 26, "tasks": ["20"] },
    { "id": 27, "tasks": ["21.1"] },
    { "id": 28, "tasks": ["21.2", "24.1"] },
    { "id": 29, "tasks": ["21.3", "24.2", "22.1"] },
    { "id": 30, "tasks": ["24.3", "22.2"] },
    { "id": 31, "tasks": ["22.3", "22.4"] },
    { "id": 32, "tasks": ["23"] },
    { "id": 33, "tasks": ["25"] }
  ]
}
```
