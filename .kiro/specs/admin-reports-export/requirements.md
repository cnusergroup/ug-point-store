# 需求文档：SuperAdmin 报表与数据导出（Admin Reports Export）

## 简介

本功能为社区积分商城系统新增 SuperAdmin 专属的报表查看与数据导出能力，包含四类报表：

1. **积分明细报表（Points Detail Report）**：展示所有积分记录的详细信息，支持多维度筛选（时间范围、UG、身份、活动、类型），可导出 CSV/Excel。
2. **UG 活跃度汇总报表（UG Activity Summary）**：按 UG 维度统计活动数量、发放积分总额、参与人数，支持时间范围筛选和导出。
3. **用户积分排行报表（User Points Ranking）**：按时间范围统计每个用户的获取积分总额，支持按身份筛选和导出。
4. **活动积分汇总报表（Activity Points Summary）**：按活动维度统计每场活动的积分发放总额、涉及人数、各身份分布，支持时间范围和 UG 筛选及导出。

所有报表仅 SuperAdmin 可访问。导出功能由后端 Lambda 生成文件（CSV 或 Excel），上传至 S3，返回预签名下载 URL 给前端。

## 术语表

- **Report_Service（报表服务）**：处理报表数据查询和文件导出逻辑的后端服务模块
- **Report_Page（报表页面）**：SuperAdmin 管理面板中的报表查看与导出页面（/pages/admin/reports）
- **Points_Detail_Report（积分明细报表）**：展示 PointsRecords 表中每条积分记录详细信息的报表
- **UG_Activity_Summary（UG 活跃度汇总报表）**：按 UG 维度聚合统计活动数量、积分总额、参与人数的报表
- **User_Points_Ranking（用户积分排行报表）**：按用户维度聚合统计获取积分总额并排序的报表
- **Activity_Points_Summary（活动积分汇总报表）**：按活动维度聚合统计积分发放总额、涉及人数、各身份分布的报表
- **Export_Service（导出服务）**：负责将报表数据生成为 CSV 或 Excel 文件并上传至 S3 的服务模块
- **Presigned_URL（预签名 URL）**：S3 生成的带有临时访问权限的下载链接，有效期有限
- **PointsRecords_Table（积分记录表）**：DynamoDB 中存储所有积分变动记录的表，包含 earn 和 spend 两种类型
- **BatchDistributions_Table（批量发放表）**：DynamoDB 中存储批量积分发放记录的表，包含发放者昵称等信息
- **Users_Table（用户表）**：DynamoDB 中存储用户信息的表，包含 nickname、roles 等字段
- **Activities_Table（活动表）**：DynamoDB 中存储已同步活动数据的表
- **UGs_Table（用户组表）**：DynamoDB 中存储 UG 数据的表
- **IMAGES_BUCKET（文件存储桶）**：S3 存储桶，用于存放导出的报表文件
- **Filter_Panel（筛选面板）**：报表页面中用于设置筛选条件的 UI 区域
- **SheetJS（xlsx 库）**：后端用于生成 Excel (.xlsx) 文件的 JavaScript 库

## 需求

### 需求 1：报表访问权限控制

**用户故事：** 作为系统，我希望仅允许 SuperAdmin 访问报表功能，以便保护敏感的业务数据。

#### 验收标准

1. IF 请求者不拥有 SuperAdmin 角色, THEN THE Report_Service SHALL 返回 HTTP 403 状态码、错误码 FORBIDDEN 和消息"需要超级管理员权限"
2. THE Report_Page SHALL 仅在用户拥有 SuperAdmin 角色时在管理面板导航中可见
3. IF 非 SuperAdmin 用户尝试直接访问 /pages/admin/reports 路由, THEN THE Report_Page SHALL 重定向到管理面板首页

### 需求 2：积分明细报表查询

**用户故事：** 作为 SuperAdmin，我希望查看所有积分记录的详细信息，以便了解积分的获取和消费情况。

#### 验收标准

1. WHEN SuperAdmin 请求积分明细报表, THE Report_Service SHALL 从 PointsRecords_Table 查询积分记录，每条记录包含以下字段：时间（createdAt）、积分数额（amount）、类型（type，earn 或 spend）、来源（source）、所属 UG（activityUG）、活动主题（activityTopic）、活动 ID（activityId）、目标身份（targetRole）、用户昵称（通过 userId 关联 Users_Table 获取 nickname）、发放者昵称（通过 activityId 和 targetRole 关联 BatchDistributions_Table 获取 distributorNickname）
2. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 createdAt 时间范围筛选，ISO 8601 日期格式）、ugName（按 activityUG 筛选）、targetRole（按目标身份筛选，取值为 UserGroupLeader、Speaker 或 Volunteer）、activityId（按活动 ID 筛选）、type（按积分类型筛选，取值为 earn、spend 或 all，默认 all）
3. THE Report_Service SHALL 按 createdAt 倒序排列返回结果
4. THE Report_Service SHALL 支持分页查询，默认每页 20 条，最大 100 条，使用 lastKey 游标分页
5. IF 未提供任何筛选条件, THEN THE Report_Service SHALL 返回最近 30 天的积分记录

### 需求 3：积分明细报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看积分明细数据并进行筛选，以便快速定位特定的积分记录。

#### 验收标准

1. THE Report_Page SHALL 在积分明细报表 Tab 中显示 Filter_Panel，包含以下筛选控件：时间范围选择器（开始日期和结束日期）、UG 下拉选择器（从 UGs_Table 加载 active 状态的 UG 列表）、身份下拉选择器（选项为 UserGroupLeader、Speaker、Volunteer 和全部）、活动下拉选择器（从 Activities_Table 加载活动列表，显示活动主题）、类型下拉选择器（选项为 earn、spend 和全部）
2. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新报表数据
3. THE Report_Page SHALL 以表格形式展示积分明细数据，列包含：时间、用户昵称、积分数额、类型标签（earn 为绿色、spend 为红色）、来源、所属 UG、活动主题、目标身份、发放者昵称
4. THE Report_Page SHALL 支持滚动加载更多数据（基于 lastKey 分页）
5. WHILE 数据加载中, THE Report_Page SHALL 显示加载状态指示器

### 需求 4：UG 活跃度汇总报表查询

**用户故事：** 作为 SuperAdmin，我希望按 UG 维度查看活跃度统计数据，以便评估各 UG 的运营情况。

#### 验收标准

1. WHEN SuperAdmin 请求 UG 活跃度汇总报表, THE Report_Service SHALL 聚合统计以下数据：UG 名称（ugName）、活动数量（该 UG 在时间范围内关联的不同 activityId 数量）、发放积分总额（该 UG 在时间范围内所有 earn 类型积分记录的 amount 总和）、参与人数（该 UG 在时间范围内涉及的不同 userId 数量）
2. THE Report_Service SHALL 支持 startDate 和 endDate 时间范围筛选（基于 PointsRecords_Table 的 createdAt 字段）
3. THE Report_Service SHALL 按发放积分总额倒序排列返回结果
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回最近 30 天的汇总数据

### 需求 5：UG 活跃度汇总报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看 UG 活跃度汇总数据，以便直观了解各 UG 的表现。

#### 验收标准

1. THE Report_Page SHALL 在 UG 活跃度汇总 Tab 中显示 Filter_Panel，包含时间范围选择器（开始日期和结束日期）
2. THE Report_Page SHALL 以表格形式展示 UG 活跃度汇总数据，列包含：UG 名称、活动数量、发放积分总额、参与人数
3. WHEN SuperAdmin 修改时间范围, THE Report_Page SHALL 自动重新查询并刷新汇总数据

### 需求 6：用户积分排行报表查询

**用户故事：** 作为 SuperAdmin，我希望查看用户积分排行数据，以便了解积分获取最多的用户。

#### 验收标准

1. WHEN SuperAdmin 请求用户积分排行报表, THE Report_Service SHALL 聚合统计以下数据：用户昵称（nickname，关联 Users_Table）、用户 ID（userId）、获取积分总额（时间范围内所有 earn 类型积分记录的 amount 总和）、身份（targetRole）
2. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 createdAt 时间范围筛选）、targetRole（按身份筛选，取值为 UserGroupLeader、Speaker、Volunteer 或 all，默认 all）
3. THE Report_Service SHALL 按获取积分总额倒序排列返回结果
4. THE Report_Service SHALL 支持分页查询，默认每页 50 条，最大 100 条
5. IF 未提供时间范围, THEN THE Report_Service SHALL 返回最近 30 天的排行数据

### 需求 7：用户积分排行报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看用户积分排行，以便快速识别高积分用户。

#### 验收标准

1. THE Report_Page SHALL 在用户积分排行 Tab 中显示 Filter_Panel，包含时间范围选择器和身份下拉选择器（选项为 UserGroupLeader、Speaker、Volunteer 和全部）
2. THE Report_Page SHALL 以表格形式展示用户积分排行数据，列包含：排名序号、用户昵称、获取积分总额、身份标签
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新排行数据
4. THE Report_Page SHALL 支持滚动加载更多数据

### 需求 8：活动积分汇总报表查询

**用户故事：** 作为 SuperAdmin，我希望按活动维度查看积分发放统计数据，以便了解每场活动的积分分配情况。

#### 验收标准

1. WHEN SuperAdmin 请求活动积分汇总报表, THE Report_Service SHALL 聚合统计以下数据：活动主题（activityTopic）、活动 ID（activityId）、活动日期（activityDate）、所属 UG（activityUG）、发放积分总额（该活动所有 earn 类型积分记录的 amount 总和）、涉及人数（该活动涉及的不同 userId 数量）、各身份分布（按 targetRole 分组统计人数：UserGroupLeader 人数、Speaker 人数、Volunteer 人数）
2. THE Report_Service SHALL 支持以下筛选条件：startDate 和 endDate（按 PointsRecords_Table 的 createdAt 时间范围筛选）、ugName（按 activityUG 筛选）
3. THE Report_Service SHALL 按活动日期倒序排列返回结果
4. IF 未提供时间范围, THEN THE Report_Service SHALL 返回最近 30 天的汇总数据

### 需求 9：活动积分汇总报表界面

**用户故事：** 作为 SuperAdmin，我希望在报表页面中查看活动积分汇总数据，以便直观了解每场活动的积分分配。

#### 验收标准

1. THE Report_Page SHALL 在活动积分汇总 Tab 中显示 Filter_Panel，包含时间范围选择器和 UG 下拉选择器
2. THE Report_Page SHALL 以表格形式展示活动积分汇总数据，列包含：活动主题、活动日期、所属 UG、发放积分总额、涉及人数、UGL 人数、Speaker 人数、Volunteer 人数
3. WHEN SuperAdmin 修改筛选条件, THE Report_Page SHALL 自动重新查询并刷新汇总数据

### 需求 10：报表数据导出 — 文件生成

**用户故事：** 作为 SuperAdmin，我希望将报表数据导出为文件，以便离线分析和分享。

#### 验收标准

1. WHEN SuperAdmin 请求导出报表, THE Export_Service SHALL 根据当前报表类型和筛选条件查询完整数据集（不受分页限制）
2. THE Export_Service SHALL 支持两种导出格式：CSV（纯文本逗号分隔，UTF-8 BOM 编码以兼容 Excel 打开中文）和 Excel（.xlsx 格式，使用 SheetJS 库生成）
3. THE Export_Service SHALL 将生成的文件上传至 IMAGES_BUCKET，文件路径格式为 exports/{reportType}/{timestamp}_{randomId}.{csv|xlsx}
4. THE Export_Service SHALL 为上传的文件生成预签名下载 URL，有效期为 30 分钟
5. THE Export_Service SHALL 返回预签名 URL 给前端供用户下载
6. WHILE 导出文件生成中, THE Export_Service SHALL 在响应中返回处理状态，前端显示导出进度

### 需求 11：报表数据导出 — 大数据量处理

**用户故事：** 作为系统，我希望导出功能能够处理大数据量场景，以便在数据量较大时仍能正常导出。

#### 验收标准

1. THE Export_Service SHALL 使用分页查询方式从 DynamoDB 获取数据，每次查询最多 1000 条记录，循环获取直到数据完整
2. THE Export_Service SHALL 在单次导出中限制最大记录数为 50000 条，超出时返回错误码 EXPORT_LIMIT_EXCEEDED 和消息"导出数据量超过限制，请缩小筛选范围"
3. THE Export_Service SHALL 在 Lambda 执行时间接近 15 分钟超时限制前（预留 1 分钟缓冲），中止处理并返回错误码 EXPORT_TIMEOUT 和消息"导出超时，请缩小筛选范围后重试"

### 需求 12：报表数据导出 — 前端交互

**用户故事：** 作为 SuperAdmin，我希望在报表页面中方便地触发导出操作，以便快速获取报表文件。

#### 验收标准

1. THE Report_Page SHALL 在每个报表 Tab 的 Filter_Panel 旁显示导出按钮，提供 CSV 和 Excel 两种格式选项
2. WHEN SuperAdmin 点击导出按钮并选择格式, THE Report_Page SHALL 调用导出接口并显示"正在生成报表文件..."的加载提示
3. WHEN 导出接口返回预签名 URL, THE Report_Page SHALL 自动触发浏览器下载（通过 window.open 或 a 标签 download）
4. IF 导出失败, THEN THE Report_Page SHALL 显示具体错误信息（如数据量超限、超时等）
5. WHILE 导出进行中, THE Report_Page SHALL 禁用导出按钮以防止重复请求

### 需求 13：积分明细报表导出字段

**用户故事：** 作为 SuperAdmin，我希望导出的积分明细报表包含完整的字段信息，以便进行详细的离线分析。

#### 验收标准

1. THE Export_Service SHALL 在积分明细报表导出文件中包含以下列：时间（createdAt，格式化为 YYYY-MM-DD HH:mm:ss）、用户昵称（nickname）、积分数额（amount）、类型（type，显示为"获取"或"消费"）、来源（source）、所属 UG（activityUG）、活动主题（activityTopic）、目标身份（targetRole）、发放者昵称（distributorNickname）
2. THE Export_Service SHALL 在 Excel 格式中为表头行设置加粗样式
3. THE Export_Service SHALL 在 CSV 格式中使用中文列名作为表头

### 需求 14：UG 活跃度汇总报表导出字段

**用户故事：** 作为 SuperAdmin，我希望导出的 UG 活跃度汇总报表包含完整的统计字段。

#### 验收标准

1. THE Export_Service SHALL 在 UG 活跃度汇总报表导出文件中包含以下列：UG 名称（ugName）、活动数量（activityCount）、发放积分总额（totalPoints）、参与人数（participantCount）
2. THE Export_Service SHALL 在 Excel 格式中为表头行设置加粗样式
3. THE Export_Service SHALL 在 CSV 格式中使用中文列名作为表头

### 需求 15：用户积分排行报表导出字段

**用户故事：** 作为 SuperAdmin，我希望导出的用户积分排行报表包含完整的排行信息。

#### 验收标准

1. THE Export_Service SHALL 在用户积分排行报表导出文件中包含以下列：排名（rank）、用户昵称（nickname）、用户 ID（userId）、获取积分总额（totalEarnPoints）、身份（targetRole）
2. THE Export_Service SHALL 在 Excel 格式中为表头行设置加粗样式
3. THE Export_Service SHALL 在 CSV 格式中使用中文列名作为表头

### 需求 16：活动积分汇总报表导出字段

**用户故事：** 作为 SuperAdmin，我希望导出的活动积分汇总报表包含完整的活动统计信息。

#### 验收标准

1. THE Export_Service SHALL 在活动积分汇总报表导出文件中包含以下列：活动主题（activityTopic）、活动日期（activityDate）、所属 UG（activityUG）、发放积分总额（totalPoints）、涉及人数（participantCount）、UGL 人数（uglCount）、Speaker 人数（speakerCount）、Volunteer 人数（volunteerCount）
2. THE Export_Service SHALL 在 Excel 格式中为表头行设置加粗样式
3. THE Export_Service SHALL 在 CSV 格式中使用中文列名作为表头

### 需求 17：报表页面 Tab 导航

**用户故事：** 作为 SuperAdmin，我希望在报表页面中通过 Tab 切换不同类型的报表，以便快速浏览各类数据。

#### 验收标准

1. THE Report_Page SHALL 提供四个 Tab 标签：积分明细、UG 活跃度、用户排行、活动汇总
2. WHEN SuperAdmin 切换 Tab, THE Report_Page SHALL 加载对应报表的筛选面板和数据表格
3. THE Report_Page SHALL 在 Tab 切换时保留各 Tab 独立的筛选条件状态
4. THE Report_Page SHALL 默认显示积分明细 Tab

### 需求 18：API 路由与后端接口

**用户故事：** 作为开发者，我希望在 Admin Lambda 中注册报表相关的 API 路由，以便前端能够调用报表查询和导出接口。

#### 验收标准

1. THE Admin_Handler SHALL 注册以下 API 路由：
   - GET /api/admin/reports/points-detail（查询积分明细报表）
   - GET /api/admin/reports/ug-activity-summary（查询 UG 活跃度汇总报表）
   - GET /api/admin/reports/user-points-ranking（查询用户积分排行报表）
   - GET /api/admin/reports/activity-points-summary（查询活动积分汇总报表）
   - POST /api/admin/reports/export（触发报表导出，请求体包含 reportType 和 format 字段）
2. THE Admin_Handler SHALL 对所有报表路由执行 SuperAdmin 权限校验
3. THE Admin_Handler SHALL 将筛选条件通过 query string 参数传递（GET 请求）或 request body 传递（POST 请求）

### 需求 19：CDK 基础设施配置

**用户故事：** 作为开发者，我希望在 CDK 中配置报表功能所需的 API Gateway 路由和 Lambda 权限，以便基础设施自动化部署。

#### 验收标准

1. THE CDK_Stack SHALL 在 API Gateway 中注册需求 18 中定义的所有报表路由，集成到 Admin Lambda
2. THE CDK_Stack SHALL 为 Admin Lambda 授予 IMAGES_BUCKET 的 s3:PutObject 权限（用于上传导出文件）和 s3:GetObject 权限（用于生成预签名 URL）
3. THE CDK_Stack SHALL 确保 Admin Lambda 已有的 PointsRecords_Table、BatchDistributions_Table、Users_Table、Activities_Table、UGs_Table 读取权限满足报表查询需求
4. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 20：国际化支持

**用户故事：** 作为用户，我希望报表功能的界面文案支持多语言，以便不同语言的管理员都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为报表功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：报表页面标题和 Tab 标签、各报表的筛选面板标签（时间范围、UG、身份、活动、类型）、表格列名、导出按钮和格式选项、加载状态和错误提示、空数据状态提示
