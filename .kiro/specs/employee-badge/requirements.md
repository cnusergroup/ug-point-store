# 需求文档：员工身份标记（Employee Badge）

## 简介

在现有的邀请链接生成流程中，增加一个可选的"员工邀请"标记。当管理员生成邀请链接时，可以勾选该标记，表示此邀请链接是发给内部员工使用的。通过该邀请链接注册的用户，其用户记录中会携带 `isEmployee: true` 字段。此字段不在系统任何 UI 界面中展示，仅用于后端报表导出时区分员工用户与社区用户。

## 术语表

- **Invite_Management_Page**：管理员邀请管理页面（`packages/frontend/src/pages/admin/invites.tsx`），用于生成、查看和撤销邀请链接
- **Invite_Record**：邀请记录，存储在 DynamoDB invites 表中的一条记录，包含 token、角色、状态等信息
- **User_Record**：用户记录，存储在 DynamoDB users 表中的一条记录，包含 userId、角色、积分等信息
- **Registration_Flow**：注册流程，用户通过邀请链接进入注册页面并完成注册的完整流程
- **Report_Export**：报表导出功能，管理员通过后端接口导出用户数据的功能
- **Employee_Flag**：员工标记，一个布尔值字段（`isEmployee`），用于标识用户是否为内部员工

## 需求

### 需求 1：邀请记录存储员工标记

**用户故事：** 作为管理员，我希望邀请记录能存储员工标记信息，以便追踪哪些邀请链接是发给员工的。

#### 验收标准

1. THE Invite_Record SHALL 包含一个可选的布尔字段 `isEmployee`，默认值为 `false`
2. WHEN 管理员生成邀请链接时指定了员工标记，THE Invite_Record SHALL 将 `isEmployee` 字段设置为 `true`
3. WHEN 管理员生成邀请链接时未指定员工标记，THE Invite_Record SHALL 将 `isEmployee` 字段设置为 `false`
4. THE Invite_Record 的 `isEmployee` 字段 SHALL 与现有的 `token`、`roles`、`status` 等字段共存，不影响现有邀请功能

### 需求 2：邀请生成界面增加员工标记开关

**用户故事：** 作为管理员，我希望在生成邀请链接时能勾选"员工邀请"选项，以便为内部员工生成专用邀请链接。

#### 验收标准

1. THE Invite_Management_Page 的生成表单 SHALL 在角色选择区域下方显示一个"员工邀请"开关（toggle/checkbox）
2. WHEN 管理员未操作该开关时，THE Invite_Management_Page SHALL 默认该开关为关闭状态
3. WHEN 管理员开启"员工邀请"开关并点击生成按钮，THE Invite_Management_Page SHALL 在请求中携带 `isEmployee: true` 参数
4. WHEN 管理员关闭"员工邀请"开关并点击生成按钮，THE Invite_Management_Page SHALL 在请求中携带 `isEmployee: false` 参数或不携带该参数

### 需求 3：邀请列表展示员工标记

**用户故事：** 作为管理员，我希望在邀请列表中能看到哪些邀请是员工邀请，以便快速区分。

#### 验收标准

1. WHEN 邀请记录的 `isEmployee` 为 `true` 时，THE Invite_Management_Page SHALL 在该邀请行中显示一个"员工"标签
2. WHEN 邀请记录的 `isEmployee` 为 `false` 或未定义时，THE Invite_Management_Page SHALL 不显示"员工"标签
3. THE "员工"标签 SHALL 与现有的角色徽章（role badge）在视觉上有所区分，使用不同的样式

### 需求 4：批量生成接口支持员工标记参数

**用户故事：** 作为管理员，我希望批量生成邀请链接的接口能接受员工标记参数，以便一次性生成多个员工邀请链接。

#### 验收标准

1. THE 批量生成接口（`POST /api/admin/invites/batch`）SHALL 接受一个可选的 `isEmployee` 布尔参数
2. WHEN 请求中包含 `isEmployee: true`，THE 批量生成接口 SHALL 为所有生成的邀请记录设置 `isEmployee: true`
3. WHEN 请求中未包含 `isEmployee` 参数或值为 `false`，THE 批量生成接口 SHALL 为所有生成的邀请记录设置 `isEmployee: false`
4. THE 批量生成接口的响应 SHALL 在每条邀请记录中包含 `isEmployee` 字段

### 需求 5：注册流程传递员工标记

**用户故事：** 作为系统，我希望用户通过员工邀请链接注册时，其用户记录能自动携带员工标记，以便后续报表区分。

#### 验收标准

1. WHEN 用户通过 `isEmployee: true` 的邀请链接注册时，THE Registration_Flow SHALL 在创建的 User_Record 中设置 `isEmployee: true`
2. WHEN 用户通过 `isEmployee: false` 或无员工标记的邀请链接注册时，THE Registration_Flow SHALL 不在 User_Record 中设置 `isEmployee` 字段，或设置为 `false`
3. THE Registration_Flow SHALL 在验证邀请 token 时同时读取 `isEmployee` 字段，并将其传递到用户创建步骤
4. IF 邀请记录中不存在 `isEmployee` 字段（旧数据兼容），THEN THE Registration_Flow SHALL 将其视为 `false`

### 需求 6：员工标记不在 UI 中展示

**用户故事：** 作为产品负责人，我希望员工标记仅用于后端报表，不在系统的任何用户界面中展示，以避免对社区用户造成困惑。

#### 验收标准

1. THE 用户列表页面 SHALL 不显示用户的 `isEmployee` 字段
2. THE 用户个人资料页面 SHALL 不显示用户的 `isEmployee` 字段
3. THE 角色徽章组件 SHALL 不因 `isEmployee` 字段而产生任何视觉变化
4. THE 积分排行榜 SHALL 不因 `isEmployee` 字段而对用户进行区分展示

### 需求 7：报表导出支持员工标记筛选

**用户故事：** 作为管理员，我希望在导出报表时能根据员工标记筛选用户，以便分析员工与社区用户的数据差异。

#### 验收标准

1. THE Report_Export SHALL 在导出的用户数据中包含 `isEmployee` 字段
2. WHEN 管理员请求导出报表时指定 `isEmployee` 筛选条件，THE Report_Export SHALL 仅导出符合条件的用户数据
3. WHEN 管理员请求导出报表时未指定 `isEmployee` 筛选条件，THE Report_Export SHALL 导出所有用户数据（包含 `isEmployee` 字段）

### 需求 8：数据向后兼容

**用户故事：** 作为系统，我希望新增的员工标记字段与现有数据完全兼容，不影响已有用户和邀请记录的正常使用。

#### 验收标准

1. THE 现有的 Invite_Record（不含 `isEmployee` 字段）SHALL 继续正常工作，不受新字段影响
2. THE 现有的 User_Record（不含 `isEmployee` 字段）SHALL 继续正常工作，不受新字段影响
3. WHEN 系统读取不含 `isEmployee` 字段的记录时，THE 系统 SHALL 将其默认视为 `false`
4. FOR ALL 现有的邀请记录和用户记录，解析后再序列化 SHALL 产生等价的对象（round-trip 属性）
