# 实现计划：Speaker 差旅赞助系统

## 概述

为积分商城新增差旅赞助功能。涉及共享类型扩展（TravelApplication、TravelSponsorshipSettings、TravelQuota）、共享错误码扩展、CDK 新增 TravelApplications DynamoDB 表与 API 路由、后端 travel/ 模块（settings.ts 设置管理、apply.ts 申请与配额、review.ts 审批）、Points Handler 和 Admin Handler 路由扩展、4 个前端页面（商城差旅标签、差旅申请页、我的差旅页、差旅审批页）、管理后台导航与设置集成、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增差旅赞助相关共享类型
    - 在 `packages/shared/src/types.ts` 中新增：
      - `TravelCategory` 类型：`'domestic' | 'international'`
      - `CommunityRole` 类型：`'Hero' | 'CommunityBuilder' | 'UGL'`
      - `TravelApplicationStatus` 类型：`'pending' | 'approved' | 'rejected'`
      - `TravelApplication` 接口：applicationId、userId、applicantNickname、category、communityRole、eventLink、cfpScreenshotUrl、flightCost、hotelCost、totalCost、status、earnDeducted、rejectReason?、reviewerId?、reviewerNickname?、reviewedAt?、createdAt、updatedAt
      - `TravelSponsorshipSettings` 接口：travelSponsorshipEnabled、domesticThreshold、internationalThreshold
      - `TravelQuota` 接口：earnTotal、travelEarnUsed、domesticAvailable、internationalAvailable、domesticThreshold、internationalThreshold
    - _需求: 4.9, 3.4, 设计文档 Shared Types_

  - [x] 1.2 新增差旅赞助相关错误码
    - 在 `packages/shared/src/errors.ts` 中新增：
      - `INSUFFICIENT_EARN_QUOTA`（400）— 累计获得积分不足，无法申请差旅赞助
      - `APPLICATION_NOT_FOUND`（404）— 差旅申请不存在
      - `APPLICATION_ALREADY_REVIEWED`（400）— 该申请已被审批
      - `INVALID_APPLICATION_STATUS`（400）— 仅被驳回的申请可以编辑重新提交
      - `TRAVEL_SPEAKER_ONLY`（403）— 仅 Speaker 角色可访问差旅赞助
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 映射中添加对应条目
    - _需求: 4.7, 5.5, 7.3, 3.5, 设计文档 Error Handling_

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 TravelApplications DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `TravelApplications` 表：PK=`applicationId`（String），PAY_PER_REQUEST 计费
      - GSI `userId-createdAt-index`：PK=`userId`（String），SK=`createdAt`（String）— 用于查询用户自己的申请
      - GSI `status-createdAt-index`：PK=`status`（String），SK=`createdAt`（String）— 用于管理端按状态筛选
    - 导出表的公共属性，添加 CfnOutput
    - _需求: 14.4_

  - [x] 2.2 更新 ApiStack 添加 TravelApplications 表集成
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `travelApplicationsTable` 属性
      - 为 Points Lambda 添加 `TRAVEL_APPLICATIONS_TABLE` 环境变量 + 读写权限
      - 为 Admin Lambda 添加 `TRAVEL_APPLICATIONS_TABLE` 环境变量（已有 PointsMall-* 通配符权限自动覆盖）
    - 更新 `packages/cdk/bin/app.ts` 传递 travelApplicationsTable 引用给 ApiStack
    - _需求: 14.5, 14.6_

  - [x] 2.3 新增 API Gateway 用户端路由
    - 在 `packages/cdk/lib/api-stack.ts` 中注册用户端路由（集成到 Points Lambda）：
      - GET `/api/travel/quota` — 查询差旅配额
      - POST `/api/travel/apply` — 提交差旅申请
      - GET `/api/travel/my-applications` — 查看我的申请
      - PUT `/api/travel/applications/{id}` — 编辑重新提交申请
      - GET `/api/settings/travel-sponsorship` — 查询差旅设置（公开，无需认证）
    - 所有路由自动继承 CORS 预检配置
    - _需求: 14.1, 14.3, 14.7_

  - [x] 2.4 确认管理端路由通过 Admin Lambda proxy 自动捕获
    - 管理端路由通过 Admin Lambda 的 `{proxy+}` 代理模式自动捕获，无需额外注册：
      - GET `/api/admin/travel/applications` — 查看所有申请
      - PATCH `/api/admin/travel/{id}/review` — 审批申请
      - PUT `/api/admin/settings/travel-sponsorship` — 更新差旅设置
    - 验证 Admin Lambda 已有 `PointsMall-*` 通配符权限覆盖新表
    - _需求: 14.2_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型和错误码编译通过、CDK 代码编译通过，新增表和路由定义正确。如有问题请向用户确认。

- [x] 4. 后端差旅设置模块
  - [x] 4.1 实现差旅设置核心逻辑
    - 创建 `packages/backend/src/travel/settings.ts`
    - 实现 `validateTravelSettingsInput(body)` 函数：
      - 校验 travelSponsorshipEnabled 为布尔值
      - 校验 domesticThreshold 为正整数 ≥ 1
      - 校验 internationalThreshold 为正整数 ≥ 1
      - 无效时返回 `{ valid: false, error: { code: 'INVALID_REQUEST', message: '具体错误' } }`
    - 实现 `getTravelSettings(dynamoClient, usersTable)` 函数：
      - GetCommand 读取 Users 表 `userId = "travel-sponsorship"` 记录
      - 记录不存在时返回默认值 `{ travelSponsorshipEnabled: false, domesticThreshold: 0, internationalThreshold: 0 }`
    - 实现 `updateTravelSettings(input, dynamoClient, usersTable)` 函数：
      - PutCommand 写入 Users 表 `userId = "travel-sponsorship"` 记录
      - 包含 updatedAt 和 updatedBy 字段
      - 返回更新后的设置
    - _需求: 1.1~1.8, 2.1~2.3_

  - [x] 4.2 编写差旅设置单元测试
    - 创建 `packages/backend/src/travel/settings.test.ts`
    - 测试场景：
      - `getTravelSettings` — 记录存在时返回正确值，记录不存在时返回默认值
      - `updateTravelSettings` — 有效输入写入成功
      - `validateTravelSettingsInput` — 各种有效/无效输入的边界测试（布尔值、正整数、缺少字段、类型错误）
    - _需求: 1.2~1.8, 2.1~2.3_

  - [x] 4.3 编写差旅设置验证属性测试
    - **Property 1: Travel settings validation accepts valid inputs and rejects invalid inputs**
    - 创建 `packages/backend/src/travel/settings.property.test.ts`
    - 使用 fast-check 生成随机请求体，验证 validateTravelSettingsInput 对有效输入（布尔值 + 正整数 ≥ 1）返回 valid=true，对无效输入返回 valid=false 并附带错误码 INVALID_REQUEST
    - **验证: 需求 1.6, 1.7**

  - [x] 4.4 编写差旅设置读写往返属性测试
    - **Property 2: Travel settings round-trip preserves data**
    - 在 `packages/backend/src/travel/settings.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效设置输入，验证写入后读取返回相同的 travelSponsorshipEnabled、domesticThreshold、internationalThreshold 值
    - **验证: 需求 1.2, 1.8, 2.1**

- [x] 5. 后端差旅申请核心模块
  - [x] 5.1 实现配额计算与申请验证逻辑
    - 创建 `packages/backend/src/travel/apply.ts`
    - 实现 `calculateAvailableCount(earnTotal, travelEarnUsed, threshold)` 函数：
      - threshold > 0 且 earnTotal >= travelEarnUsed 时返回 `floor((earnTotal - travelEarnUsed) / threshold)`
      - threshold === 0 时返回 0
      - travelEarnUsed > earnTotal 时返回 0
    - 实现 `validateTravelApplicationInput(body)` 函数：
      - 校验 category 为 "domestic" 或 "international"
      - 校验 communityRole 为 "Hero"、"CommunityBuilder" 或 "UGL"
      - 校验 eventLink 为合法 URL
      - 校验 cfpScreenshotUrl 为非空字符串
      - 校验 flightCost 和 hotelCost 为非负数
    - 实现 `getTravelQuota(userId, dynamoClient, tables)` 函数：
      - 查询 PointsRecords 表中该用户所有 type="earn" 的记录求和 amount 得到 earnTotal
      - 读取用户记录的 travelEarnUsed（默认 0）
      - 读取差旅设置获取 threshold
      - 计算并返回 TravelQuota
    - _需求: 3.1~3.5, 4.4, 4.5_

  - [x] 5.2 实现提交差旅申请逻辑
    - 在 `packages/backend/src/travel/apply.ts` 中实现 `submitTravelApplication(input, dynamoClient, tables)` 函数：
      - 验证功能开关 travelSponsorshipEnabled
      - 计算 earnTotal 和可用差旅次数
      - 可用次数 < 1 时返回 INSUFFICIENT_EARN_QUOTA 错误
      - 使用 TransactWriteCommand 原子性地：创建 TravelApplication 记录（ULID 作为 applicationId，状态 pending）+ 将用户 travelEarnUsed 增加对应 threshold（ConditionExpression 确保 earnTotal - travelEarnUsed >= threshold）
      - totalCost = flightCost + hotelCost
      - 返回创建的申请记录
    - _需求: 4.1~4.10, 15.2, 15.5_

  - [x] 5.3 实现查看我的差旅申请逻辑
    - 在 `packages/backend/src/travel/apply.ts` 中实现 `listMyTravelApplications(options, dynamoClient, table)` 函数：
      - 使用 GSI `userId-createdAt-index` 查询（ScanIndexForward=false 实现时间倒序）
      - 支持 status 筛选参数
      - pageSize 默认 20，钳制到 [1, 100] 范围
      - 支持 lastKey 分页游标
    - _需求: 6.1~6.5_

  - [x] 5.4 实现编辑重新提交差旅申请逻辑
    - 在 `packages/backend/src/travel/apply.ts` 中实现 `resubmitTravelApplication(input, dynamoClient, tables)` 函数：
      - 验证申请属于当前用户且状态为 rejected
      - 重新校验所有字段
      - 计算配额：rejected 状态的申请配额已在驳回时归还，重新提交时预扣新 category 的 threshold
      - 使用 TransactWriteCommand 原子性地：更新申请记录（字段内容、状态改为 pending、更新 earnDeducted、清除 rejectReason 和审批信息）+ 更新用户 travelEarnUsed
    - _需求: 7.1~7.9_

  - [x] 5.5 编写差旅申请单元测试
    - 创建 `packages/backend/src/travel/apply.test.ts`
    - 测试场景：
      - `calculateAvailableCount` — 各种 earnTotal/travelEarnUsed/threshold 组合（含 threshold=0、travelEarnUsed > earnTotal）
      - `validateTravelApplicationInput` — 有效/无效输入（category、communityRole、URL 格式、非负数）
      - `getTravelQuota` — 正确计算 earnTotal 和可用次数
      - `submitTravelApplication` — 成功提交、配额不足、功能关闭
      - `listMyTravelApplications` — 分页、状态筛选、排序
      - `resubmitTravelApplication` — 成功重新提交、状态校验、配额重算（同 category / 不同 category）
    - _需求: 3.1~3.5, 4.1~4.10, 6.1~6.5, 7.1~7.9_

  - [x] 5.6 编写配额计算正确性属性测试
    - **Property 3: Quota calculation correctness**
    - 创建 `packages/backend/src/travel/apply.property.test.ts`
    - 使用 fast-check 生成随机非负整数 earnTotal、travelEarnUsed、threshold，验证 calculateAvailableCount 返回值符合公式：threshold > 0 且 earnTotal >= travelEarnUsed 时为 floor((earnTotal - travelEarnUsed) / threshold)，threshold === 0 时为 0，travelEarnUsed > earnTotal 时为 0
    - **验证: 需求 3.1, 3.3, 3.4**

  - [x] 5.7 编写差旅申请验证属性测试
    - **Property 4: Travel application validation accepts valid inputs and rejects invalid inputs**
    - 在 `packages/backend/src/travel/apply.property.test.ts` 中添加
    - 使用 fast-check 生成随机请求体，验证 validateTravelApplicationInput 对有效输入返回 valid=true，对无效输入返回 valid=false 并附带错误码 INVALID_REQUEST
    - **验证: 需求 4.4, 4.5, 7.4**

  - [x] 5.8 编写提交申请记录创建和配额预扣属性测试
    - **Property 5: Submission creates application record and deducts quota atomically**
    - 在 `packages/backend/src/travel/apply.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效申请输入，验证提交成功后：(a) 申请记录状态为 pending 且 earnDeducted 等于对应 threshold，(b) 用户 travelEarnUsed 增加了 threshold，(c) totalCost = flightCost + hotelCost
    - **验证: 需求 4.8, 4.9, 15.2**

  - [x] 5.9 编写分页 pageSize 范围钳制属性测试
    - **Property 10: Pagination pageSize is clamped to valid range**
    - 在 `packages/backend/src/travel/apply.property.test.ts` 中添加
    - 使用 fast-check 生成随机 pageSize 值（含 undefined、负数、超大值），验证有效 pageSize 钳制到 [1, 100]，默认 20
    - **验证: 需求 6.4, 8.6**

  - [x] 5.10 编写重新提交配额重算属性测试
    - **Property 11: Resubmission correctly recalculates quota**
    - 在 `packages/backend/src/travel/apply.property.test.ts` 中添加
    - 使用 fast-check 生成随机 rejected 申请和新 category，验证重新提交后：(a) 用户 travelEarnUsed 增加了新 threshold（因驳回时已归还），(b) 申请状态为 pending 且 earnDeducted = 新 threshold
    - **验证: 需求 7.5, 7.6, 7.8**

- [x] 6. 后端差旅审批模块
  - [x] 6.1 实现差旅审批核心逻辑
    - 创建 `packages/backend/src/travel/review.ts`
    - 实现 `reviewTravelApplication(input, dynamoClient, tables)` 函数：
      - 读取申请记录，验证状态为 pending
      - approve：UpdateCommand 更新状态为 approved，记录 reviewerId、reviewerNickname、reviewedAt，travelEarnUsed 保持不变
      - reject：TransactWriteCommand 原子性地更新状态为 rejected + 记录 rejectReason + 将用户 travelEarnUsed 减少 earnDeducted（ConditionExpression 确保不变为负数）
    - 实现 `listAllTravelApplications(options, dynamoClient, table)` 函数：
      - 使用 GSI `status-createdAt-index` 按状态筛选（默认 pending）
      - 无 status 参数时 Scan 全表
      - pageSize 默认 20，钳制到 [1, 100]
      - 按 createdAt 倒序排列
    - _需求: 5.1~5.8, 8.1~8.6, 15.3, 15.4_

  - [x] 6.2 编写差旅审批单元测试
    - 创建 `packages/backend/src/travel/review.test.ts`
    - 测试场景：
      - `reviewTravelApplication` — 批准（travelEarnUsed 不变）、驳回（travelEarnUsed 减少 earnDeducted）、重复审批返回 APPLICATION_ALREADY_REVIEWED、申请不存在返回 APPLICATION_NOT_FOUND
      - `listAllTravelApplications` — 分页、状态筛选、默认 pending、排序
    - _需求: 5.1~5.8, 8.1~8.6_

  - [x] 6.3 编写批准保持配额属性测试
    - **Property 6: Approval preserves quota**
    - 创建 `packages/backend/src/travel/review.property.test.ts`
    - 使用 fast-check 生成随机 pending 申请，验证 approve 后：申请状态为 approved，reviewerId 和 reviewedAt 已设置，用户 travelEarnUsed 不变
    - **验证: 需求 5.6**

  - [x] 6.4 编写驳回归还配额属性测试
    - **Property 7: Rejection returns quota**
    - 在 `packages/backend/src/travel/review.property.test.ts` 中添加
    - 使用 fast-check 生成随机 pending 申请（earnDeducted = D），验证 reject 后：申请状态为 rejected，用户 travelEarnUsed 减少了 D
    - **验证: 需求 5.7, 15.3**

  - [x] 6.5 编写用户隔离属性测试
    - **Property 8: User isolation in list queries**
    - 在 `packages/backend/src/travel/review.property.test.ts` 中添加
    - 使用 fast-check 生成多用户的申请集合，验证 listMyTravelApplications 仅返回指定 userId 的申请
    - **验证: 需求 6.1**

  - [x] 6.6 编写状态筛选与排序属性测试
    - **Property 9: Status filter returns only matching records in descending time order**
    - 在 `packages/backend/src/travel/review.property.test.ts` 中添加
    - 使用 fast-check 生成混合状态的申请集合，验证按状态筛选后所有返回记录状态匹配，且按 createdAt 降序排列
    - **验证: 需求 6.2, 6.3, 8.4, 8.5**

  - [x] 6.7 编写 travelEarnUsed 非负不变量属性测试
    - **Property 12: travelEarnUsed non-negative invariant**
    - 在 `packages/backend/src/travel/review.property.test.ts` 中添加
    - 使用 fast-check 生成随机提交/批准/驳回操作序列，验证用户 travelEarnUsed 始终 ≥ 0
    - **验证: 需求 15.4**

- [x] 7. 后端 Handler 路由扩展
  - [x] 7.1 在 Points Handler 中添加差旅路由
    - 在 `packages/backend/src/points/handler.ts` 中：
      - 新增环境变量读取：`TRAVEL_APPLICATIONS_TABLE`
      - 导入 travel/settings 和 travel/apply 模块
      - 新增公开路由（在 authenticatedHandler 之前）：GET `/api/settings/travel-sponsorship` → `handleGetTravelSettings`
      - 新增认证路由：
        - GET `/api/travel/quota` → `handleGetTravelQuota`（验证 Speaker 角色）
        - POST `/api/travel/apply` → `handleSubmitTravelApplication`（验证 Speaker 角色 + 功能开关）
        - GET `/api/travel/my-applications` → `handleListMyTravelApplications`（验证 Speaker 角色）
        - PUT `/api/travel/applications/{id}` → `handleResubmitTravelApplication`（验证 Speaker 角色）
      - 新增路由正则：`TRAVEL_APPLICATIONS_RESUBMIT_REGEX = /^\/api\/travel\/applications\/([^/]+)$/`
    - _需求: 2.1~2.3, 3.1~3.5, 4.1~4.10, 6.1~6.5, 7.1~7.9_

  - [x] 7.2 在 Admin Handler 中添加差旅管理路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量读取：`TRAVEL_APPLICATIONS_TABLE`
      - 导入 travel/settings 和 travel/review 模块
      - 新增路由正则：`TRAVEL_REVIEW_REGEX = /^\/api\/admin\/travel\/([^/]+)\/review$/`
      - PUT `/api/admin/settings/travel-sponsorship` 路由：验证 SuperAdmin → 调用 updateTravelSettings
      - GET `/api/admin/travel/applications` 路由：验证 SuperAdmin → 调用 listAllTravelApplications
      - PATCH `/api/admin/travel/{id}/review` 路由：验证 SuperAdmin → 获取审批人昵称 → 调用 reviewTravelApplication
    - _需求: 1.4~1.8, 5.1~5.8, 8.1~8.6_

  - [x] 7.3 编写 Handler 路由单元测试
    - 更新 `packages/backend/src/points/handler.test.ts` 和 `packages/backend/src/admin/handler.test.ts`
    - 测试新增路由分发正确性：
      - Points Handler：GET travel-sponsorship 设置（公开）、GET quota、POST apply、GET my-applications、PUT applications/{id}
      - Admin Handler：PUT settings/travel-sponsorship、GET admin/travel/applications、PATCH admin/travel/{id}/review
    - 测试权限校验：Speaker 可访问用户端、非 Speaker 被拒绝、SuperAdmin 可访问管理端
    - _需求: 1.4, 2.3, 3.5, 4.1, 5.1, 8.1_

- [x] 8. 检查点 - 后端模块验证
  - 运行所有后端差旅相关测试（settings.test.ts、apply.test.ts、review.test.ts、handler.test.ts、属性测试），确保逻辑正确。如有问题请向用户确认。

- [x] 9. 前端商城页面差旅入口
  - [x] 9.1 在商城页面新增差旅标签和卡片视图
    - 修改 `packages/frontend/src/pages/index/index.tsx` 和 `packages/frontend/src/pages/index/index.scss`
    - 页面功能：
      - 在商品类型筛选标签栏中新增"差旅"标签（travelSponsorshipEnabled 为 true 时显示，false 时隐藏）
      - 调用 GET `/api/settings/travel-sponsorship` 获取功能开关和门槛配置
      - 点击"差旅"标签时切换显示差旅赞助卡片视图，替代商品列表
      - 差旅视图显示两张卡片：国内差旅和国际差旅
      - 每张卡片显示：差旅类别名称、所需积分门槛、当前可用次数
      - 用户拥有 Speaker 角色时调用 GET `/api/travel/quota` 获取可用次数
      - 非 Speaker 用户：卡片显示锁定状态和提示"仅 Speaker 可申请"
      - Speaker 但可用次数为 0：卡片显示锁定状态和提示"累计积分不足"
      - Speaker 且可用次数 > 0：卡片显示"申请"按钮
      - 点击"申请"按钮导航到差旅申请页面，传递差旅类别参数
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 9.1~9.8_

- [x] 10. 前端差旅申请表单页面
  - [x] 10.1 创建差旅申请页面
    - 创建 `packages/frontend/src/pages/travel-apply/index.tsx` 和 `packages/frontend/src/pages/travel-apply/index.scss`
    - 页面功能：
      - 差旅类别选择（国内/国际），根据从商城页面传入的参数预选，允许用户切换
      - 社区角色选择器：Hero、CommunityBuilder、UGL 三个标签，单选
      - 活动链接输入框：要求输入合法 URL
      - CFP 接受截图上传区域：支持上传一张图片，使用与积分申请相同的图片上传流程（POST `/api/claims/upload-url`）
      - 机票费用输入框和酒店费用输入框：接受非负数输入
      - 实时显示自动计算的总费用（机票 + 酒店）
      - 提交按钮：调用 POST `/api/travel/apply` 提交申请
      - 成功后显示成功提示并导航到我的差旅申请页面
      - 失败时显示具体错误信息
      - 编辑模式：当传入 applicationId 参数时，预填原申请所有字段，提交时调用 PUT `/api/travel/applications/{applicationId}`
    - 遵循前端设计规范：CSS 变量、全局组件类
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/travel-apply/index` 路由
    - _需求: 10.1~10.10_

- [x] 11. 前端我的差旅申请页面
  - [x] 11.1 创建我的差旅申请页面
    - 创建 `packages/frontend/src/pages/my-travel/index.tsx` 和 `packages/frontend/src/pages/my-travel/index.scss`
    - 页面功能：
      - 页面顶部显示当前可用差旅次数概览（国内 X 次 / 国际 Y 次），调用 GET `/api/travel/quota`
      - 状态筛选标签栏（全部、待审批、已批准、已驳回）
      - 差旅申请列表：调用 GET `/api/travel/my-applications`
      - 每条记录显示：差旅类别标签、总费用、状态标签、提交时间
      - 点击记录展示申请详情：所有表单字段、审批结果（驳回原因）
      - rejected 状态的申请详情中显示"编辑重新提交"按钮
      - 点击"编辑重新提交"导航到差旅申请页面并传递 applicationId，进入编辑模式
      - 下拉加载更多申请记录（分页）
    - 遵循前端设计规范：CSS 变量、全局组件类
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/my-travel/index` 路由
    - 在个人中心页面 `packages/frontend/src/pages/profile/index.tsx` 的快捷入口中添加"我的差旅"入口（仅 Speaker 可见）
    - _需求: 11.1~11.7_

- [x] 12. 前端差旅审批管理页面
  - [x] 12.1 创建差旅审批管理页面
    - 创建 `packages/frontend/src/pages/admin/travel.tsx` 和 `packages/frontend/src/pages/admin/travel.scss`
    - 页面功能：
      - 状态筛选标签栏（全部、待审批、已批准、已驳回），默认显示待审批
      - 差旅申请列表：调用 GET `/api/admin/travel/applications`
      - 每条记录显示：申请人昵称、差旅类别标签、总费用、状态标签、提交时间
      - 点击记录展示申请详情：申请人信息、社区角色、活动链接、CFP 截图预览、费用明细
      - 待审批状态的申请提供批准和驳回两个操作按钮
      - 批准按钮：弹出确认弹窗，确认后调用 PATCH `/api/admin/travel/{id}/review` (action: "approve")
      - 驳回按钮：弹出驳回原因输入弹窗（可选填写，1~500 字符），确认后调用审批接口 (action: "reject")
      - 审批成功后刷新列表并显示操作成功提示
      - 审批失败时显示具体错误信息
      - 下拉加载更多申请记录（分页）
    - 遵循前端设计规范：CSS 变量、全局组件类
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/travel` 路由
    - _需求: 12.1~12.9_

- [x] 13. 管理后台导航与设置集成
  - [x] 13.1 在管理后台首页添加差旅审批导航入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 的 `ADMIN_LINKS` 数组中新增：
      - "差旅审批"卡片：key='travel'，url='/pages/admin/travel'，superAdminOnly=true
    - 为卡片选择合适的图标组件
    - _需求: 13.1, 13.3_

  - [x] 13.2 在设置页面新增差旅赞助配置区域
    - 修改 `packages/frontend/src/pages/admin/settings.tsx`
    - 新增差旅赞助配置区域：
      - 功能开关（Switch 控件）：travelSponsorshipEnabled
      - 国内差旅积分门槛输入框：domesticThreshold（正整数）
      - 国际差旅积分门槛输入框：internationalThreshold（正整数）
      - 页面加载时调用 GET `/api/settings/travel-sponsorship` 获取当前配置
      - 切换开关或修改门槛后调用 PUT `/api/admin/settings/travel-sponsorship` 提交更新
      - 更新成功显示操作成功提示
      - 更新失败显示错误信息并将控件恢复到更新前的状态
    - _需求: 13.2, 13.4~13.6_

- [x] 14. 检查点 - 前端页面验证
  - 确保所有前端页面编译通过，路由注册正确，管理后台导航入口和设置页面集成正确。如有问题请向用户确认。

- [x] 15. i18n 多语言翻译
  - [x] 15.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增 `travel` 模块：
      - `mall`：差旅标签页文案（标签名、卡片标题、门槛标签、可用次数、锁定提示、申请按钮）
      - `apply`：申请表单文案（页面标题、类别选择、角色选择、输入框标签与占位符、上传提示、费用标签、总费用、提交按钮、成功提示、错误提示、编辑模式标题）
      - `myTravel`：我的差旅页面文案（页面标题、配额概览、筛选标签、列表字段、详情标签、编辑重新提交按钮、空状态、加载更多）
      - `review`：差旅审批页面文案（页面标题、筛选标签、列表字段、详情标签、批准按钮、驳回按钮、确认弹窗、驳回原因输入、成功提示、错误提示）
      - `status`：状态标签文案（pending、approved、rejected）
      - `category`：类别标签文案（domestic、international）
    - 在 `admin.dashboard` 中新增 `travelTitle`、`travelDesc` 键
    - 在 `admin.settings` 中新增差旅赞助设置相关键
    - _需求: 16.1, 16.4_

  - [x] 15.2 添加 5 种语言翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加 `travel` 模块简体中文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加 `travel` 模块繁体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加 `travel` 模块英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加 `travel` 模块日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加 `travel` 模块韩文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 16.2_

  - [x] 15.3 在前端页面中使用 i18n
    - 在所有差旅相关前端页面中：
      - 导入 `useTranslation`，调用 `const { t } = useTranslation()`
      - 将所有硬编码文案替换为 `t('travel.xxx.xxx')` 调用
      - 管理后台导航卡片使用 `t('admin.dashboard.travelTitle')` 等
      - 设置页面使用 `t('admin.settings.xxx')` 等
    - _需求: 16.1, 16.3_

- [x] 16. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 本次新增 1 张 DynamoDB 表（TravelApplications）和 5 条 API Gateway 用户端路由 + 3 条管理端路由（通过 proxy 自动捕获）
- DynamoDB 事务保证提交申请（创建记录 + 预扣配额）和驳回申请（更新状态 + 归还配额）的原子性
- 差旅设置复用 Users 表，使用 `userId = "travel-sponsorship"` 作为分区键，与 feature-toggles 模式一致
- 属性测试验证设计文档中定义的 12 个正确性属性
- 配额预扣机制：申请提交时预扣 earn 配额，驳回时归还，批准时保持不变
- travelEarnUsed 使用 DynamoDB ConditionExpression 确保不会变为负数
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
