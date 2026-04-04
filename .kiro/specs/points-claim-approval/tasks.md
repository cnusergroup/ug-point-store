# 实现计划：积分申请与审批流程（Points Claim Approval）

## 概述

为社区成员提供积分申请与管理员审批的完整流程。涉及新增 DynamoDB Claims 表、后端积分申请提交/查询模块和审批模块、Points Handler 和 Admin Handler 路由扩展、前端积分申请页面和审批管理页面、CDK 路由与权限配置。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增积分申请相关类型和错误码
    - 在 `packages/shared/src/types.ts` 中新增：
      - `ClaimStatus` 类型：`'pending' | 'approved' | 'rejected'`
      - `ClaimRecord` 接口：claimId、userId、applicantNickname、applicantRole、title、description、imageUrls、activityUrl、status、awardedPoints、rejectReason、reviewerId、reviewedAt、createdAt
    - 在 `packages/shared/src/errors.ts` 中新增错误码：
      - `CLAIM_ROLE_NOT_ALLOWED`（403）：当前角色无法申请积分
      - `INVALID_CLAIM_CONTENT`（400）：申请内容格式无效
      - `CLAIM_IMAGE_LIMIT_EXCEEDED`（400）：图片数量超出上限（最多 5 张）
      - `INVALID_ACTIVITY_URL`（400）：活动链接格式无效
      - `CLAIM_NOT_FOUND`（404）：积分申请不存在
      - `CLAIM_ALREADY_REVIEWED`（400）：该申请已被审批
      - `INVALID_POINTS_AMOUNT`（400）：积分数值无效（1~10000）
      - `INVALID_REJECT_REASON`（400）：驳回原因格式无效
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 1.2, 1.4, 1.6, 1.7, 3.4, 3.6, 3.7_

- [x] 2. 后端积分申请提交与查询模块
  - [x] 2.1 实现积分申请提交 submitClaim
    - 创建 `packages/backend/src/claims/submit.ts`
    - 实现 `submitClaim(input, dynamoClient, claimsTable)` 函数
    - 校验用户角色包含 Speaker/UserGroupLeader/CommunityBuilder/Volunteer 之一，否则返回 CLAIM_ROLE_NOT_ALLOWED
    - 校验 title（1~100 字符）和 description（1~1000 字符），否则返回 INVALID_CLAIM_CONTENT
    - 校验 imageUrls 数组长度 ≤ 5（可选），否则返回 CLAIM_IMAGE_LIMIT_EXCEEDED
    - 校验 activityUrl 为合法 URL 格式（可选），否则返回 INVALID_ACTIVITY_URL
    - 使用 ULID 生成 claimId，状态设为 pending，PutCommand 写入 Claims 表
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 2.2 实现查看我的申请列表 listMyClaims
    - 在 `packages/backend/src/claims/submit.ts` 中实现 `listMyClaims(options, dynamoClient, claimsTable)` 函数
    - 使用 GSI `userId-createdAt-index` 查询，ScanIndexForward=false（倒序）
    - 当 status 参数存在时，使用 FilterExpression 过滤 status
    - pageSize 默认 20，最大 100，支持 lastKey 分页游标
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 编写 submitClaim 和 listMyClaims 单元测试
    - 创建 `packages/backend/src/claims/submit.test.ts`
    - 测试有效角色提交成功、无效角色被拒绝、title/description 边界值、imageUrls 超限、activityUrl 格式、分页查询
    - _需求: 1.1~1.8, 2.1~2.6_

  - [ ]* 2.4 编写角色校验正确性属性测试
    - **Property 1: 角色校验正确性**
    - 创建 `packages/backend/src/claims/submit.property.test.ts`
    - 使用 fast-check 生成随机角色集合，验证不含社区角色时被拒绝，含社区角色时通过
    - **验证: 需求 1.1, 1.2**

  - [ ]* 2.5 编写申请内容校验正确性属性测试
    - **Property 2: 申请内容校验正确性**
    - 在 `packages/backend/src/claims/submit.property.test.ts` 中添加
    - 使用 fast-check 生成随机长度 title/description，验证超出范围时被拒绝
    - **验证: 需求 1.3, 1.4**

  - [ ]* 2.6 编写用户申请列表隔离性属性测试
    - **Property 3: 用户申请列表隔离性**
    - 在 `packages/backend/src/claims/submit.property.test.ts` 中添加
    - 使用 fast-check 生成多用户申请记录，验证 listMyClaims 仅返回指定用户的记录
    - **验证: 需求 2.1**

  - [ ]* 2.7 编写状态筛选正确性属性测试
    - **Property 4: 状态筛选正确性**
    - 在 `packages/backend/src/claims/submit.property.test.ts` 中添加
    - 使用 fast-check 生成随机申请记录 + 随机状态筛选值，验证筛选结果正确
    - **验证: 需求 2.2**

- [x] 3. 检查点 - 积分申请提交模块验证
  - 运行 `packages/backend/src/claims/submit.test.ts` 和属性测试，确保 submitClaim 和 listMyClaims 逻辑正确。如有问题请向用户确认。

- [x] 4. 后端审批模块
  - [x] 4.1 实现审批积分申请 reviewClaim
    - 创建 `packages/backend/src/claims/review.ts`
    - 实现 `reviewClaim(input, dynamoClient, tables)` 函数
    - 先 GetCommand 获取申请记录，不存在返回 CLAIM_NOT_FOUND
    - 申请状态非 pending 返回 CLAIM_ALREADY_REVIEWED
    - approve 时：校验 awardedPoints（1~10000），使用 TransactWriteItems 原子写入（更新申请状态 + 增加用户积分 + 写积分记录）
    - reject 时：校验 rejectReason（1~500），UpdateCommand 更新申请状态和驳回原因
    - _需求: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 实现管理端查看所有申请 listAllClaims
    - 在 `packages/backend/src/claims/review.ts` 中实现 `listAllClaims(options, dynamoClient, claimsTable)` 函数
    - 当 status 参数存在时，使用 GSI `status-createdAt-index` 查询，ScanIndexForward=false
    - 当 status 参数不存在时，使用 Scan + 按 createdAt 倒序排列
    - pageSize 默认 20，最大 100，支持 lastKey 分页游标
    - _需求: 3.9, 3.10, 3.11_

  - [x] 4.3 编写 reviewClaim 和 listAllClaims 单元测试
    - 创建 `packages/backend/src/claims/review.test.ts`
    - 测试批准成功（积分发放）、驳回成功、重复审批被拒绝、积分数值范围、驳回原因长度、申请不存在
    - _需求: 3.3~3.11, 4.1~4.4_

  - [ ]* 4.4 编写审批批准积分发放原子性属性测试
    - **Property 5: 审批批准积分发放原子性**
    - 创建 `packages/backend/src/claims/review.property.test.ts`
    - 使用 fast-check 生成随机 pending 申请 + 随机积分值，验证批准后状态、积分余额、积分记录均正确
    - **验证: 需求 3.3, 4.1, 4.2**

  - [ ]* 4.5 编写审批驳回不影响积分属性测试
    - **Property 6: 审批驳回不影响积分**
    - 在 `packages/backend/src/claims/review.property.test.ts` 中添加
    - 使用 fast-check 生成随机 pending 申请，验证驳回后积分不变
    - **验证: 需求 3.5, 4.4**

  - [ ]* 4.6 编写已审批申请不可重复审批属性测试
    - **Property 7: 已审批申请不可重复审批**
    - 在 `packages/backend/src/claims/review.property.test.ts` 中添加
    - 使用 fast-check 生成随机 approved/rejected 申请，验证再次审批被拒绝
    - **验证: 需求 3.7**

  - [ ]* 4.7 编写积分数值范围校验属性测试
    - **Property 8: 积分数值范围校验**
    - 在 `packages/backend/src/claims/review.property.test.ts` 中添加
    - 使用 fast-check 生成随机非法积分值，验证批准操作被拒绝
    - **验证: 需求 3.4**

- [x] 5. 检查点 - 审批模块验证
  - 运行 `packages/backend/src/claims/review.test.ts` 和属性测试，确保 reviewClaim 和 listAllClaims 逻辑正确。如有问题请向用户确认。

- [x] 6. Handler 路由扩展
  - [x] 6.1 在 Points Handler 中添加积分申请路由
    - 在 `packages/backend/src/points/handler.ts` 中：
      - 新增环境变量 `CLAIMS_TABLE`
      - 添加 `POST /api/claims` 路由，解析 body，调用 `submitClaim`，传递 `event.user.userId`、`event.user.roles`、`event.user.nickname`
      - 添加 `GET /api/claims` 路由，解析 `status`、`pageSize`、`lastKey` 查询参数，调用 `listMyClaims`
    - 导入 `submitClaim`、`listMyClaims` 从 `../claims/submit`
    - _需求: 1.8, 2.1~2.6_

  - [x] 6.2 在 Admin Handler 中添加审批路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量 `CLAIMS_TABLE`（POINTS_RECORDS_TABLE 已存在则复用）
      - 新增路由正则 `CLAIMS_REVIEW_REGEX = /^\/api\/admin\/claims\/([^/]+)\/review$/`
      - 添加 `GET /api/admin/claims` 路由，解析 `status`、`pageSize`、`lastKey` 查询参数，调用 `listAllClaims`
      - 添加 `PATCH /api/admin/claims/{id}/review` 路由，解析 body 中的 `action`、`awardedPoints`、`rejectReason`，调用 `reviewClaim`
    - 导入 `reviewClaim`、`listAllClaims` 从 `../claims/review`（注意：claims 模块在 backend/src/claims/ 下，admin handler 通过相对路径引用）
    - _需求: 3.1~3.11_

  - [x] 6.3 编写 Handler 路由单元测试
    - 更新 `packages/backend/src/points/handler.test.ts`，添加 POST /api/claims 和 GET /api/claims 路由测试
    - 更新 `packages/backend/src/admin/handler.test.ts`，添加 GET /api/admin/claims 和 PATCH /api/admin/claims/{id}/review 路由测试
    - _需求: 1.8, 2.1, 3.1, 3.8, 3.9_

- [x] 7. 检查点 - Handler 路由验证
  - 运行 Points Handler 和 Admin Handler 相关测试，确保新增路由分发正确。如有问题请向用户确认。

- [x] 8. CDK 配置
  - [x] 8.1 在 DatabaseStack 中新增 Claims 表
    - 在 `packages/cdk/lib/database-stack.ts` 中：
      - 新增 `claimsTable` 属性（public readonly）
      - 定义 Claims 表（PK: claimId），On-Demand 计费
      - 创建 GSI `userId-createdAt-index`（PK: userId, SK: createdAt）
      - 创建 GSI `status-createdAt-index`（PK: status, SK: createdAt）
      - 添加 CfnOutput
    - _需求: 7.5_

  - [x] 8.2 在 ApiStack 中注册路由和权限
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 在 ApiStackProps 中新增 `claimsTable` 属性
      - 为 Points Lambda 添加 `CLAIMS_TABLE` 环境变量和 Claims 表读写权限
      - 为 Admin Lambda 添加 `CLAIMS_TABLE` 环境变量和 Claims 表读写权限，以及 `POINTS_RECORDS_TABLE` 环境变量（如尚未配置）
      - 注册用户端路由：`POST /api/claims`、`GET /api/claims`（集成到 Points Lambda）
      - 注册管理端路由：`GET /api/admin/claims`、`PATCH /api/admin/claims/{id}/review`（集成到 Admin Lambda）
    - 在 `packages/cdk/bin/app.ts` 中将 claimsTable 传递给 ApiStack
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.6_

- [x] 9. 检查点 - CDK 编译验证
  - 确保 CDK 代码编译通过，新增表和路由定义正确。如有问题请向用户确认。

- [x] 10. 前端积分申请页面
  - [x] 10.1 创建积分申请页面
    - 创建 `packages/frontend/src/pages/claims/index.tsx` 和 `packages/frontend/src/pages/claims/index.scss`
    - 页面结构：
      - 顶部工具栏：返回按钮 + 标题"积分申请" + 新建申请按钮
      - 状态筛选标签栏：全部 | 待审批 | 已批准 | 已驳回
      - 申请历史列表：每行显示标题、状态标签（pending/approved/rejected）、提交时间
      - 点击申请记录展示详情弹窗：完整描述、图片预览、活动链接、审批结果
      - 新建申请弹窗（form-overlay/form-modal 模式）：标题输入、描述输入、图片 URL 输入（最多 5 个）、活动链接输入
      - 下拉加载更多
    - API 调用：POST /api/claims（提交）、GET /api/claims（列表）
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 5.1~5.7_

  - [x] 10.2 在 Taro 路由配置中注册积分申请页面
    - 在 `packages/frontend/src/app.config.ts` 中添加 `pages/claims/index` 路由
    - 在个人中心页面（profile）中添加"积分申请"快捷入口
    - _需求: 5.1_

- [x] 11. 前端审批管理页面
  - [x] 11.1 创建审批管理页面
    - 创建 `packages/frontend/src/pages/admin/claims.tsx` 和 `packages/frontend/src/pages/admin/claims.scss`
    - 页面结构：
      - 顶部工具栏：返回按钮 + 标题"积分审批"
      - 状态筛选标签栏：全部 | 待审批 | 已批准 | 已驳回（默认待审批）
      - 申请列表：每行显示申请人昵称、角色徽章（全局 .role-badge）、标题、状态标签、提交时间
      - 点击记录展示详情弹窗：申请人信息、完整描述、图片预览、活动链接
      - 批准弹窗：积分数值输入（1~10000）
      - 驳回弹窗：驳回原因输入（1~500 字符）
      - 操作成功后刷新列表并显示提示
      - 下拉加载更多
    - API 调用：GET /api/admin/claims（列表）、PATCH /api/admin/claims/{id}/review（审批）
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 6.1~6.9_

  - [x] 11.2 在管理后台入口和 Taro 路由中注册审批页面
    - 在 `packages/frontend/src/app.config.ts` 中添加 `pages/admin/claims` 路由
    - 在管理后台首页中添加"积分审批"入口
    - _需求: 6.1_

- [x] 12. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 新增 DynamoDB Claims 表，不影响现有表结构
- 用户端路由复用 Points Lambda，管理端路由复用 Admin Lambda
- 审批批准时使用 TransactWriteItems 保证积分发放原子性
- 申请记录冗余存储 applicantNickname 和 applicantRole，避免额外查询 Users 表
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选属性测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
