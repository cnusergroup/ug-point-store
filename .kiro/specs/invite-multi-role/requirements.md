# 需求文档：邀请链接多角色选择（Invite Multi-Role）

## 简介

本功能将邀请链接的角色分配从单选改为多选。管理员在创建邀请链接时可以选择一个或多个目标角色，通过该邀请链接注册的用户将自动获得所有选中的角色。此变更涉及前端表单交互、后端 API 参数、数据库存储结构以及注册时的角色分配逻辑。

## 词汇表

- **Invite_System**：邀请制注册系统，负责邀请链接的生成、验证与失效管理。
- **Admin**：拥有 `Admin` 或 `SuperAdmin` 角色的用户，有权生成和管理邀请链接。
- **Invite_Record**：存储在数据库中的邀请记录，包含 Token、目标角色列表、状态、过期时间等信息。
- **Invite_Form**：管理后台中用于创建邀请链接的表单组件。
- **Role_Selector**：Invite_Form 中的角色选择器组件，支持多选操作。
- **UserRole**：系统中定义的普通用户角色，包括 `UserGroupLeader`、`CommunityBuilder`、`Speaker`、`Volunteer`。
- **Registration_Page**：用户通过邀请链接访问的注册页面。

---

## 需求

### 需求 1：多角色选择表单交互

**用户故事：** 作为管理员，我希望在创建邀请链接时可以选择多个目标角色，以便一次性为被邀请用户分配多个身份。

#### 验收标准

1. WHEN 管理员打开 Invite_Form，THE Role_Selector SHALL 以多选模式展示所有可选的 UserRole（UserGroupLeader、CommunityBuilder、Speaker、Volunteer），允许同时选中多个角色。
2. WHEN 管理员点击 Role_Selector 中的某个角色选项，THE Role_Selector SHALL 切换该角色的选中状态（已选中则取消，未选中则选中）。
3. WHEN 管理员未选中任何角色时点击生成按钮，THE Invite_Form SHALL 展示错误提示，阻止提交。
4. WHEN Invite_Form 打开时，THE Role_Selector SHALL 默认不选中任何角色。

---

### 需求 2：后端 API 支持多角色参数

**用户故事：** 作为系统，我希望批量生成邀请链接的 API 接受角色数组参数，以便支持多角色邀请链接的创建。

#### 验收标准

1. WHEN 管理员提交批量生成请求，THE Invite_System SHALL 接受 `roles` 参数（UserRole 数组），替代原有的单个 `role` 参数。
2. WHEN `roles` 参数为空数组或未提供，THE Invite_System SHALL 返回参数无效错误。
3. WHEN `roles` 参数中包含不属于合法普通角色的值，THE Invite_System SHALL 返回角色无效错误。
4. WHEN `roles` 参数中包含重复的角色值，THE Invite_System SHALL 自动去重后正常处理。
5. THE Invite_System SHALL 为每条生成的 Invite_Record 存储完整的 roles 数组。

---

### 需求 3：邀请记录存储结构变更

**用户故事：** 作为系统，我希望邀请记录能存储多个目标角色，以便注册时正确分配所有角色。

#### 验收标准

1. THE Invite_Record SHALL 使用 `roles` 字段（UserRole 数组）存储目标角色列表，替代原有的单个 `role` 字段。
2. THE Invite_System SHALL 保持对旧数据的向后兼容：WHEN 读取仅包含 `role` 字段的旧 Invite_Record 时，THE Invite_System SHALL 将其视为包含单个角色的数组。
3. FOR ALL Invite_Record，`roles` 数组的长度 SHALL 大于等于 1 且小于等于 4（不变量属性）。

---

### 需求 4：注册时多角色分配

**用户故事：** 作为被邀请用户，我希望通过邀请链接注册后自动获得邀请中指定的所有角色。

#### 验收标准

1. WHEN 用户通过有效 Invite_Token 完成注册，THE Invite_System SHALL 将 Invite_Record 中 `roles` 数组的所有角色赋予新创建的用户账号。
2. WHEN 验证 Invite_Token 成功时，THE Invite_System SHALL 在响应中返回完整的 `roles` 数组，供 Registration_Page 展示所有目标角色。
3. FOR ALL 通过邀请注册的用户，用户的角色列表 SHALL 包含对应 Invite_Record 中 `roles` 数组的所有角色（不变量属性）。

---

### 需求 5：邀请列表多角色展示

**用户故事：** 作为管理员，我希望在邀请管理列表中看到每条邀请链接关联的所有角色，以便了解邀请的完整信息。

#### 验收标准

1. THE Invite_System SHALL 在邀请列表中为每条 Invite_Record 展示所有关联的角色徽章。
2. WHEN Invite_Record 关联多个角色时，THE Invite_System SHALL 依次展示所有角色徽章，使用水平排列并允许换行。
3. WHEN 注册页面展示邀请角色信息时，THE Registration_Page SHALL 展示所有目标角色，而非仅展示单个角色。
