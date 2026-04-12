# 实现计划：管理员批量积分发放

## 概述

为管理后台新增批量积分发放功能。涉及共享类型扩展（DistributionRecord）、CDK 新增 BatchDistributions DynamoDB 表与 API 路由、后端 batch-points.ts 模块（批量发放、历史查询、详情查询）、Admin Handler 路由扩展、2 个前端新页面（批量发放页、发放历史页）、管理后台导航入口、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型扩展
  - [x] 1.1 新增 DistributionRecord 类型定义
    - 在 `packages/shared/src/types.ts` 中新增 `DistributionRecord` 接口：
      - distributionId: string
      - distributorId: string
      - distributorNickname: string
      - targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer'
      - recipientIds: string[]
      - recipientDetails?: { userId: string; nickname: string; email: string }[]
      - points: number
      - reason: string
      - successCount: number
      - totalPoints: number
      - createdAt: string
    - _需求: 4.9, 6.3_

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 BatchDistributions DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `BatchDistributions` 表：PK=`distributionId`（String），PAY_PER_REQUEST 计费
      - GSI `createdAt-index`：PK=`pk`（String，固定值 "ALL"），SK=`createdAt`（String）— 用于按时间倒序查询历史
    - 导出表的公共属性，添加 CfnOutput
    - _需求: 9.2_

  - [x] 2.2 更新 ApiStack 添加 BatchDistributions 表集成
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `batchDistributionsTable` 属性
      - 为 Admin Lambda 添加 `BATCH_DISTRIBUTIONS_TABLE` 环境变量
      - 为 Admin Lambda 授予 BatchDistributions 表读写权限
    - 更新 `packages/cdk/bin/app.ts` 传递 batchDistributionsTable 引用给 ApiStack
    - _需求: 9.3, 9.4, 9.5_

  - [x] 2.3 新增 API Gateway 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中注册管理端路由（集成到 Admin Lambda）：
      - POST `/api/admin/batch-points` → AdminFunction（执行批量发放）
      - GET `/api/admin/batch-points/history` → AdminFunction（查看发放历史）
      - GET `/api/admin/batch-points/history/{id}` → AdminFunction（查看发放详情）
    - 所有路由自动继承 CORS 预检配置
    - _需求: 9.1, 9.6_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型编译通过、CDK 代码编译通过，新增表和路由定义正确。如有问题请向用户确认。

- [x] 4. 后端批量发放核心模块
  - [x] 4.1 实现批量发放核心逻辑
    - 创建 `packages/backend/src/admin/batch-points.ts`
    - 实现 `validateBatchDistributionInput(body)` 函数：
      - 校验 userIds 为非空字符串数组
      - 校验 points 为正整数且 ≥ 1
      - 校验 reason 为 1~200 字符字符串
      - 校验 targetRole 为 'UserGroupLeader' | 'Speaker' | 'Volunteer' 之一
      - 无效时返回 `{ valid: false, error: { code: 'INVALID_REQUEST', message: '具体错误' } }`
    - 实现 `executeBatchDistribution(input, dynamoClient, tables)` 函数：
      - 对 userIds 做 Set 去重
      - 获取每个用户当前积分余额（BatchGetCommand）
      - 按 25 人一批拆分事务（DynamoDB TransactWriteItems 限制 100 操作，每人 2 操作）
      - 每批事务包含：UpdateCommand 增加用户 points + PutCommand 写入 PointsRecords（type='earn', source='管理员批量发放:{distributionId}'）
      - 所有批次成功后，PutCommand 写入 BatchDistributions 表（含 pk='ALL' 用于 GSI 查询）
      - 返回 distributionId、successCount、totalPoints
      - 任何批次失败则返回错误，不创建 Distribution_Record
    - _需求: 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.2_

  - [x] 4.2 实现发放历史查询逻辑
    - 在 `packages/backend/src/admin/batch-points.ts` 中实现 `listDistributionHistory(options, dynamoClient, table)` 函数：
      - 使用 GSI `createdAt-index` 查询（PK='ALL', ScanIndexForward=false）实现时间倒序
      - pageSize 默认 20，钳制到 [1, 100] 范围
      - 支持 base64 编码的 lastKey 分页游标
      - 返回 distributions 列表和 lastKey
    - 实现 `getDistributionDetail(distributionId, dynamoClient, table)` 函数：
      - GetCommand 获取单条记录
      - 不存在时返回 DISTRIBUTION_NOT_FOUND 错误
    - _需求: 6.3, 6.4, 6.5, 6.6_

  - [x] 4.3 编写批量发放单元测试
    - 创建 `packages/backend/src/admin/batch-points.test.ts`
    - 测试场景：
      - 输入验证：有效输入通过、缺少字段被拒绝、points 非正整数被拒绝、reason 超长被拒绝、无效 targetRole 被拒绝
      - 权限校验：Admin 可执行、SuperAdmin 可执行、普通用户被拒绝
      - 去重逻辑：重复 userIds 仅发放一次
      - 事务构建：验证 DynamoDB 事务参数正确
      - 历史查询：分页参数处理、时间倒序
      - 详情查询：存在的记录返回成功、不存在返回 DISTRIBUTION_NOT_FOUND
    - _需求: 4.3~4.12, 5.1~5.3, 6.1~6.6_

  - [x] 4.4 编写客户端搜索过滤属性测试
    - **Property 1: Client-side search filters correctly by nickname or email**
    - 创建 `packages/backend/src/admin/batch-points.property.test.ts`
    - 使用 fast-check 生成随机用户列表和搜索字符串，验证过滤结果仅包含昵称或邮箱匹配的用户，且不遗漏匹配项
    - **验证: 需求 1.5**

  - [x] 4.5 编写请求体验证属性测试
    - **Property 2: Request body validation accepts valid inputs and rejects invalid inputs**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成随机请求体，验证 validateBatchDistributionInput 对有效输入返回 valid=true，对无效输入返回 valid=false 并附带错误码
    - **验证: 需求 3.2, 3.3, 4.5, 4.6**

  - [x] 4.6 编写批量发放积分正确性属性测试
    - **Property 3: Batch distribution increases each recipient's balance by exactly the specified points**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成随机用户集和积分值，验证发放后每个用户积分余额 = 原余额 + 指定积分，且存在对应 type='earn' 的积分记录
    - **验证: 需求 4.7, 4.8**

  - [x] 4.7 编写发放记录聚合数据正确性属性测试
    - **Property 4: Distribution record and result contain correct aggregated data**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成随机 N 个用户和 P 积分，验证 successCount=N、totalPoints=N×P、distributionId 非空
    - **验证: 需求 4.9, 4.10**

  - [x] 4.8 编写 userIds 去重属性测试
    - **Property 5: Duplicate userIds are deduplicated before distribution**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成含重复项的 userIds 数组，验证 successCount 等于去重后数量，每个用户仅收到一次积分
    - **验证: 需求 5.1, 5.2**

  - [x] 4.9 编写发放历史字段完整性和排序属性测试
    - **Property 6: Distribution history returns records with all required fields in descending time order**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成随机发放记录集，验证历史查询返回的每条记录包含所有必需字段且按 createdAt 降序排列
    - **验证: 需求 6.3, 6.4**

  - [x] 4.10 编写分页 pageSize 范围钳制属性测试
    - **Property 7: Pagination pageSize is clamped to valid range**
    - 在 `packages/backend/src/admin/batch-points.property.test.ts` 中添加
    - 使用 fast-check 生成随机 pageSize 值（含 undefined、负数、超大值），验证有效 pageSize 钳制到 [1, 100]，默认 20
    - **验证: 需求 6.5**

- [x] 5. 后端 Admin Handler 路由扩展
  - [x] 5.1 在 Admin Handler 中添加批量发放路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量读取：`BATCH_DISTRIBUTIONS_TABLE`
      - 导入 `executeBatchDistribution`、`listDistributionHistory`、`getDistributionDetail` 从 `./batch-points`
      - 新增路由正则：`BATCH_POINTS_HISTORY_DETAIL_REGEX = /^\/api\/admin\/batch-points\/history\/([^/]+)$/`
      - POST `/api/admin/batch-points` 路由：
        - 解析请求体，调用 validateBatchDistributionInput 校验
        - 获取发放人昵称（GetCommand Users 表）
        - 调用 executeBatchDistribution
        - 返回 201 + 发放结果
      - GET `/api/admin/batch-points/history` 路由：
        - 校验 SuperAdmin 权限（isSuperAdmin）
        - 解析 pageSize 和 lastKey 查询参数
        - 调用 listDistributionHistory
        - 返回 200 + 历史列表
      - GET `/api/admin/batch-points/history/{id}` 路由：
        - 校验 SuperAdmin 权限
        - 调用 getDistributionDetail
        - 返回 200 + 详情
    - _需求: 4.2, 4.3, 4.4, 6.1, 6.2_

  - [x] 5.2 编写 Admin Handler 路由单元测试
    - 更新 `packages/backend/src/admin/handler.test.ts`
    - 测试新增路由分发正确性：POST batch-points、GET history、GET history/{id}
    - 测试权限校验：Admin 可执行发放、非 SuperAdmin 无法查看历史
    - _需求: 4.3, 6.1, 6.2_

- [x] 6. 检查点 - 后端模块验证
  - 运行所有后端批量发放相关测试（batch-points.test.ts、handler.test.ts、属性测试），确保逻辑正确。如有问题请向用户确认。

- [x] 7. 前端批量发放页面
  - [x] 7.1 创建批量发放页面
    - 创建 `packages/frontend/src/pages/admin/batch-points.tsx` 和 `packages/frontend/src/pages/admin/batch-points.scss`
    - 页面功能：
      - 顶部工具栏：返回按钮 + 标题
      - 角色筛选选项：UserGroupLeader、Speaker、Volunteer 三个标签，点击切换
      - 用户列表区域：
        - 调用 GET `/api/admin/users?role={targetRole}&pageSize=20` 获取用户列表
        - 仅显示 status=active 的用户
        - 每行显示：复选框 + 昵称 + 邮箱 + 当前积分余额
        - 搜索框：按昵称或邮箱客户端模糊搜索过滤
        - 全选/取消全选复选框
        - 下拉加载更多（分页）
      - 已选用户数量实时显示
      - 积分数值输入框：正整数，最小值 1
      - 发放原因输入框：1~200 字符
      - 提交按钮：未选用户或未填写积分/原因时禁用
      - 确认弹窗：显示目标角色、选中用户数、每人积分、积分总计、发放原因
      - 确认后调用 POST `/api/admin/batch-points` 提交
      - 成功后显示成功提示并重置表单
      - 失败时显示具体错误信息
    - 遵循前端设计规范：CSS 变量、全局组件类、角色徽章使用 `.role-badge`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/batch-points` 路由
    - _需求: 1.1~1.6, 2.1~2.5, 3.1~3.5, 4.1, 4.2, 4.11, 4.12, 5.3_

- [x] 8. 前端发放历史页面
  - [x] 8.1 创建发放历史页面
    - 创建 `packages/frontend/src/pages/admin/batch-history.tsx` 和 `packages/frontend/src/pages/admin/batch-history.scss`
    - 页面功能：
      - 顶部工具栏：返回按钮 + 标题
      - 发放历史列表：
        - 调用 GET `/api/admin/batch-points/history` 获取列表
        - 每条记录显示：发放人昵称、目标角色徽章、接收人数量、每人积分、发放原因摘要、发放时间
        - 下拉加载更多（分页）
      - 点击记录展开/弹出详情：
        - 调用 GET `/api/admin/batch-points/history/{id}` 获取详情
        - 显示完整接收人列表（昵称和邮箱）
      - 仅 SuperAdmin 可访问（前端权限校验 + 后端 403）
    - 遵循前端设计规范：CSS 变量、全局组件类
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/batch-history` 路由
    - _需求: 7.1~7.5_

- [x] 9. 管理后台导航集成
  - [x] 9.1 在管理后台首页添加导航入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 的 `ADMIN_LINKS` 数组中新增：
      - "批量发放"卡片：key='batch-points'，url='/pages/admin/batch-points'，Admin 和 SuperAdmin 均可见
      - "发放历史"卡片：key='batch-history'，url='/pages/admin/batch-history'，superAdminOnly=true
    - 为两个卡片选择合适的图标组件
    - _需求: 8.1~8.4_

- [x] 10. 检查点 - 前端页面验证
  - 确保批量发放页、发放历史页编译通过，路由注册正确，管理后台导航入口正确。如有问题请向用户确认。

- [x] 11. i18n 多语言翻译
  - [x] 11.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增 `batchPoints` 模块：
      - `page`：批量发放页文案（标题、角色筛选标签、搜索占位符、全选、已选数量、积分输入标签、原因输入标签、提交按钮、确认弹窗文案、成功提示、错误提示）
      - `history`：发放历史页文案（标题、列表字段标签、详情弹窗文案、空状态、加载更多）
    - 在 `admin.dashboard` 中新增 `batchPointsTitle`、`batchPointsDesc`、`batchHistoryTitle`、`batchHistoryDesc` 键
    - _需求: 10.1, 10.2, 10.4_

  - [x] 11.2 添加 5 种语言翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加 `batchPoints` 模块简体中文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加 `batchPoints` 模块繁体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加 `batchPoints` 模块英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加 `batchPoints` 模块日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加 `batchPoints` 模块韩文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 10.3_

  - [x] 11.3 在前端页面中使用 i18n
    - 在批量发放页和发放历史页中：
      - 导入 `useTranslation`，调用 `const { t } = useTranslation()`
      - 将所有硬编码文案替换为 `t('batchPoints.xxx.xxx')` 调用
      - 管理后台导航卡片使用 `t('admin.dashboard.batchPointsTitle')` 等
    - _需求: 10.1, 10.2_

- [x] 12. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 本次新增 1 张 DynamoDB 表（BatchDistributions）和 3 条 API Gateway 路由
- DynamoDB 事务按 25 人一批拆分（每人 2 操作，事务上限 100 操作）
- 属性测试验证设计文档中定义的 7 个正确性属性
- 发放历史使用 GSI（PK='ALL', SK=createdAt）实现高效时间排序查询
- 积分变动记录 source 格式为 `管理员批量发放:{distributionId}`，便于追溯
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
