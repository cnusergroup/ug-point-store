# 需求文档：Speaker 差旅赞助系统

## 简介

在社区积分商城中新增差旅赞助功能。拥有 Speaker 角色的用户可以根据历史累计获得积分（earnTotal）申请国内差旅或国际差旅赞助。SuperAdmin 在设置页面配置各类差旅的积分门槛和功能开关，并审批差旅申请。差旅赞助不消耗用户积分余额，仅基于 earnTotal 计算可用差旅次数，申请提交时预扣 earn 配额，驳回时归还配额。

## 术语表

- **Travel_Sponsorship（差旅赞助）**：Speaker 用户基于累计获得积分申请的差旅费用赞助
- **Travel_Category（差旅类别）**：差旅赞助的分类，取值为 domestic（国内差旅）或 international（国际差旅）
- **Earn_Total（累计获得积分）**：用户历史上所有 type 为 earn 的 PointsRecord 的 amount 总和
- **Travel_Threshold（差旅门槛）**：SuperAdmin 为每种差旅类别设置的积分门槛值，用于计算可用差旅次数
- **Travel_Earn_Used（差旅已用配额）**：用户已用于差旅申请（含 pending 和 approved 状态）的累计 earn 配额
- **Available_Travel_Count（可用差旅次数）**：floor((earnTotal - travelEarnUsed) / threshold)，表示用户当前可申请的差旅次数
- **Travel_Application（差旅申请）**：Speaker 提交的一条差旅赞助申请记录
- **Applicant（申请人）**：提交差旅申请的 Speaker 用户
- **Community_Role（社区角色选项）**：申请表单中的角色选择，取值为 Hero、CommunityBuilder、UGL，与系统角色无关，仅作为表单信息
- **Travel_Application_Service（差旅申请服务）**：处理差旅申请提交、查询、审批的后端服务
- **Travel_Settings_Service（差旅设置服务）**：处理差旅赞助配置读取和更新的后端服务
- **Mall_Page（商城页面）**：积分商城首页，展示商品列表和差旅赞助入口
- **Travel_Application_Page（差旅申请页面）**：Speaker 填写并提交差旅申请的前端页面
- **My_Travel_Page（我的差旅页面）**：Speaker 查看差旅申请历史和状态的前端页面
- **Travel_Review_Page（差旅审批页面）**：SuperAdmin 审批差旅申请的前端页面
- **Settings_Page（设置页面）**：SuperAdmin 配置差旅赞助参数的前端页面

## 需求

### 需求 1：差旅赞助设置配置

**用户故事：** 作为 SuperAdmin，我希望配置差旅赞助的积分门槛和功能开关，以便灵活控制差旅赞助功能的可用性和申请条件。

#### 验收标准

1. THE Travel_Settings_Service SHALL 使用 DynamoDB 存储差旅赞助配置，使用固定分区键 settingKey 值为 "travel-sponsorship" 的单条记录，存储在现有 Users 表中
2. THE Settings_Record SHALL 包含以下字段：settingKey（分区键）、travelSponsorshipEnabled（布尔值，功能总开关）、domesticThreshold（正整数，国内差旅积分门槛）、internationalThreshold（正整数，国际差旅积分门槛）、updatedAt（ISO 8601 时间戳）、updatedBy（操作人 userId）
3. WHEN Settings_Record 不存在时, THE Travel_Settings_Service SHALL 将 travelSponsorshipEnabled 视为 false，domesticThreshold 视为 0，internationalThreshold 视为 0
4. WHEN SuperAdmin 请求 PUT /api/admin/settings/travel-sponsorship, THE Travel_Settings_Service SHALL 验证请求者拥有 SuperAdmin 角色
5. IF 请求者不拥有 SuperAdmin 角色, THEN THE Travel_Settings_Service SHALL 返回 403 错误码 FORBIDDEN 和消息"需要超级管理员权限"
6. WHEN SuperAdmin 提交更新请求, THE Travel_Settings_Service SHALL 要求请求体包含 travelSponsorshipEnabled（布尔值）、domesticThreshold（正整数，最小值 1）、internationalThreshold（正整数，最小值 1）
7. IF 请求体缺少必填字段或字段格式无效, THEN THE Travel_Settings_Service SHALL 返回 400 错误码 INVALID_REQUEST 和具体错误消息
8. WHEN 更新成功, THE Travel_Settings_Service SHALL 写入 Settings_Record 并返回更新后的设置

### 需求 2：查询差旅赞助设置（公开接口）

**用户故事：** 作为前端应用，我希望获取当前差旅赞助配置，以便根据设置动态调整页面显示。

#### 验收标准

1. WHEN 任意客户端请求 GET /api/settings/travel-sponsorship, THE Travel_Settings_Service SHALL 返回当前差旅赞助配置，包含 travelSponsorshipEnabled、domesticThreshold、internationalThreshold 字段
2. WHEN Settings_Record 不存在时, THE Travel_Settings_Service SHALL 返回 `{ travelSponsorshipEnabled: false, domesticThreshold: 0, internationalThreshold: 0 }`
3. THE Travel_Settings_Service SHALL 不要求身份认证即可访问

### 需求 3：计算可用差旅次数

**用户故事：** 作为 Speaker，我希望查看自己当前可申请的国内和国际差旅次数，以便了解是否有资格申请差旅赞助。

#### 验收标准

1. WHEN Speaker 请求 GET /api/travel/quota, THE Travel_Application_Service SHALL 计算该用户的 earnTotal，方法为查询 PointsRecords 表中该用户所有 type 为 "earn" 的记录并求和 amount
2. THE Travel_Application_Service SHALL 从用户记录中读取 travelEarnUsed 字段（默认为 0），该字段记录已用于差旅申请的累计 earn 配额
3. THE Travel_Application_Service SHALL 分别计算国内和国际差旅的可用次数：availableCount = floor((earnTotal - travelEarnUsed) / threshold)，当 threshold 为 0 时 availableCount 为 0
4. THE Travel_Application_Service SHALL 返回以下信息：earnTotal、travelEarnUsed、domesticAvailable（国内可用次数）、internationalAvailable（国际可用次数）、domesticThreshold、internationalThreshold
5. IF 请求者不拥有 Speaker 角色, THEN THE Travel_Application_Service SHALL 返回错误码 FORBIDDEN 和消息"仅 Speaker 角色可访问差旅赞助"

### 需求 4：提交差旅申请

**用户故事：** 作为 Speaker，我希望提交差旅赞助申请，以便获得社区对我参加活动的差旅费用支持。

#### 验收标准

1. WHEN Applicant 请求 POST /api/travel/apply, THE Travel_Application_Service SHALL 验证 Applicant 拥有 Speaker 角色
2. IF Applicant 不拥有 Speaker 角色, THEN THE Travel_Application_Service SHALL 返回错误码 FORBIDDEN 和消息"仅 Speaker 角色可申请差旅赞助"
3. WHEN travelSponsorshipEnabled 为 false, THE Travel_Application_Service SHALL 返回错误码 FEATURE_DISABLED 和消息"差旅赞助功能当前未开放"
4. WHEN Applicant 提交差旅申请, THE Travel_Application_Service SHALL 要求请求体包含以下字段：category（取值为 "domestic" 或 "international"）、communityRole（取值为 "Hero"、"CommunityBuilder" 或 "UGL"）、eventLink（合法 URL 格式）、cfpScreenshotUrl（图片 URL）、flightCost（非负数）、hotelCost（非负数）
5. IF 请求体缺少必填字段或字段格式无效, THEN THE Travel_Application_Service SHALL 返回错误码 INVALID_REQUEST 和具体错误消息
6. WHEN Travel_Application_Service 验证通过, THE Travel_Application_Service SHALL 计算当前可用差旅次数，方法为 floor((earnTotal - travelEarnUsed) / threshold)，其中 threshold 取对应 category 的门槛值
7. IF 可用差旅次数小于 1, THEN THE Travel_Application_Service SHALL 返回错误码 INSUFFICIENT_EARN_QUOTA 和消息"累计获得积分不足，无法申请差旅赞助"
8. WHEN 配额充足, THE Travel_Application_Service SHALL 使用 DynamoDB 事务原子性地完成以下操作：创建 Travel_Application 记录（状态为 pending）、将用户的 travelEarnUsed 增加对应 category 的 threshold 值（预扣配额）
9. THE Travel_Application_Service SHALL 在 Travel_Application 记录中存储以下字段：applicationId（ULID）、userId、applicantNickname、category、communityRole、eventLink、cfpScreenshotUrl、flightCost、hotelCost、totalCost（flightCost + hotelCost）、status（pending）、earnDeducted（本次预扣的 earn 配额值）、createdAt、updatedAt
10. WHEN 申请创建成功, THE Travel_Application_Service SHALL 返回创建的申请记录

### 需求 5：审批差旅申请

**用户故事：** 作为 SuperAdmin，我希望审批 Speaker 提交的差旅申请，以便决定是否批准差旅赞助。

#### 验收标准

1. WHEN Reviewer 请求 PATCH /api/admin/travel/{applicationId}/review, THE Travel_Application_Service SHALL 验证 Reviewer 拥有 SuperAdmin 角色
2. IF Reviewer 不拥有 SuperAdmin 角色, THEN THE Travel_Application_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"
3. WHEN Reviewer 批准差旅申请, THE Travel_Application_Service SHALL 要求请求体包含 action 值为 "approve"
4. WHEN Reviewer 驳回差旅申请, THE Travel_Application_Service SHALL 要求请求体包含 action 值为 "reject" 和可选的 rejectReason 字段（1~500 字符）
5. IF 目标申请的状态不是 pending, THEN THE Travel_Application_Service SHALL 返回错误码 APPLICATION_ALREADY_REVIEWED 和消息"该申请已被审批"
6. WHEN 申请被批准, THE Travel_Application_Service SHALL 更新申请状态为 approved，记录 reviewerId、reviewerNickname、reviewedAt，用户的 travelEarnUsed 保持不变（预扣配额已在提交时完成）
7. WHEN 申请被驳回, THE Travel_Application_Service SHALL 使用 DynamoDB 事务原子性地完成以下操作：更新申请状态为 rejected 并记录 rejectReason、reviewerId、reviewerNickname、reviewedAt，将用户的 travelEarnUsed 减少该申请的 earnDeducted 值（归还配额）
8. WHEN 审批操作成功, THE Travel_Application_Service SHALL 返回更新后的申请记录

### 需求 6：查看我的差旅申请

**用户故事：** 作为 Speaker，我希望查看自己提交的差旅申请历史和审批状态，以便了解申请进度和结果。

#### 验收标准

1. WHEN Applicant 请求 GET /api/travel/my-applications, THE Travel_Application_Service SHALL 仅返回该 Applicant 自身提交的差旅申请记录
2. WHEN Applicant 提供 status 查询参数（pending、approved、rejected）, THE Travel_Application_Service SHALL 仅返回匹配该状态的申请记录
3. THE Travel_Application_Service SHALL 按提交时间倒序排列返回的申请记录
4. THE Travel_Application_Service SHALL 支持分页查询，默认每页 20 条，最大 100 条，并在存在更多记录时返回分页游标 lastKey
5. THE Travel_Application_Service SHALL 在每条申请记录中返回以下字段：applicationId、category、communityRole、eventLink、cfpScreenshotUrl、flightCost、hotelCost、totalCost、status、rejectReason（如已驳回）、reviewedAt（如已审批）、createdAt

### 需求 7：编辑并重新提交被驳回的申请

**用户故事：** 作为 Speaker，我希望编辑被驳回的差旅申请并重新提交，以便修正问题后再次申请。

#### 验收标准

1. WHEN Applicant 请求 PUT /api/travel/applications/{applicationId}, THE Travel_Application_Service SHALL 验证该申请属于当前 Applicant 且状态为 rejected
2. IF 申请不属于当前 Applicant, THEN THE Travel_Application_Service SHALL 返回错误码 FORBIDDEN 和消息"无权编辑此申请"
3. IF 申请状态不是 rejected, THEN THE Travel_Application_Service SHALL 返回错误码 INVALID_STATUS 和消息"仅被驳回的申请可以编辑重新提交"
4. WHEN Applicant 提交编辑请求, THE Travel_Application_Service SHALL 接受与提交申请相同的字段（category、communityRole、eventLink、cfpScreenshotUrl、flightCost、hotelCost），并重新校验所有字段
5. IF 编辑后的 category 与原申请不同, THE Travel_Application_Service SHALL 重新计算配额：归还原 category 的 earnDeducted，预扣新 category 的 threshold
6. IF 编辑后的 category 与原申请相同, THE Travel_Application_Service SHALL 直接预扣配额（原配额已在驳回时归还）
7. IF 重新提交时可用差旅次数不足, THEN THE Travel_Application_Service SHALL 返回错误码 INSUFFICIENT_EARN_QUOTA 和消息"累计获得积分不足，无法重新提交"
8. WHEN 重新提交成功, THE Travel_Application_Service SHALL 使用 DynamoDB 事务原子性地更新申请记录（更新字段内容、状态改为 pending、更新 earnDeducted、清除 rejectReason 和审批信息）并更新用户的 travelEarnUsed
9. WHEN 重新提交成功, THE Travel_Application_Service SHALL 返回更新后的申请记录

### 需求 8：管理端查看所有差旅申请

**用户故事：** 作为 SuperAdmin，我希望查看所有 Speaker 提交的差旅申请，以便进行审批管理。

#### 验收标准

1. WHEN Reviewer 请求 GET /api/admin/travel/applications, THE Travel_Application_Service SHALL 验证 Reviewer 拥有 SuperAdmin 角色
2. IF Reviewer 不拥有 SuperAdmin 角色, THEN THE Travel_Application_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"
3. THE Travel_Application_Service SHALL 返回所有差旅申请记录，每条记录包含：applicationId、userId、applicantNickname、category、communityRole、eventLink、flightCost、hotelCost、totalCost、status、rejectReason（如有）、reviewedAt（如有）、createdAt
4. WHEN Reviewer 提供 status 查询参数, THE Travel_Application_Service SHALL 仅返回匹配该状态的申请记录
5. THE Travel_Application_Service SHALL 按提交时间倒序排列返回的申请记录，默认显示 pending 状态
6. THE Travel_Application_Service SHALL 支持分页查询，默认每页 20 条，最大 100 条，并在存在更多记录时返回分页游标 lastKey

### 需求 9：商城页面差旅入口

**用户故事：** 作为 Speaker，我希望在商城页面看到差旅赞助入口，以便快速进入差旅申请流程。

#### 验收标准

1. WHEN travelSponsorshipEnabled 为 true, THE Mall_Page SHALL 在商品类型筛选标签栏中新增"差旅"标签，位于现有标签之后
2. WHEN 用户点击"差旅"标签, THE Mall_Page SHALL 切换显示差旅赞助卡片视图，替代商品列表
3. THE Mall_Page SHALL 在差旅视图中显示两张卡片：国内差旅和国际差旅，每张卡片显示差旅类别名称、所需积分门槛、当前可用次数
4. WHEN 用户不拥有 Speaker 角色, THE Mall_Page SHALL 在差旅卡片上显示锁定状态和提示"仅 Speaker 可申请"
5. WHEN 用户拥有 Speaker 角色但可用次数为 0, THE Mall_Page SHALL 在差旅卡片上显示锁定状态和提示"累计积分不足"
6. WHEN 用户拥有 Speaker 角色且可用次数大于 0, THE Mall_Page SHALL 在差旅卡片上显示"申请"按钮
7. WHEN Speaker 点击可用的差旅卡片的"申请"按钮, THE Mall_Page SHALL 导航到差旅申请页面，并传递差旅类别参数
8. WHEN travelSponsorshipEnabled 为 false, THE Mall_Page SHALL 隐藏"差旅"标签

### 需求 10：差旅申请表单页面

**用户故事：** 作为 Speaker，我希望有一个完整的表单页面来填写差旅申请信息，以便提交差旅赞助申请。

#### 验收标准

1. THE Travel_Application_Page SHALL 显示差旅类别（国内/国际），根据从商城页面传入的参数预选，允许用户切换
2. THE Travel_Application_Page SHALL 提供社区角色选择器，选项为 Hero、CommunityBuilder、UGL，以标签形式展示供用户单选
3. THE Travel_Application_Page SHALL 提供活动链接输入框，要求输入合法 URL
4. THE Travel_Application_Page SHALL 提供 CFP 接受截图上传区域，支持上传一张图片，使用与积分申请相同的图片上传流程
5. THE Travel_Application_Page SHALL 提供机票费用输入框和酒店费用输入框，均接受非负数输入
6. THE Travel_Application_Page SHALL 实时显示自动计算的总费用（机票费用 + 酒店费用）
7. WHEN Applicant 填写完成并点击提交, THE Travel_Application_Page SHALL 调用 POST /api/travel/apply 接口提交申请
8. WHEN 提交成功, THE Travel_Application_Page SHALL 显示成功提示并导航到我的差旅申请页面
9. IF 提交失败, THEN THE Travel_Application_Page SHALL 显示具体错误信息
10. WHEN Travel_Application_Page 用于编辑被驳回的申请时, THE Travel_Application_Page SHALL 预填原申请的所有字段，提交时调用 PUT /api/travel/applications/{applicationId} 接口

### 需求 11：我的差旅申请页面

**用户故事：** 作为 Speaker，我希望有一个页面查看我的差旅申请历史和状态，以便跟踪申请进度。

#### 验收标准

1. THE My_Travel_Page SHALL 展示当前用户的差旅申请列表，每条记录显示差旅类别标签、总费用、状态标签、提交时间
2. THE My_Travel_Page SHALL 提供状态筛选标签栏（全部、待审批、已批准、已驳回）
3. WHEN Speaker 点击某条申请记录, THE My_Travel_Page SHALL 展示申请详情，包含所有表单字段、审批结果（驳回原因）
4. WHEN 申请状态为 rejected, THE My_Travel_Page SHALL 在详情中显示"编辑重新提交"按钮
5. WHEN Speaker 点击"编辑重新提交"按钮, THE My_Travel_Page SHALL 导航到差旅申请页面并传递申请 ID，进入编辑模式
6. THE My_Travel_Page SHALL 支持下拉加载更多申请记录
7. THE My_Travel_Page SHALL 在页面顶部显示当前可用差旅次数概览（国内 X 次 / 国际 Y 次）

### 需求 12：差旅审批管理页面

**用户故事：** 作为 SuperAdmin，我希望有一个专门的页面审批差旅申请，以便高效地完成审批工作。

#### 验收标准

1. THE Travel_Review_Page SHALL 展示所有差旅申请列表，每条记录显示申请人昵称、差旅类别标签、总费用、状态标签、提交时间
2. THE Travel_Review_Page SHALL 提供状态筛选标签栏（全部、待审批、已批准、已驳回），默认显示待审批
3. WHEN Reviewer 点击某条申请记录, THE Travel_Review_Page SHALL 展示申请详情，包含申请人信息、社区角色、活动链接、CFP 截图预览、费用明细
4. WHEN Reviewer 审批待审批状态的申请, THE Travel_Review_Page SHALL 提供批准和驳回两个操作按钮
5. WHEN Reviewer 点击批准按钮, THE Travel_Review_Page SHALL 弹出确认弹窗，确认后调用审批接口
6. WHEN Reviewer 点击驳回按钮, THE Travel_Review_Page SHALL 弹出驳回原因输入弹窗（可选填写，1~500 字符），确认后调用审批接口
7. WHEN 审批操作成功, THE Travel_Review_Page SHALL 刷新列表并显示操作成功提示
8. IF 审批操作失败, THEN THE Travel_Review_Page SHALL 显示具体错误信息
9. THE Travel_Review_Page SHALL 支持下拉加载更多申请记录

### 需求 13：管理后台导航集成

**用户故事：** 作为 SuperAdmin，我希望从管理后台首页快速进入差旅审批和设置页面，以便方便地管理差旅赞助功能。

#### 验收标准

1. THE Admin_Dashboard SHALL 在导航卡片列表中新增"差旅审批"入口，仅 SuperAdmin 可见
2. THE Admin_Dashboard SHALL 在现有"功能设置"页面中新增差旅赞助配置区域，包含功能开关、国内门槛、国际门槛三个配置项
3. WHEN SuperAdmin 点击"差旅审批"卡片, THE Admin_Dashboard SHALL 导航到差旅审批页面
4. WHEN SuperAdmin 切换差旅赞助功能开关, THE Settings_Page SHALL 调用 PUT /api/admin/settings/travel-sponsorship 提交更新
5. WHEN 更新成功, THE Settings_Page SHALL 显示操作成功提示
6. IF 更新失败, THEN THE Settings_Page SHALL 显示错误信息并将控件恢复到更新前的状态

### 需求 14：CDK 路由与数据表配置

**用户故事：** 作为开发者，我希望在 API Gateway 中注册差旅赞助相关的路由并配置数据表，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE CDK_Stack SHALL 在 API Gateway 中注册以下用户端路由，集成到 Points Lambda：GET /api/travel/quota（查询差旅配额）、POST /api/travel/apply（提交差旅申请）、GET /api/travel/my-applications（查看我的申请）、PUT /api/travel/applications/{id}（编辑重新提交申请）
2. THE CDK_Stack SHALL 在 API Gateway 中注册以下管理端路由，集成到 Admin Lambda：GET /api/admin/travel/applications（查看所有申请）、PATCH /api/admin/travel/{id}/review（审批申请）、PUT /api/admin/settings/travel-sponsorship（更新差旅设置）
3. THE CDK_Stack SHALL 在 API Gateway 中注册以下公开路由，集成到 Points Lambda：GET /api/settings/travel-sponsorship（查询差旅设置，无需认证）
4. THE CDK_Stack SHALL 在 DatabaseStack 中定义 TravelApplications 表（PK: applicationId），并创建 GSI userId-createdAt-index（PK: userId, SK: createdAt）和 GSI status-createdAt-index（PK: status, SK: createdAt）
5. THE CDK_Stack SHALL 为 Points Lambda 和 Admin Lambda 授予 TravelApplications 表的读写权限
6. THE CDK_Stack SHALL 将 TravelApplications 表名作为环境变量 TRAVEL_APPLICATIONS_TABLE 传递给 Points Lambda 和 Admin Lambda
7. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 15：用户 travelEarnUsed 字段

**用户故事：** 作为系统，我希望在用户记录中跟踪差旅已用配额，以便准确计算可用差旅次数并防止超额申请。

#### 验收标准

1. THE Travel_Application_Service SHALL 在 Users 表的用户记录中使用 travelEarnUsed 字段（Number 类型，默认 0）跟踪差旅已用 earn 配额
2. WHEN 差旅申请提交成功, THE Travel_Application_Service SHALL 原子性地将 travelEarnUsed 增加对应 category 的 threshold 值
3. WHEN 差旅申请被驳回, THE Travel_Application_Service SHALL 原子性地将 travelEarnUsed 减少该申请的 earnDeducted 值
4. THE Travel_Application_Service SHALL 使用 DynamoDB ConditionExpression 确保 travelEarnUsed 不会变为负数
5. THE Travel_Application_Service SHALL 在预扣配额前验证 earnTotal - travelEarnUsed >= threshold，防止并发申请导致超额

### 需求 16：国际化支持

**用户故事：** 作为用户，我希望差旅赞助相关的界面文案支持多语言，以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为差旅赞助功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh、en、ja、ko、zh-TW 五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：差旅标签页文案、差旅卡片文案、申请表单标签与占位符、状态标签、审批页面文案、设置页面文案、成功与错误提示、我的差旅页面文案
