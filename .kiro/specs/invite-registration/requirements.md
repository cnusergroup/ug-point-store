# 需求文档：邀请制注册（Invite Registration）

## 简介

本功能将系统注册方式从开放注册改为邀请制注册。只有持有管理员颁发的有效邀请链接的用户才能完成注册。每条邀请链接包含唯一 Token，自创建起 24 小时后失效，且一旦被使用即立即失效（一次性）。管理员可批量生成指定 UserRole 的邀请链接，并通过专属管理界面查看和管理所有邀请记录。

## 词汇表

- **Invite_System**：邀请制注册系统，负责邀请链接的生成、验证与失效管理。
- **Admin**：拥有 `Admin` 或 `SuperAdmin` 角色的用户，有权生成和管理邀请链接。
- **Invite_Token**：邀请链接中携带的唯一标识符，用于标识一条邀请记录。
- **Invite_Link**：包含 Invite_Token 的完整注册 URL，发送给被邀请用户。
- **Invite_Record**：存储在数据库中的邀请记录，包含 Token、目标角色、状态、过期时间等信息。
- **Registration_Page**：用户通过 Invite_Link 访问的注册页面，需携带有效 Token 才能提交注册。
- **UserRole**：系统中定义的用户角色，包括 `UserGroupLeader`、`CommunityBuilder`、`Speaker`、`Volunteer`。
- **Invite_Status**：邀请记录的状态，取值为 `pending`（待使用）、`used`（已使用）、`expired`（已过期）。

---

## 需求

### 需求 1：邀请链接生成

**用户故事：** 作为管理员，我希望批量生成指定 UserRole 的邀请链接，以便将其分发给对应身份的被邀请用户。

#### 验收标准

1. WHEN 管理员提交批量生成请求（包含数量和目标 UserRole），THE Invite_System SHALL 生成指定数量的 Invite_Record，每条记录包含唯一 Invite_Token、目标 UserRole、创建时间和过期时间（创建时间 + 24 小时）。
2. THE Invite_System SHALL 为每条 Invite_Record 生成对应的 Invite_Link，格式为 `{REGISTER_BASE_URL}?token={Invite_Token}`。
3. WHEN 批量生成请求中的数量小于 1 或大于 100，THE Invite_System SHALL 返回参数无效错误。
4. WHEN 批量生成请求中的 UserRole 不属于合法普通角色（UserGroupLeader、CommunityBuilder、Speaker、Volunteer），THE Invite_System SHALL 返回角色无效错误。
5. WHEN 请求方不具备 Admin 或 SuperAdmin 角色，THE Invite_System SHALL 返回权限不足错误（403）。

---

### 需求 2：邀请链接有效性验证

**用户故事：** 作为被邀请用户，我希望通过邀请链接访问注册页面时系统能验证链接有效性，以便我了解是否可以继续注册。

#### 验收标准

1. WHEN 用户携带 Invite_Token 访问 Registration_Page，THE Invite_System SHALL 验证该 Token 对应的 Invite_Record 是否存在。
2. IF Invite_Record 不存在，THEN THE Invite_System SHALL 返回邀请链接无效错误。
3. IF Invite_Record 的 Invite_Status 为 `used`，THEN THE Invite_System SHALL 返回邀请链接已使用错误。
4. IF 当前时间超过 Invite_Record 的过期时间，THEN THE Invite_System SHALL 返回邀请链接已过期错误，并将 Invite_Status 更新为 `expired`。
5. WHEN Invite_Token 验证通过，THE Invite_System SHALL 在响应中返回该邀请对应的目标 UserRole，供 Registration_Page 展示。

---

### 需求 3：邀请制注册流程

**用户故事：** 作为被邀请用户，我希望通过有效的邀请链接完成账号注册，以便获得对应身份的系统访问权限。

#### 验收标准

1. WHEN 用户在 Registration_Page 提交注册信息（邮箱、密码、昵称）且携带有效 Invite_Token，THE Invite_System SHALL 创建新用户账号，并将 Invite_Record 中指定的 UserRole 赋予该账号。
2. WHEN 注册成功，THE Invite_System SHALL 将对应 Invite_Record 的 Invite_Status 更新为 `used`，并记录使用时间和注册用户的 userId。
3. IF 注册提交时 Invite_Token 已失效（已使用或已过期），THEN THE Invite_System SHALL 拒绝注册并返回对应错误，不创建用户账号。
4. IF 注册提交时邮箱已被注册，THEN THE Invite_System SHALL 返回邮箱已存在错误，不消耗 Invite_Token。
5. THE Invite_System SHALL 在注册成功后发送邮箱验证邮件，流程与现有注册流程一致。
6. WHEN 用户访问 Registration_Page 时未携带 Invite_Token 或 Token 无效，THE Registration_Page SHALL 展示"邀请链接无效"提示，并隐藏注册表单。

---

### 需求 4：邀请记录管理界面

**用户故事：** 作为管理员，我希望在管理后台查看所有邀请记录并进行管理，以便追踪邀请使用情况。

#### 验收标准

1. THE Invite_System SHALL 提供管理界面，展示所有 Invite_Record 列表，包含 Invite_Token（截断显示）、目标 UserRole、Invite_Status、创建时间、过期时间和使用时间（如已使用）。
2. WHEN 管理员在管理界面选择按 Invite_Status 筛选，THE Invite_System SHALL 仅展示符合所选状态的 Invite_Record。
3. WHEN 管理员对状态为 `pending` 的 Invite_Record 执行撤销操作，THE Invite_System SHALL 将该记录的 Invite_Status 更新为 `expired`，使对应 Invite_Link 立即失效。
4. WHEN 管理员在管理界面点击生成邀请链接，THE Invite_System SHALL 展示批量生成表单，支持选择目标 UserRole 和生成数量。
5. WHEN 管理员在管理界面点击复制某条 Invite_Link，THE Invite_System SHALL 将完整 Invite_Link 复制到剪贴板。

---

### 需求 5：邀请链接自动过期

**用户故事：** 作为系统，我希望邀请链接在 24 小时后自动失效，以确保邀请的时效性和安全性。

#### 验收标准

1. THE Invite_System SHALL 在每条 Invite_Record 创建时记录过期时间（createdAt + 24 小时）。
2. WHEN 验证 Invite_Token 时，IF 当前时间超过 Invite_Record 的过期时间，THEN THE Invite_System SHALL 将该记录状态标记为 `expired` 并拒绝使用。
3. FOR ALL Invite_Record，过期时间与创建时间的差值 SHALL 等于 86400 秒（24 小时）（不变量属性）。
4. FOR ALL 状态为 `used` 的 Invite_Record，使用时间 SHALL 早于过期时间（不变量属性）。

---

### 需求 6：Token 唯一性与安全性

**用户故事：** 作为系统，我希望每个邀请 Token 都是唯一且不可预测的，以防止未授权注册。

#### 验收标准

1. THE Invite_System SHALL 使用加密安全的随机算法生成 Invite_Token，长度不少于 32 个字符。
2. FOR ALL 已生成的 Invite_Token，任意两个 Token 的值 SHALL 不相同（唯一性属性）。
3. WHEN 同一 Invite_Token 被使用两次，THE Invite_System SHALL 在第二次使用时返回邀请链接已使用错误（幂等性属性）。
