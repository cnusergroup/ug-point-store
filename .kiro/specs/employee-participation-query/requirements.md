# Requirements Document

> 需求文档：员工活动参与度查询（Employee Participation Query）

## Introduction

新增一个独立的、面向外部查询方的"员工活动参与度查询"功能。该功能提供一个独立于商城用户体系的登录入口，使用固定账号密码登录后，可查询 AWS 员工（`isEmployee: true`）作为 Speaker 或 Volunteer 支持活动的统计数据，包含四类数据视图：Speaker 支持次数、志愿者支持次数、员工活动支持总计（按人去重后的活动数）、以及活动支持记录明细（按活动维度列出参与员工及身份）。查询登录密码由 SuperAdmin 在现有管理后台设置页中维护。

## Glossary

- **Participation_Query_System**：员工活动参与度查询系统，本功能的整体指代
- **Query_Credential**：查询登录凭证，全局唯一一组账号密码，存储在独立的 DynamoDB 表中，用于外部查询方登录
- **Query_Login_Page**：查询登录页面，独立于商城用户登录页面的新页面，供外部查询方输入 Query_Credential 登录
- **Query_Session**：查询会话，登录成功后颁发的会话凭证（token），有效期为 24 小时
- **Query_Dashboard**：查询主页面，登录成功后展示四类数据视图的页面
- **Employee_User**：员工用户，Users 表中 `isEmployee` 字段为 `true` 的用户
- **Speaker_Support_Record**：Speaker 支持记录，PointsRecords 表或 BatchDistributions 表中 `targetRole='Speaker'` 且关联用户为 Employee_User 的记录
- **Volunteer_Support_Record**：志愿者支持记录，PointsRecords 表或 BatchDistributions 表中 `targetRole='Volunteer'` 且关联用户为 Employee_User 的记录
- **Speaker_Support_Count_View**：Speaker 支持次数视图，按员工聚合，统计每位 Employee_User 作为 Speaker 支持的活动数量（按 `activityId` 去重）
- **Volunteer_Support_Count_View**：志愿者支持次数视图，按员工聚合，统计每位 Employee_User 作为志愿者支持的活动数量（按 `activityId` 去重）
- **Employee_Activity_Summary_View**：员工活动支持总计视图，按员工聚合，统计每位 Employee_User 支持的活动总数量（Speaker 与 Volunteer 角色的 `activityId` 合并去重后计数，不区分角色）
- **Activity_Support_Detail_View**：活动支持记录明细视图，按活动聚合，列出每个活动被哪些 Employee_User 以何种身份（Speaker/Volunteer）支持
- **Query_Auth_Middleware**：查询鉴权中间件，校验请求携带的 Query_Session 是否有效

## Requirements

### Requirement 1: 查询凭证存储

**User Story:** 作为系统，我希望有一个独立的数据表存储查询登录凭证，以便与商城用户账号体系完全隔离。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 将 Query_Credential 存储在一个独立的 DynamoDB 表中，与 Users 表分离
2. THE Query_Credential SHALL 包含一个作为分区键的用户名字段（长度不超过 64 字符）和一个使用哈希算法加密存储的密码字段
3. WHEN Query_Credential 表中不存在任何记录时，THE Participation_Query_System SHALL 使用预设的初始用户名和经哈希处理的初始密码创建默认记录
4. THE Query_Credential 的密码字段 SHALL 在创建、更新等所有写入场景下均不以明文形式存储
5. THE Participation_Query_System SHALL 确保 Query_Credential 的密码字段（无论明文或哈希形式）不出现在任何 API 响应中
6. IF 系统在启动时检测到 Query_Credential 记录中的密码字段不符合系统预定义的哈希格式规则，THEN THE Participation_Query_System SHALL 拒绝启动、记录错误日志、保留现有数据不做任何修改，并要求人工介入处理

### Requirement 2: SuperAdmin 维护查询密码

**User Story:** 作为 SuperAdmin，我希望能在现有管理后台设置页面中修改查询登录密码，以便控制外部查询方的访问凭证。

#### Acceptance Criteria

1. WHILE 当前登录用户角色为 SuperAdmin 时，THE 管理后台设置页面 SHALL 提供修改 Query_Credential 密码的入口
2. WHILE 当前登录用户角色不为 SuperAdmin 时，THE 管理后台设置页面 SHALL 不展示修改 Query_Credential 密码的入口
3. WHEN SuperAdmin 提交新密码时，THE Participation_Query_System SHALL 校验新密码长度不少于 8 个字符且同时包含至少一个字母和一个数字后更新 Query_Credential
4. IF 提交的新密码长度小于 8 个字符，或未同时包含至少一个字母和一个数字，THEN THE Participation_Query_System SHALL 返回验证错误并不更新 Query_Credential
5. THE 修改查询密码接口 SHALL 仅允许 SuperAdmin 角色调用
6. IF 非 SuperAdmin 角色的用户调用修改查询密码接口，THEN THE Participation_Query_System SHALL 拒绝该请求并返回未授权错误，且不更新 Query_Credential
7. WHEN SuperAdmin 成功修改查询密码后，THE Participation_Query_System SHALL 使所有已存在的 Query_Session 失效

### Requirement 3: 查询登录页面与身份验证

**User Story:** 作为外部查询方，我希望通过一个独立的登录页面输入固定账号密码进行登录，以便访问员工活动参与度数据。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 提供一个独立的 Query_Login_Page，其访问路径与商城用户登录页面不同，且不与商城用户登录表单共享任何 UI 组件
2. WHEN 外部查询方在 Query_Login_Page 提交用户名（长度不超过 64 字符）和密码（长度不超过 64 字符）且校验通过时，THE Participation_Query_System SHALL 颁发一个有效期为 24 小时的 Query_Session 并跳转至 Query_Dashboard
3. IF 外部查询方提交的用户名或密码不正确，THEN THE Participation_Query_System SHALL 返回统一的身份验证失败错误（不区分是用户名错误还是密码错误），且不颁发 Query_Session
4. THE Query_Login_Page SHALL 不与商城用户账号体系（Users 表登录）产生任何交互

### Requirement 4: 查询会话保护与失效处理

**User Story:** 作为系统，我希望所有查询数据接口都受 Query_Session 保护，以避免未授权访问。

#### Acceptance Criteria

1. IF 请求访问任意查询数据接口时未携带 Query_Session，或所携带的 Query_Session 格式无法被识别，THEN THE Query_Auth_Middleware SHALL 返回未授权错误（HTTP 401）
2. IF Query_Session 已超过 24 小时有效期，THEN THE Query_Auth_Middleware SHALL 视其为失效并返回未授权错误（HTTP 401）
3. IF Query_Session 已被显式吊销（包括因 SuperAdmin 修改查询密码导致其失效的情形），THEN THE Query_Auth_Middleware SHALL 视其为失效并返回未授权错误（HTTP 401）
4. IF Query_Session 未超过 24 小时有效期、未被显式吊销，且格式可被正确识别，THEN THE Query_Auth_Middleware SHALL 允许请求继续访问查询数据接口
5. WHEN Query_Dashboard 收到查询数据接口返回的未授权错误（HTTP 401）时，THE Query_Dashboard SHALL 清除本地保存的 Query_Session 并将用户重定向至 Query_Login_Page

### Requirement 5: 登录失败保护

**User Story:** 作为系统，我希望对查询登录接口的连续失败尝试进行限制，以降低固定账号密码被暴力破解的风险。

#### Acceptance Criteria

1. WHEN 同一来源（以客户端 IP 地址标识）在 15 分钟滑动窗口内针对 Query_Login_Page 累计提交 5 次错误密码时，THE Participation_Query_System SHALL 将该来源对 Query_Login_Page 的登录能力锁定 15 分钟，且该锁定不影响其他来源提交的登录请求
2. WHILE 一个来源处于锁定状态时，THE Participation_Query_System SHALL 拒绝该来源提交的任何登录请求（无论用户名和密码是否正确），不颁发 Query_Session，并在响应中返回账号锁定错误及剩余锁定时长
3. WHEN 一个未处于锁定状态的来源使用正确的用户名和密码登录成功后，THE Participation_Query_System SHALL 将该来源的失败计数重置为 0

### Requirement 6: Speaker 支持次数查询

**User Story:** 作为外部查询方，我希望查询每位员工作为 Speaker 支持了多少次活动，以便了解 Speaker 层面的参与度。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 提供 Speaker_Support_Count_View，其中每位符合展示条件的 Employee_User 最多出现 1 行，展示该员工在 Users 表中的当前花名、当前邮箱，及其作为 Speaker 支持的活动数量
2. THE Speaker_Support_Count_View 中的活动数量 SHALL 按 `activityId` 去重计算：无论该 Employee_User 的 Speaker_Support_Record 来自 PointsRecords 表或 BatchDistributions 表，同一 `activityId` 的多条记录仅计为 1 次支持
3. IF 一位 Employee_User 按上述规则计算得到的 Speaker 支持次数为 0，THEN THE Speaker_Support_Count_View SHALL 不展示该员工
4. FOR ALL 展示在 Speaker_Support_Count_View 中的员工，THE 支持次数字段 SHALL 为正整数

### Requirement 7: 志愿者支持次数查询

**User Story:** 作为外部查询方，我希望查询每位员工作为志愿者支持了多少次活动，以便了解志愿者层面的参与度。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 提供 Volunteer_Support_Count_View，展示每位 Employee_User 的花名、邮箱，以及其以志愿者身份获得活动积分的去重活动数量（即"志愿者支持次数"）
2. THE Volunteer_Support_Count_View 中的活动数量 SHALL 按 `activityId` 去重计算，同一活动多次发放积分仅计为 1 次支持
3. IF 一位 Employee_User 的志愿者支持次数计算结果为 0，THEN THE Volunteer_Support_Count_View SHALL 不展示该员工
4. THE Volunteer_Support_Count_View 中展示的每位员工的支持次数字段 SHALL 为大于或等于 1 的正整数

### Requirement 8: 员工活动支持总计查询

**User Story:** 作为外部查询方，我希望查询每位员工总共支持了多少个不同的活动（不区分 Speaker 或志愿者身份），以便了解员工整体参与度。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 提供 Employee_Activity_Summary_View，展示每位 Employee_User 的花名、邮箱，及其支持的活动总数量
2. THE Employee_Activity_Summary_View 中的活动总数量 SHALL 为该员工的 Speaker_Support_Record 与 Volunteer_Support_Record 的 `activityId` 合并后去重计算的结果
3. WHILE 一位 Employee_User 同一活动既担任 Speaker 又担任志愿者时，THE Employee_Activity_Summary_View SHALL 将该活动计为 1 次支持
4. WHEN 一位 Employee_User 的活动总数量计算结果为 0 时，THE Employee_Activity_Summary_View SHALL 不展示该员工
5. FOR ALL 展示在 Employee_Activity_Summary_View 中的员工，THE 活动总数量字段 SHALL 为正整数

### Requirement 9: 活动支持记录明细查询

**User Story:** 作为外部查询方，我希望按活动维度查询每个活动有哪些员工以什么身份参与支持，以便了解单个活动的员工参与情况。

#### Acceptance Criteria

1. THE Participation_Query_System SHALL 提供 Activity_Support_Detail_View，按活动维度展示活动信息（活动 ID、主题、所属 UG、活动日期）及支持该活动的员工列表；活动列表 SHALL 按活动日期降序排列，每个活动关联的员工列表 SHALL 按花名字母顺序排列
2. FOR ALL 展示在 Activity_Support_Detail_View 中的活动，THE 员工列表 SHALL 包含每位参与员工的花名、邮箱及其参与身份（Speaker 或志愿者，或两者）
3. IF 一位 Employee_User 在同一活动中既担任 Speaker 又担任志愿者，THEN THE Activity_Support_Detail_View SHALL 在该员工的参与身份中同时标明 Speaker 和志愿者
4. IF 一个活动没有任何 Employee_User 参与支持，THEN THE Activity_Support_Detail_View SHALL 不展示该活动
5. WHERE 查询请求包含活动 ID、活动主题关键字或活动日期范围时，THE Activity_Support_Detail_View SHALL 仅返回匹配该条件的活动
6. IF 按活动 ID、活动主题关键字或活动日期范围查询未匹配到任何活动，THEN THE Participation_Query_System SHALL 返回空结果列表并提示未找到匹配活动，而非返回错误
7. THE Activity_Support_Detail_View SHALL 每页最多展示 50 个活动，并提供分页导航以查看更多活动

### Requirement 10: 按员工搜索

**User Story:** 作为外部查询方，我希望能按员工花名或邮箱搜索，以便快速定位特定员工的参与度数据。

#### Acceptance Criteria

1. IF 查询请求包含长度为 1-100 字符的搜索关键字，THEN THE Speaker_Support_Count_View、Volunteer_Support_Count_View 及 Employee_Activity_Summary_View SHALL 仅返回花名或邮箱包含该关键字（去除首尾空白后按不区分大小写的连续子字符串匹配）的员工记录
2. IF 搜索关键字长度超过 100 字符，THEN THE Participation_Query_System SHALL 返回参数校验错误
3. IF 查询请求未包含搜索关键字或搜索关键字为空，THEN THE Speaker_Support_Count_View、Volunteer_Support_Count_View 及 Employee_Activity_Summary_View SHALL 返回全部符合条件的员工记录，不做关键字过滤
4. WHEN 搜索关键字未匹配到任何员工记录时，THE Participation_Query_System SHALL 返回空结果列表，而非错误

### Requirement 11: 按时间范围筛选

**User Story:** 作为外部查询方，我希望按时间范围筛选活动参与度数据，以便查看特定时期的支持情况。

#### Acceptance Criteria

1. IF 查询请求同时提供开始日期和结束日期（均为符合 ISO 8601 格式即 YYYY-MM-DD 的有效日期），THEN THE Participation_Query_System SHALL 仅统计活动日期在开始日期（含）至结束日期（含）范围内的 Speaker_Support_Record、Volunteer_Support_Record 及对应活动
2. IF 查询请求未提供开始日期且未提供结束日期，THEN THE Participation_Query_System SHALL 默认统计所有历史数据
3. IF 提供的开始日期晚于结束日期，THEN THE Participation_Query_System SHALL 返回参数校验错误，且不执行任何数据统计、不返回部分结果
4. IF 查询请求仅提供开始日期或仅提供结束日期，而未同时提供两者，THEN THE Participation_Query_System SHALL 返回参数校验错误，且不执行任何数据统计
5. IF 提供的开始日期或结束日期不符合 ISO 8601 日期格式（YYYY-MM-DD）或并非有效日期，THEN THE Participation_Query_System SHALL 返回参数校验错误，且不执行任何数据统计

### Requirement 12: 数据范围与员工身份过滤

**User Story:** 作为外部查询方，我希望四类视图只统计真实员工的数据，以确保"员工活动参与度"统计口径准确。

#### Acceptance Criteria

1. FOR ALL 四类查询视图，THE Participation_Query_System SHALL 仅统计关联用户在 Users 表中当前 `isEmployee` 字段为 `true` 的 Speaker_Support_Record 与 Volunteer_Support_Record（以查询时刻的 `isEmployee` 当前值为准，而非记录创建时的历史值）
2. IF 一条 Speaker_Support_Record 或 Volunteer_Support_Record 关联的用户 `isEmployee` 不为 `true`，或该记录关联的用户账号已不存在于 Users 表中，THEN THE Participation_Query_System SHALL 将该记录排除在所有统计视图之外
3. THE Participation_Query_System SHALL 支持查询 PointsRecords 表与 BatchDistributions 表中现存的全部历史数据，不设时间下限

### Requirement 13: 数据导出

**User Story:** 作为外部查询方，我希望将查询结果导出为文件，以便离线分析或存档。

#### Acceptance Criteria

1. THE Query_Dashboard SHALL 为 Speaker_Support_Count_View、Volunteer_Support_Count_View、Employee_Activity_Summary_View 及 Activity_Support_Detail_View 分别提供导出功能
2. THE Participation_Query_System SHALL 仅支持 CSV 和 Excel 两种格式作为导出文件的可选格式
3. WHEN 外部查询方触发导出操作时，THE Participation_Query_System SHALL 导出当前生效的搜索关键字和时间范围筛选后的数据；IF 当前没有生效的搜索关键字或时间范围筛选，THEN THE Participation_Query_System SHALL 导出全部可用数据
4. IF 搜索关键字和时间范围筛选后没有匹配的数据，THEN THE Participation_Query_System SHALL 导出仅包含字段表头、不含数据行的文件，且系统不将此情况视为导出失败
5. IF 待导出的记录数超过 50,000 条，THEN THE Participation_Query_System SHALL 拒绝生成导出文件，并向外部查询方显示提示信息告知需缩小搜索关键字或时间范围后重试
6. THE 导出文件 SHALL 仅包含与对应视图页面展示一致的字段，字段名称及排列顺序均与对应视图页面一致，且不包含导出时间戳、操作者身份等额外元数据
7. IF 导出过程中发生系统错误导致文件无法生成，THEN THE Participation_Query_System SHALL 向外部查询方显示导出失败的提示信息，且不生成部分或损坏的导出文件

