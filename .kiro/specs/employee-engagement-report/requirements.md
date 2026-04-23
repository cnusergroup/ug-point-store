# 需求文档：活跃员工报表（Employee Engagement Report）

## 简介

在现有报表中心（Reports Page）中新增一个"活跃员工报表"标签页，用于向 AWS 内部汇报员工在社区中的参与情况。系统已有 `isEmployee` 布尔字段标识员工用户（来自 employee-badge 功能）。本报表通过查询员工用户的积分记录，汇总员工的活跃度指标（活跃人数、积分总额、参与活动数等），并提供按员工维度的明细表格，支持日期范围筛选和 CSV/Excel 导出。

## 术语表

- **Reports_Page**：管理员报表中心页面（`packages/frontend/src/pages/admin/reports.tsx`），包含多个报表标签页，当前有 10 个标签页
- **Employee_Engagement_Tab**：活跃员工报表标签页，本功能新增的第 11 个标签页
- **Employee_User**：员工用户，Users 表中 `isEmployee` 字段为 `true` 的用户记录
- **Active_Employee**：活跃员工，在指定日期范围内存在至少一条 type=earn 积分记录的 Employee_User
- **Points_Record**：积分记录，存储在 PointsRecords DynamoDB 表中的一条记录，包含 userId、amount、type、createdAt、activityId、activityUG、targetRole 等字段
- **Summary_Metrics**：汇总指标卡片，展示在报表顶部的统计数据（员工总数、活跃员工数、活跃率、积分总额、参与活动数）
- **Detail_Table**：明细表格，展示每位活跃员工的详细数据（排名、昵称、积分、活动数、最后活跃时间、角色、参与 UG）
- **Report_Export**：报表导出功能，支持将报表数据导出为 CSV 或 Excel 文件
- **Engagement_Query**：活跃员工查询模块，负责从 DynamoDB 查询和聚合员工活跃数据的后端逻辑

## 需求

### 需求 1：报表页面新增活跃员工标签页

**用户故事：** 作为超级管理员，我希望在报表中心看到一个"活跃员工报表"标签页，以便快速访问员工参与度数据。

#### 验收标准

1. THE Reports_Page SHALL 在现有 10 个标签页之后新增一个 Employee_Engagement_Tab，标签名称为"活跃员工"
2. THE Employee_Engagement_Tab SHALL 遵循现有标签页的 UI 布局模式（筛选面板 + 数据表格）
3. THE Employee_Engagement_Tab SHALL 仅对拥有 SuperAdmin 角色的用户可见
4. WHEN 用户切换到 Employee_Engagement_Tab 时，THE Reports_Page SHALL 加载该标签页对应的筛选面板和数据区域

### 需求 2：汇总指标卡片展示

**用户故事：** 作为超级管理员，我希望在活跃员工报表顶部看到关键汇总指标，以便快速了解员工整体参与情况。

#### 验收标准

1. THE Employee_Engagement_Tab SHALL 在数据表格上方展示 Summary_Metrics 卡片区域
2. THE Summary_Metrics SHALL 包含以下五个指标：员工总数、活跃员工数、活跃率、员工积分总额、参与活动数
3. THE "员工总数"指标 SHALL 显示 Users 表中 `isEmployee` 为 `true` 的用户总数
4. THE "活跃员工数"指标 SHALL 显示在筛选日期范围内存在至少一条 type=earn 积分记录的 Employee_User 数量
5. THE "活跃率"指标 SHALL 显示活跃员工数除以员工总数乘以 100% 的百分比值，保留一位小数
6. THE "员工积分总额"指标 SHALL 显示在筛选日期范围内所有 Employee_User 获得的 earn 类型积分总和
7. THE "参与活动数"指标 SHALL 显示在筛选日期范围内所有 Employee_User 参与的不同 activityId 的数量

### 需求 3：活跃员工明细表格

**用户故事：** 作为超级管理员，我希望看到每位活跃员工的详细参与数据，以便了解个人贡献情况。

#### 验收标准

1. THE Detail_Table SHALL 展示在筛选日期范围内有积分记录的每位 Active_Employee 的数据行
2. THE Detail_Table SHALL 包含以下列：排名、昵称、积分总额、参与活动数、最后活跃时间、主要角色、参与 UG 列表
3. THE "排名"列 SHALL 按积分总额降序排列，从 1 开始编号
4. THE "昵称"列 SHALL 显示 Employee_User 的 nickname 字段
5. THE "积分总额"列 SHALL 显示该员工在筛选日期范围内获得的 earn 类型积分总和
6. THE "参与活动数"列 SHALL 显示该员工在筛选日期范围内参与的不同 activityId 的数量
7. THE "最后活跃时间"列 SHALL 显示该员工在筛选日期范围内最近一条积分记录的 createdAt 时间
8. THE "主要角色"列 SHALL 显示该员工积分记录中出现的 targetRole 值（如 Speaker）
9. THE "参与 UG 列表"列 SHALL 显示该员工积分记录中出现的所有不同 activityUG 值，以逗号分隔

### 需求 4：日期范围筛选

**用户故事：** 作为超级管理员，我希望能按日期范围筛选活跃员工数据，以便查看特定时间段的员工参与情况。

#### 验收标准

1. THE Employee_Engagement_Tab 的筛选面板 SHALL 包含开始日期和结束日期两个日期选择器
2. WHEN 用户未选择日期范围时，THE Engagement_Query SHALL 使用默认的最近 30 天作为日期范围
3. WHEN 用户选择了日期范围并触发查询时，THE Engagement_Query SHALL 仅返回该日期范围内的积分记录数据
4. THE 日期范围筛选 SHALL 同时影响 Summary_Metrics 和 Detail_Table 的数据

### 需求 5：后端查询接口

**用户故事：** 作为系统，我希望有一个专用的后端查询接口来获取活跃员工报表数据，以便前端展示和导出使用。

#### 验收标准

1. THE 后端 SHALL 提供一个 `GET /api/admin/reports/employee-engagement` 接口，接受 `startDate` 和 `endDate` 查询参数
2. THE 接口 SHALL 仅允许 SuperAdmin 角色访问，非 SuperAdmin 用户请求时返回 403 错误
3. THE 接口响应 SHALL 包含 `summary` 对象（员工总数、活跃员工数、活跃率、积分总额、参与活动数）和 `records` 数组（每位活跃员工的明细数据）
4. THE Engagement_Query SHALL 通过扫描 Users 表获取所有 `isEmployee: true` 的用户 ID 列表
5. THE Engagement_Query SHALL 通过查询 PointsRecords 表的 `type-createdAt-index` GSI 获取日期范围内的 earn 类型积分记录
6. THE Engagement_Query SHALL 在内存中筛选出属于员工用户的积分记录，并按用户维度聚合
7. IF 查询过程中发生内部错误，THEN THE 接口 SHALL 返回包含错误码和错误消息的 JSON 响应

### 需求 6：员工活跃数据聚合逻辑

**用户故事：** 作为系统，我希望聚合逻辑能正确计算每位员工的活跃指标，以确保报表数据的准确性。

#### 验收标准

1. THE Engagement_Query SHALL 对每位 Active_Employee 计算以下聚合值：积分总额（earn 类型 amount 之和）、参与活动数（不同 activityId 的数量）、最后活跃时间（最大 createdAt 值）、主要角色（targetRole 集合）、参与 UG 列表（不同 activityUG 集合）
2. THE Engagement_Query SHALL 仅统计 type=earn 的积分记录，不包含 type=spend 的记录
3. THE "活跃率"计算 SHALL 使用公式：活跃员工数 / 员工总数 × 100，保留一位小数；当员工总数为 0 时返回 0
4. THE Detail_Table 的排名 SHALL 按积分总额降序排列；积分相同时，按最后活跃时间降序排列
5. FOR ALL 有效的日期范围和员工数据集，汇总指标中的活跃员工数 SHALL 等于明细表格中的数据行数（一致性属性）
6. FOR ALL 有效的日期范围和员工数据集，汇总指标中的积分总额 SHALL 等于明细表格中所有员工积分总额之和（一致性属性）

### 需求 7：报表导出支持

**用户故事：** 作为超级管理员，我希望能将活跃员工报表导出为 CSV 或 Excel 文件，以便在其他工具中进一步分析或提交给 AWS 内部。

#### 验收标准

1. THE Employee_Engagement_Tab 的筛选面板 SHALL 包含"导出 Excel"和"导出 CSV"两个导出按钮
2. WHEN 用户点击导出按钮时，THE Report_Export SHALL 使用当前筛选条件生成对应格式的文件
3. THE 导出文件 SHALL 包含明细表格的所有列数据（排名、昵称、积分总额、参与活动数、最后活跃时间、主要角色、参与 UG 列表）
4. THE Report_Export SHALL 将 `employee-engagement` 注册为有效的报表类型，遵循现有导出流程（生成文件 → 上传 S3 → 返回预签名下载 URL）
5. IF 导出数据量超过 50,000 条记录限制，THEN THE Report_Export SHALL 返回 `EXPORT_LIMIT_EXCEEDED` 错误
6. IF 导出过程接近 Lambda 15 分钟超时，THEN THE Report_Export SHALL 返回 `EXPORT_TIMEOUT` 错误

### 需求 8：格式化与列定义

**用户故事：** 作为系统，我希望导出文件的列定义和格式化逻辑与现有报表保持一致，以确保导出文件的可读性。

#### 验收标准

1. THE 导出列定义 SHALL 包含以下中文列名：排名、用户昵称、积分总额、参与活动数、最后活跃时间、主要角色、参与UG列表
2. THE "最后活跃时间"列 SHALL 格式化为 `YYYY-MM-DD HH:mm:ss` 格式
3. THE "参与UG列表"列 SHALL 将多个 UG 名称以中文逗号（、）分隔
4. THE 格式化函数 SHALL 作为纯函数实现，接受记录数组并返回格式化后的导出行数组

### 需求 9：聚合函数的往返一致性

**用户故事：** 作为系统，我希望聚合函数的输入输出满足数学一致性属性，以确保计算逻辑的正确性。

#### 验收标准

1. FOR ALL 有效的积分记录集合，按用户聚合后的积分总额之和 SHALL 等于原始记录集合中所有 earn 类型 amount 之和（积分守恒属性）
2. FOR ALL 有效的积分记录集合，按用户聚合后的活跃员工数 SHALL 等于原始记录集合中不同 userId 的数量（用户计数一致性）
3. FOR ALL 有效的积分记录集合，每位员工的参与活动数 SHALL 小于或等于该员工的积分记录总数（活动数上界属性）
4. FOR ALL 有效的积分记录集合，每位员工的最后活跃时间 SHALL 大于或等于该员工所有积分记录中的任意 createdAt 值（最大值属性）
5. FOR ALL 有效的员工总数和活跃员工数，活跃率 SHALL 在 0 到 100 之间（含边界值）（百分比范围属性）
