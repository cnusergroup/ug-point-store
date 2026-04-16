# 需求文档：洞察报表扩展（Insight Reports Expansion）

## 简介

本功能在现有 SuperAdmin 报表页面（/pages/admin/reports）基础上扩展六类新的洞察报表，以新 Tab 形式添加到已有的四个 Tab（积分明细、UG 活跃度、用户排行、活动汇总）之后。新增报表类型包括：

1. **人气商品排行（Popular Products Ranking）**：按兑换次数排名商品，展示兑换量、积分消耗、库存消耗率等指标。
2. **热门内容排行（Hot Content Ranking）**：按互动总分（点赞 + 评论 + 预约）排名内容，展示各维度互动数据。
3. **内容贡献者排行（Content Contributor Ranking）**：按已审核通过的内容数量排名用户，展示贡献量和互动汇总。
4. **库存预警（Inventory Alert）**：列出低库存商品，支持按库存阈值筛选，帮助管理员及时补货。
5. **差旅申请统计（Travel Application Statistics）**：按月/季度聚合差旅申请数据，展示审批率和赞助金额。
6. **邀请转化率（Invite Conversion Rate）**：展示邀请链接使用统计，包括生成数、使用数、过期数和转化率。

所有新增报表仅 SuperAdmin 可访问，复用现有的权限校验、导出（CSV/Excel）和 i18n 架构。

## 术语表

- **Report_Service（报表服务）**：处理报表数据查询和文件导出逻辑的后端服务模块（packages/backend/src/reports/）
- **Report_Page（报表页面）**：SuperAdmin 管理面板中的报表查看与导出页面（/pages/admin/reports）
- **Export_Service（导出服务）**：负责将报表数据生成为 CSV 或 Excel 文件并上传至 S3 的服务模块
- **Products_Table（商品表）**：DynamoDB 中存储商品信息的表（PointsMall-Products），包含 productId、name、type、stock、status、sizeOptions 等字段
- **Redemptions_Table（兑换记录表）**：DynamoDB 中存储兑换记录的表（PointsMall-Redemptions），包含 redemptionId、userId、productId、type、pointsSpent、createdAt 等字段
- **ContentItems_Table（内容表）**：DynamoDB 中存储内容项的表（PointsMall-ContentItems），包含 contentId、uploaderId、title、categoryId、status、likeCount、commentCount、reservationCount 等字段
- **TravelApplications_Table（差旅申请表）**：DynamoDB 中存储差旅申请的表（PointsMall-TravelApplications），包含 applicationId、userId、category、status、flightCost、hotelCost、totalCost、createdAt 等字段
- **Invites_Table（邀请表）**：DynamoDB 中存储邀请记录的表（PointsMall-Invites），包含 token、roles、status、createdAt、expiresAt、usedAt 等字段
- **Users_Table（用户表）**：DynamoDB 中存储用户信息的表（PointsMall-Users），包含 userId、nickname、email、roles 等字段
- **Engagement_Score（互动总分）**：内容的点赞数 + 评论数 + 预约数之和，用于热门内容排行
- **Stock_Consumption_Rate（库存消耗率）**：已兑换数量占总库存（初始库存）的百分比，计算公式为 redemptionCount / (stock + redemptionCount) × 100%
- **Conversion_Rate（转化率）**：已使用邀请数占总邀请数的百分比，计算公式为 usedCount / totalCount × 100%
- **Filter_Panel（筛选面板）**：报表页面中用于设置筛选条件的 UI 区域

## 需求

### 需求 1：报表 Tab 导航扩展

**用户故事：** 作为 SuperAdmin，我希望在报表页面中通过新增的 Tab 访问洞察报表，以便在同一页面内浏览所有报表类型。

#### 验收标准

1. THE Report_Page SHALL 在现有四个 Tab（积分明细、UG 活跃度、用户排行、活动汇总）之后新增六个 Tab：人气商品排行、热门内容排行、内容贡献者排行、库存预警、差旅申请统计、邀请转化率
2. THE Report_Page SHALL 支持 Tab 栏横向滚动，以便在移动端屏幕上容纳全部十个 Tab
3. WHEN SuperAdmin 切换到新增 Tab, THE Report_Page SHALL 加载对应报表的筛选面板和数据表格
4. THE Report_Page SHALL 在 Tab 切换时保留各 Tab 独立的筛选条件状态

### 需求 2：人气商品排行报表查询

**用户故事：** 作为 SuperAdmin，我希望查看按兑换次数排名的商品列表，以便了解哪些商品最受欢迎。

#### 验收标准

1. WHEN SuperAdmin 请求人气商品排行报表, THE Report_Service SHALL 从 Redemptions_Table 按 productId 聚合统计兑换次数（redemptionCount）和消耗积分总额（totalPointsSpent，所有 pointsSpent 之和），并关联 Products_Table 获取商品名称（name）、商品类型（type，取值为 points 或 code_exclusive）、当前库存（stock）
2. THE Report_Service SHALL 计算每个商品的库存消耗率（Stock_Consumption_Rate），公式为 redemptionCount / (stock + redemptionCount) × 100%，结果保留一位小数
3. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 Redemptions_Table 的 createdAt 时间范围筛选）、productType（按商品类型筛选，取值为 points、code_exclusive 或 all，默认 all）
4. THE Report_Service SHALL 按兑换次数倒序排列返回结果
5. IF 未提供时间范围, THEN THE Report_Service SHALL 返回全部时间范围的统计数据

### 需求 3：人气商品排行报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看人气商品排行数据，以便直观了解商品受欢迎程度和库存状况。

#### 验收标准

1. THE Report_Page SHALL 在人气商品排行 Tab 中显示 Filter_Panel，包含以下筛选控件：时间范围选择器（开始日期和结束日期）、商品类型下拉选择器（选项为积分商品、Code 专属商品和全部）
2. THE Report_Page SHALL 以表格形式展示人气商品排行数据，列包含：商品名称、商品类型、兑换次数、消耗积分总额、当前库存、库存消耗率
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新报表数据
4. THE Report_Page SHALL 对库存消耗率大于 80% 的行以警告色（var(--warning)）高亮显示

### 需求 4：热门内容排行报表查询

**用户故事：** 作为 SuperAdmin，我希望查看按互动总分排名的内容列表，以便了解哪些内容最受关注。

#### 验收标准

1. WHEN SuperAdmin 请求热门内容排行报表, THE Report_Service SHALL 从 ContentItems_Table 查询状态为 approved 的内容项，每条记录包含以下字段：标题（title）、作者昵称（uploaderNickname）、分类名称（categoryName）、点赞数（likeCount）、评论数（commentCount）、预约数（reservationCount）、互动总分（Engagement_Score = likeCount + commentCount + reservationCount）
2. THE Report_Service SHALL 支持以下筛选条件：categoryId（按内容分类筛选）、startDate 和 endDate（按 ContentItems_Table 的 createdAt 时间范围筛选）
3. THE Report_Service SHALL 按互动总分倒序排列返回结果
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回全部时间范围的数据

### 需求 5：热门内容排行报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看热门内容排行数据，以便了解内容运营效果。

#### 验收标准

1. THE Report_Page SHALL 在热门内容排行 Tab 中显示 Filter_Panel，包含以下筛选控件：时间范围选择器（开始日期和结束日期）、内容分类下拉选择器（从 ContentCategories 表加载分类列表）
2. THE Report_Page SHALL 以表格形式展示热门内容排行数据，列包含：标题、作者昵称、分类名称、点赞数、评论数、预约数、互动总分
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新报表数据

### 需求 6：内容贡献者排行报表查询

**用户故事：** 作为 SuperAdmin，我希望查看按已审核通过内容数量排名的用户列表，以便识别活跃的内容贡献者。

#### 验收标准

1. WHEN SuperAdmin 请求内容贡献者排行报表, THE Report_Service SHALL 从 ContentItems_Table 查询状态为 approved 的内容项，按 uploaderId 聚合统计以下数据：已审核通过内容数量（approvedCount）、获得的总点赞数（totalLikes，所有该用户内容的 likeCount 之和）、获得的总评论数（totalComments，所有该用户内容的 commentCount 之和），并关联 Users_Table 获取用户昵称（nickname）
2. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 ContentItems_Table 的 createdAt 时间范围筛选）
3. THE Report_Service SHALL 按已审核通过内容数量倒序排列返回结果，并为每条记录添加排名序号（rank，从 1 开始）
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回全部时间范围的数据

### 需求 7：内容贡献者排行报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看内容贡献者排行数据，以便了解社区内容生态的贡献分布。

#### 验收标准

1. THE Report_Page SHALL 在内容贡献者排行 Tab 中显示 Filter_Panel，包含时间范围选择器（开始日期和结束日期）
2. THE Report_Page SHALL 以表格形式展示内容贡献者排行数据，列包含：排名、用户昵称、已审核通过内容数量、获得总点赞数、获得总评论数
3. WHEN SuperAdmin 修改时间范围, THE Report_Page SHALL 自动重新查询并刷新排行数据

### 需求 8：库存预警报表查询

**用户故事：** 作为 SuperAdmin，我希望查看低库存商品列表，以便及时安排补货或下架操作。

#### 验收标准

1. WHEN SuperAdmin 请求库存预警报表, THE Report_Service SHALL 从 Products_Table 查询所有商品，每条记录包含以下字段：商品名称（name）、商品类型（type）、当前库存（stock）、商品状态（status）
2. WHEN 商品包含尺码选项（sizeOptions）, THE Report_Service SHALL 计算总库存为所有尺码选项的 stock 之和，并在返回结果中包含总库存（totalStock）字段
3. THE Report_Service SHALL 支持以下筛选条件：stockThreshold（库存阈值，默认值为 5，返回当前库存小于该阈值的商品）、productType（按商品类型筛选，取值为 points、code_exclusive 或 all，默认 all）、productStatus（按商品状态筛选，取值为 active、inactive 或 all，默认 all）
4. THE Report_Service SHALL 按当前库存升序排列返回结果（库存最少的排在最前）
5. IF 商品包含尺码选项, THEN THE Report_Service SHALL 对每个尺码选项的库存分别与阈值比较，任一尺码库存低于阈值即纳入结果

### 需求 9：库存预警报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看库存预警数据，以便快速识别需要补货的商品。

#### 验收标准

1. THE Report_Page SHALL 在库存预警 Tab 中显示 Filter_Panel，包含以下筛选控件：库存阈值输入框（默认值为 5，允许输入 1~999 的正整数）、商品类型下拉选择器（选项为积分商品、Code 专属商品和全部）、商品状态下拉选择器（选项为上架中、已下架和全部）
2. THE Report_Page SHALL 以表格形式展示库存预警数据，列包含：商品名称、商品类型、当前库存、总库存（含尺码选项时显示）、商品状态
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新报表数据
4. THE Report_Page SHALL 对库存为 0 的行以错误色（var(--error)）高亮显示

### 需求 10：差旅申请统计报表查询

**用户故事：** 作为 SuperAdmin，我希望按时间周期查看差旅申请的聚合统计数据，以便了解差旅赞助的整体使用情况。

#### 验收标准

1. WHEN SuperAdmin 请求差旅申请统计报表, THE Report_Service SHALL 从 TravelApplications_Table 查询所有差旅申请，按时间周期聚合统计以下数据：时间周期标签（period，格式为 YYYY-MM 或 YYYY-QN）、申请总数（totalApplications）、已批准数（approvedCount，status=approved）、已拒绝数（rejectedCount，status=rejected）、待审核数（pendingCount，status=pending）、审批通过率（approvalRate = approvedCount / totalApplications × 100%，保留一位小数）、赞助总金额（totalSponsoredAmount，所有 approved 申请的 totalCost 之和）
2. THE Report_Service SHALL 支持以下筛选条件：periodType（聚合周期类型，取值为 month 或 quarter，默认 month）、startDate 和 endDate（按 TravelApplications_Table 的 createdAt 时间范围筛选）、category（按差旅类别筛选，取值为 domestic、international 或 all，默认 all）
3. THE Report_Service SHALL 按时间周期倒序排列返回结果（最近的周期排在最前）
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回最近 12 个月的统计数据

### 需求 11：差旅申请统计报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看差旅申请统计数据，以便直观了解差旅赞助的审批和支出趋势。

#### 验收标准

1. THE Report_Page SHALL 在差旅申请统计 Tab 中显示 Filter_Panel，包含以下筛选控件：时间范围选择器（开始日期和结束日期）、聚合周期下拉选择器（选项为按月和按季度）、差旅类别下拉选择器（选项为国内、国际和全部）
2. THE Report_Page SHALL 以表格形式展示差旅申请统计数据，列包含：时间周期、申请总数、已批准数、已拒绝数、待审核数、审批通过率、赞助总金额
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新统计数据

### 需求 12：邀请转化率报表查询

**用户故事：** 作为 SuperAdmin，我希望查看邀请链接的使用统计数据，以便了解邀请机制的有效性。

#### 验收标准

1. WHEN SuperAdmin 请求邀请转化率报表, THE Report_Service SHALL 从 Invites_Table 查询所有邀请记录，聚合统计以下数据：邀请总数（totalInvites）、已使用数（usedCount，status=used）、已过期数（expiredCount，status=expired）、待使用数（pendingCount，status=pending）、转化率（Conversion_Rate = usedCount / totalInvites × 100%，保留一位小数）
2. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 Invites_Table 的 createdAt 时间范围筛选）
3. THE Report_Service SHALL 返回单条汇总记录（非列表形式）
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回全部时间范围的统计数据

### 需求 13：邀请转化率报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看邀请转化率数据，以便评估邀请机制的效果。

#### 验收标准

1. THE Report_Page SHALL 在邀请转化率 Tab 中显示 Filter_Panel，包含时间范围选择器（开始日期和结束日期）
2. THE Report_Page SHALL 以卡片形式展示邀请转化率汇总数据，包含以下指标卡片：邀请总数、已使用数、已过期数、待使用数、转化率（以百分比显示，使用 var(--font-display) 字体加粗展示）
3. WHEN SuperAdmin 修改时间范围, THE Report_Page SHALL 自动重新查询并刷新统计数据

### 需求 14：新增报表 API 路由

**用户故事：** 作为开发者，我希望在 Admin Lambda 中注册新增报表的 API 路由，以便前端能够调用新增报表的查询接口。

#### 验收标准

1. THE Admin_Handler SHALL 注册以下 API 路由：
   - GET /api/admin/reports/popular-products（查询人气商品排行报表）
   - GET /api/admin/reports/hot-content（查询热门内容排行报表）
   - GET /api/admin/reports/content-contributors（查询内容贡献者排行报表）
   - GET /api/admin/reports/inventory-alert（查询库存预警报表）
   - GET /api/admin/reports/travel-statistics（查询差旅申请统计报表）
   - GET /api/admin/reports/invite-conversion（查询邀请转化率报表）
2. THE Admin_Handler SHALL 对所有新增报表路由执行 SuperAdmin 权限校验
3. THE Admin_Handler SHALL 将筛选条件通过 query string 参数传递

### 需求 15：新增报表数据导出

**用户故事：** 作为 SuperAdmin，我希望将新增的洞察报表数据导出为 CSV 或 Excel 文件，以便离线分析和分享。

#### 验收标准

1. THE Export_Service SHALL 扩展现有导出接口（POST /api/admin/reports/export），支持以下新增报表类型：popular-products、hot-content、content-contributors、inventory-alert、travel-statistics、invite-conversion
2. THE Export_Service SHALL 为每种新增报表类型定义导出列：
   - 人气商品排行：商品名称、商品类型、兑换次数、消耗积分总额、当前库存、库存消耗率
   - 热门内容排行：标题、作者昵称、分类名称、点赞数、评论数、预约数、互动总分
   - 内容贡献者排行：排名、用户昵称、已审核通过内容数量、获得总点赞数、获得总评论数
   - 库存预警：商品名称、商品类型、当前库存、总库存、商品状态
   - 差旅申请统计：时间周期、申请总数、已批准数、已拒绝数、待审核数、审批通过率、赞助总金额
   - 邀请转化率：邀请总数、已使用数、已过期数、待使用数、转化率
3. THE Export_Service SHALL 在 Excel 格式中为表头行设置加粗样式
4. THE Export_Service SHALL 在 CSV 格式中使用中文列名作为表头
5. THE Export_Service SHALL 复用现有的 S3 上传和预签名 URL 生成逻辑

### 需求 16：新增报表导出前端交互

**用户故事：** 作为 SuperAdmin，我希望在新增报表 Tab 中也能方便地触发导出操作。

#### 验收标准

1. THE Report_Page SHALL 在每个新增报表 Tab 的 Filter_Panel 中显示导出按钮，提供 CSV 和 Excel 两种格式选项
2. WHEN SuperAdmin 点击导出按钮, THE Report_Page SHALL 调用导出接口并显示加载提示
3. WHEN 导出接口返回预签名 URL, THE Report_Page SHALL 自动触发浏览器下载
4. IF 导出失败, THEN THE Report_Page SHALL 显示具体错误信息
5. WHILE 导出进行中, THE Report_Page SHALL 禁用导出按钮以防止重复请求

### 需求 17：CDK 基础设施配置

**用户故事：** 作为开发者，我希望确保 Admin Lambda 拥有访问新增报表所需 DynamoDB 表的读取权限。

#### 验收标准

1. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 Products_Table 的读取权限（dynamodb:Scan、dynamodb:Query、dynamodb:GetItem、dynamodb:BatchGetItem）
2. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 Redemptions_Table 的读取权限
3. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 ContentItems_Table 的读取权限
4. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 TravelApplications_Table 的读取权限
5. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 Invites_Table 的读取权限
6. THE CDK_Stack SHALL 确保所有新增路由通过现有的 Admin Lambda {proxy+} 代理模式注册，无需在 API Gateway 中新增路由

### 需求 18：国际化支持

**用户故事：** 作为用户，我希望新增报表功能的界面文案支持多语言，以便不同语言的管理员都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为新增报表功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：六个新增 Tab 标签名、各报表的筛选面板标签、表格列名、邀请转化率卡片指标名、导出按钮文案、加载状态和错误提示、空数据状态提示

### 需求 19：人气商品排行聚合正确性

**用户故事：** 作为系统，我希望人气商品排行的聚合计算准确无误，以便 SuperAdmin 获得可靠的商品分析数据。

#### 验收标准

1. FOR ALL 有效的 Redemptions 记录数组, THE Report_Service 按 productId 聚合后的 redemptionCount SHALL 等于该 productId 在原始数组中出现的次数
2. FOR ALL 有效的 Redemptions 记录数组, THE Report_Service 按 productId 聚合后的 totalPointsSpent SHALL 等于该 productId 对应所有记录的 pointsSpent 之和
3. FOR ALL 非负整数 stock 和非负整数 redemptionCount, THE Report_Service 计算的 Stock_Consumption_Rate SHALL 等于 redemptionCount / (stock + redemptionCount) × 100（当 stock + redemptionCount 为 0 时返回 0）

### 需求 20：内容排行聚合正确性

**用户故事：** 作为系统，我希望内容排行和贡献者排行的聚合计算准确无误。

#### 验收标准

1. FOR ALL 有效的 ContentItems 记录, THE Report_Service 计算的 Engagement_Score SHALL 等于该记录的 likeCount + commentCount + reservationCount
2. FOR ALL 有效的 ContentItems 记录数组, THE Report_Service 按 uploaderId 聚合后的 approvedCount SHALL 等于该 uploaderId 在原始数组中出现的次数
3. FOR ALL 有效的 ContentItems 记录数组, THE Report_Service 按 uploaderId 聚合后的 totalLikes SHALL 等于该 uploaderId 对应所有记录的 likeCount 之和

### 需求 21：差旅申请统计聚合正确性

**用户故事：** 作为系统，我希望差旅申请统计的聚合计算准确无误。

#### 验收标准

1. FOR ALL 有效的 TravelApplications 记录数组按月聚合后, 每个月的 totalApplications SHALL 等于 approvedCount + rejectedCount + pendingCount
2. FOR ALL 有效的 TravelApplications 记录数组, THE Report_Service 计算的 approvalRate SHALL 等于 approvedCount / totalApplications × 100（当 totalApplications 为 0 时返回 0），结果保留一位小数
3. FOR ALL 有效的 TravelApplications 记录数组, THE Report_Service 按时间周期聚合后的 totalSponsoredAmount SHALL 等于该周期内所有 status=approved 的申请的 totalCost 之和

### 需求 22：邀请转化率聚合正确性

**用户故事：** 作为系统，我希望邀请转化率的聚合计算准确无误。

#### 验收标准

1. FOR ALL 有效的 Invites 记录数组, THE Report_Service 计算的 totalInvites SHALL 等于数组长度
2. FOR ALL 有效的 Invites 记录数组, THE Report_Service 计算的 usedCount + expiredCount + pendingCount SHALL 等于 totalInvites
3. FOR ALL 有效的 Invites 记录数组, THE Report_Service 计算的 Conversion_Rate SHALL 等于 usedCount / totalInvites × 100（当 totalInvites 为 0 时返回 0），结果保留一位小数
