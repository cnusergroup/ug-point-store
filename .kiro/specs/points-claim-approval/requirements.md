# 需求文档：积分申请与审批流程

## 简介

社区成员（Speaker、UserGroupLeader、CommunityBuilder、Volunteer）通过提交贡献证明（活动海报图片、直播 URL、文字描述）来申请积分奖励。管理员（Admin、SuperAdmin）审核申请内容后，决定批准或驳回，并在批准时设置奖励积分数值。批准后积分自动计入用户余额。

## 术语表

- **Claim（积分申请）**：用户提交的一条积分申请记录，包含贡献证明材料
- **Applicant（申请人）**：提交积分申请的社区成员用户
- **Reviewer（审批人）**：拥有审批权限的管理员（Admin 或 SuperAdmin）
- **Evidence（证明材料）**：申请人提交的贡献证明，包括图片 URL、直播链接或文字描述
- **ClaimStatus（申请状态）**：积分申请的当前状态，取值为 pending（待审批）、approved（已批准）、rejected（已驳回）
- **Claims_Service（积分申请服务）**：处理积分申请提交与查询的后端服务
- **Review_Service（审批服务）**：处理积分申请审批操作的后端服务
- **Claims_Page（积分申请页面）**：用户提交积分申请的前端页面
- **Review_Page（审批管理页面）**：管理员审批积分申请的前端页面

## 需求

### 需求 1：提交积分申请

**用户故事：** 作为社区成员，我希望提交贡献证明来申请积分奖励，以便我的社区贡献能够得到认可和回报。

#### 验收标准

1. WHEN Applicant 提交积分申请, THE Claims_Service SHALL 验证 Applicant 拥有以下角色之一：Speaker、UserGroupLeader、CommunityBuilder、Volunteer
2. IF Applicant 不拥有任何允许的角色, THEN THE Claims_Service SHALL 返回错误码 CLAIM_ROLE_NOT_ALLOWED 和消息"当前角色无法申请积分"
3. WHEN Applicant 提交积分申请, THE Claims_Service SHALL 要求请求体包含以下字段：title（申请标题，1~100 字符）和 description（文字描述，1~1000 字符）
4. IF title 或 description 为空或超出长度限制, THEN THE Claims_Service SHALL 返回错误码 INVALID_CLAIM_CONTENT 和消息"申请内容格式无效"
5. WHEN Applicant 提交积分申请, THE Claims_Service SHALL 允许请求体包含可选字段：imageUrls（图片 URL 数组，最多 5 张）和 activityUrl（活动或直播链接，合法 URL 格式）
6. IF imageUrls 数组长度超过 5, THEN THE Claims_Service SHALL 返回错误码 CLAIM_IMAGE_LIMIT_EXCEEDED 和消息"图片数量超出上限（最多 5 张）"
7. IF activityUrl 不是合法的 URL 格式, THEN THE Claims_Service SHALL 返回错误码 INVALID_ACTIVITY_URL 和消息"活动链接格式无效"
8. WHEN 积分申请提交成功, THE Claims_Service SHALL 生成唯一 claimId，将申请状态设为 pending，记录申请人 userId、角色、提交时间，并返回创建的申请记录

### 需求 2：查看我的积分申请

**用户故事：** 作为社区成员，我希望查看自己提交的积分申请历史和审批状态，以便了解申请进度和结果。

#### 验收标准

1. WHEN Applicant 请求查看积分申请列表, THE Claims_Service SHALL 仅返回该 Applicant 自身提交的申请记录
2. WHEN Applicant 提供 status 查询参数（pending、approved、rejected）, THE Claims_Service SHALL 仅返回匹配该状态的申请记录
3. WHEN Applicant 未提供 status 查询参数, THE Claims_Service SHALL 返回该 Applicant 的所有申请记录
4. THE Claims_Service SHALL 按提交时间倒序排列返回的申请记录
5. THE Claims_Service SHALL 支持分页查询，默认每页 20 条，最大 100 条，并在存在更多记录时返回分页游标 lastKey
6. THE Claims_Service SHALL 在每条申请记录中返回以下字段：claimId、title、description、imageUrls、activityUrl、status、createdAt、reviewedAt（如已审批）、awardedPoints（如已批准）、rejectReason（如已驳回）

### 需求 3：审批积分申请

**用户故事：** 作为管理员，我希望审核社区成员提交的积分申请，以便根据贡献内容决定是否批准并设置奖励积分数值。

#### 验收标准

1. WHEN Reviewer 请求审批积分申请, THE Review_Service SHALL 验证 Reviewer 拥有 Admin 或 SuperAdmin 角色
2. IF Reviewer 不拥有 Admin 或 SuperAdmin 角色, THEN THE Review_Service SHALL 返回错误码 FORBIDDEN 和消息"需要管理员权限"
3. WHEN Reviewer 批准积分申请, THE Review_Service SHALL 要求请求体包含 action 值为 "approve" 和 awardedPoints 字段（正整数，1~10000）
4. IF awardedPoints 不是 1~10000 范围内的正整数, THEN THE Review_Service SHALL 返回错误码 INVALID_POINTS_AMOUNT 和消息"积分数值无效（1~10000）"
5. WHEN Reviewer 驳回积分申请, THE Review_Service SHALL 要求请求体包含 action 值为 "reject" 和 rejectReason 字段（1~500 字符）
6. IF rejectReason 为空或超出长度限制, THEN THE Review_Service SHALL 返回错误码 INVALID_REJECT_REASON 和消息"驳回原因格式无效"
7. IF 目标申请的状态不是 pending, THEN THE Review_Service SHALL 返回错误码 CLAIM_ALREADY_REVIEWED 和消息"该申请已被审批"
8. WHEN 审批操作成功, THE Review_Service SHALL 更新申请状态为 approved 或 rejected，记录审批人 userId、审批时间，并返回更新后的申请记录
9. WHEN Reviewer 请求查看待审批列表, THE Review_Service SHALL 返回所有用户的积分申请记录，支持按 status 筛选
10. THE Review_Service SHALL 支持分页查询待审批列表，默认每页 20 条，最大 100 条，按提交时间倒序排列
11. THE Review_Service SHALL 在待审批列表的每条记录中返回申请人 nickname、角色、申请内容和提交时间

### 需求 4：积分发放

**用户故事：** 作为系统，我希望在积分申请被批准时自动将积分计入用户余额，以便用户能够及时使用获得的积分。

#### 验收标准

1. WHEN 积分申请被批准, THE Review_Service SHALL 使用 DynamoDB 事务原子性地完成以下操作：更新申请状态为 approved、增加申请人积分余额、写入积分变动记录
2. THE Review_Service SHALL 在积分变动记录中记录来源为"积分申请审批"，包含 claimId 信息
3. IF 事务执行失败, THEN THE Review_Service SHALL 返回错误码 INTERNAL_ERROR 和消息"审批操作失败，请重试"，且申请状态和用户积分均保持不变
4. WHEN 积分申请被驳回, THE Review_Service SHALL 仅更新申请状态为 rejected，记录驳回原因，不变更用户积分余额

### 需求 5：积分申请页面

**用户故事：** 作为社区成员，我希望有一个专门的页面来提交积分申请和查看申请历史，以便方便地管理我的积分申请。

#### 验收标准

1. THE Claims_Page SHALL 提供积分申请提交表单，包含标题输入框、文字描述输入框、图片上传区域（最多 5 张）和活动链接输入框
2. WHEN Applicant 填写表单并提交, THE Claims_Page SHALL 调用 POST /api/claims 接口提交申请，并在成功后显示提交成功提示
3. IF 提交失败, THEN THE Claims_Page SHALL 显示具体错误信息
4. THE Claims_Page SHALL 在表单下方展示当前用户的申请历史列表，每条记录显示标题、状态标签、提交时间
5. THE Claims_Page SHALL 提供状态筛选标签栏（全部、待审批、已批准、已驳回），点击后筛选对应状态的申请记录
6. WHEN Applicant 点击某条申请记录, THE Claims_Page SHALL 展示申请详情，包含完整描述、图片预览、活动链接、审批结果（积分数值或驳回原因）
7. THE Claims_Page SHALL 支持下拉加载更多申请记录

### 需求 6：审批管理页面

**用户故事：** 作为管理员，我希望有一个专门的审批管理页面来查看和处理积分申请，以便高效地完成审批工作。

#### 验收标准

1. THE Review_Page SHALL 展示所有用户的积分申请列表，每条记录显示申请人昵称、角色徽章、申请标题、状态标签、提交时间
2. THE Review_Page SHALL 提供状态筛选标签栏（全部、待审批、已批准、已驳回），默认显示待审批
3. WHEN Reviewer 点击某条申请记录, THE Review_Page SHALL 展示申请详情，包含申请人信息、完整描述、图片预览、活动链接
4. WHEN Reviewer 审批待审批状态的申请, THE Review_Page SHALL 提供批准和驳回两个操作按钮
5. WHEN Reviewer 点击批准按钮, THE Review_Page SHALL 弹出积分设置弹窗，要求输入奖励积分数值（1~10000），确认后调用审批接口
6. WHEN Reviewer 点击驳回按钮, THE Review_Page SHALL 弹出驳回原因输入弹窗，要求输入驳回原因（1~500 字符），确认后调用审批接口
7. WHEN 审批操作成功, THE Review_Page SHALL 刷新列表并显示操作成功提示
8. IF 审批操作失败, THEN THE Review_Page SHALL 显示具体错误信息
9. THE Review_Page SHALL 支持下拉加载更多申请记录

### 需求 7：CDK 路由配置

**用户故事：** 作为开发者，我希望在 API Gateway 中注册积分申请与审批相关的路由，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE CDK_Stack SHALL 在 API Gateway 中注册以下用户端路由，集成到 Points Lambda：POST /api/claims（提交申请）、GET /api/claims（查看我的申请列表）
2. THE CDK_Stack SHALL 在 API Gateway 中注册以下管理端路由，集成到 Admin Lambda：GET /api/admin/claims（查看所有申请列表）、PATCH /api/admin/claims/{id}/review（审批申请）
3. THE CDK_Stack SHALL 为 Admin Lambda 授予 Claims 表的读写权限
4. THE CDK_Stack SHALL 为 Points Lambda 授予 Claims 表的读写权限
5. THE CDK_Stack SHALL 在 DatabaseStack 中定义 Claims 表（PK: claimId），并创建 GSI userId-createdAt-index（PK: userId, SK: createdAt）和 GSI status-createdAt-index（PK: status, SK: createdAt）
6. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求
