# 需求文档：内容编辑解锁与预约用户变更通知（Content Edit Notification）

## 简介

本需求包含两项核心变更：（1）移除"有预约就不能编辑"的限制，允许内容上传者在内容已有预约的情况下仍可编辑；（2）内容编辑成功后，系统自动向已预约且活动尚未举行的用户发送邮件通知，告知其预约的内容已更新。邮件模板在 SuperAdmin 设置中可管理（复用现有邮件模板管理模式），通知功能在 SuperAdmin 设置中提供整体开关控制。

## 词汇表

- **Content_Item**：一条内容记录，包含文档文件、标题、描述、分类、上传者信息、状态、reservationCount 等字段
- **Content_Uploader**：上传内容的用户，即 Content_Item 的 uploaderId 对应的用户
- **Edit_API**：后端 PUT /api/content/{id} 接口，用于处理内容编辑请求
- **Reservation**：用户对 Content_Item 的预约记录，存储在 PointsMall-ContentReservations 表中，pk 格式为 `{userId}#{contentId}`，包含 activityDate 字段
- **Active_Reservation**：activityDate 晚于当前时间的 Reservation，表示活动尚未举行
- **Expired_Reservation**：activityDate 早于或等于当前时间的 Reservation，表示活动已举行
- **Email_Service**：现有的邮件发送服务模块（`packages/backend/src/email/`），提供 sendEmail、replaceVariables 等功能
- **Email_Template**：存储在 PointsMall-EmailTemplates DynamoDB 表中的邮件模板记录，按 Notification_Type 和 Locale 组合键存储
- **Notification_Type**：邮件通知类型标识，本需求新增 `contentUpdated` 类型
- **Email_Toggle**：存储在 feature toggles 设置中的布尔开关，控制对应 Notification_Type 是否启用
- **Locale**：支持的五种语言代码之一：`zh`、`en`、`ja`、`ko`、`zh-TW`
- **SuperAdmin**：最高权限管理员角色，可管理所有系统设置
- **Feature_Toggles**：存储在 Users 表中 settingKey 为 `feature-toggles` 的系统级配置记录

---

## 需求

### 需求 1：移除预约编辑限制

**用户故事：** 作为内容上传者，我希望即使内容已有预约也能编辑，以便及时更新和修正内容信息。

#### 验收标准

1. WHEN Content_Uploader 发起编辑请求且 Content_Item 的 reservationCount 大于 0，THE Edit_API SHALL 允许编辑操作继续执行，不再返回 CONTENT_NOT_EDITABLE 错误。
2. WHEN Content_Item 编辑成功且 reservationCount 大于 0，THE Edit_API SHALL 保持 reservationCount 值不变（不变量属性）。
3. WHEN Content_Item 编辑成功，THE Edit_API SHALL 继续执行现有的状态重置逻辑（status 重置为 pending，清除 rejectReason、reviewerId、reviewedAt）。
4. FOR ALL 编辑操作，编辑前后 Content_Item 的 likeCount、commentCount 和 reservationCount SHALL 保持不变（不变量属性）。

---

### 需求 2：查询活跃预约用户

**用户故事：** 作为系统，我希望在内容编辑后能查询到所有活动尚未举行的预约用户，以便向他们发送更新通知。

#### 验收标准

1. WHEN Content_Item 编辑成功且 reservationCount 大于 0，THE Edit_API SHALL 查询 PointsMall-ContentReservations 表中所有 contentId 匹配的 Reservation 记录。
2. WHEN 查询 Reservation 记录时，THE Edit_API SHALL 筛选出 activityDate 晚于当前时间的 Active_Reservation 记录。
3. WHEN 查询到 Active_Reservation 记录，THE Edit_API SHALL 提取每条记录的 userId 用于后续邮件通知。
4. IF 查询 Reservation 记录失败，THEN THE Edit_API SHALL 记录错误日志但不阻塞编辑操作的成功返回。

---

### 需求 3：编辑后自动邮件通知

**用户故事：** 作为已预约内容的用户，我希望在内容被编辑后收到邮件通知，以便确认最新版本的内容。

#### 验收标准

1. WHEN Content_Item 编辑成功且存在 Active_Reservation，THE Email_Service SHALL 向每位 Active_Reservation 对应的用户发送 `contentUpdated` 类型的邮件通知。
2. THE Email_Service SHALL 使用每位收件人的 Locale 偏好选择对应语言的 Email_Template。
3. IF 收件人未设置 Locale 偏好，THEN THE Email_Service SHALL 使用 `zh` 作为默认 Locale。
4. THE Email_Service SHALL 在邮件中填充以下模板变量：`{{contentTitle}}`（内容标题）、`{{userName}}`（收件人昵称）、`{{activityTopic}}`（活动主题）、`{{activityDate}}`（活动日期）。
5. WHEN 发送邮件时，THE Email_Service SHALL 逐个向每位用户发送（使用 TO 字段），不使用 BCC 批量发送。
6. IF 向某位用户发送邮件失败，THEN THE Email_Service SHALL 记录错误日志并继续向其余用户发送，不中断整体流程。
7. THE Edit_API SHALL 在编辑操作成功返回后异步执行邮件通知，不阻塞编辑 API 的响应时间。

---

### 需求 4：通知开关控制

**用户故事：** 作为 SuperAdmin，我希望能整体控制内容编辑通知的开关，以便在需要时关闭此类通知。

#### 验收标准

1. THE Feature_Toggles SHALL 新增 `emailContentUpdatedEnabled` 布尔字段，控制 `contentUpdated` 通知类型的启用状态。
2. THE Feature_Toggles SHALL 将 `emailContentUpdatedEnabled` 的默认值设为 `false`（默认关闭）。
3. WHILE `emailContentUpdatedEnabled` 为 false，THE Email_Service SHALL 跳过发送 `contentUpdated` 类型的邮件通知。
4. WHEN SuperAdmin 更新 `emailContentUpdatedEnabled` 开关，THE System SHALL 将新值持久化到 DynamoDB 的 Feature_Toggles 记录中。
5. WHEN 非 SuperAdmin 用户尝试更新 `emailContentUpdatedEnabled` 开关，THE System SHALL 返回 HTTP 403 FORBIDDEN。

---

### 需求 5：邮件模板管理

**用户故事：** 作为 SuperAdmin，我希望能编辑内容更新通知的邮件模板，以便自定义通知内容和措辞。

#### 验收标准

1. THE System SHALL 在 PointsMall-EmailTemplates 表中为 `contentUpdated` 类型创建默认模板，覆盖全部五种 Locale（zh、en、ja、ko、zh-TW）。
2. THE System SHALL 定义 `contentUpdated` 模板的变量集为：`{{contentTitle}}`、`{{userName}}`、`{{activityTopic}}`、`{{activityDate}}`。
3. WHEN SuperAdmin 在邮件模板编辑器中选择 `contentUpdated` 类型，THE System SHALL 展示当前模板内容及可用模板变量参考。
4. WHEN SuperAdmin 编辑 `contentUpdated` 模板的 subject 或 body，THE System SHALL 验证 subject 长度在 1–200 字符范围内，body 长度在 1–10000 字符范围内。
5. WHEN SuperAdmin 保存模板编辑，THE System SHALL 将更新后的模板持久化到 PointsMall-EmailTemplates 表中。
6. THE System SHALL 为 `contentUpdated` 中文默认模板设置如下内容：subject 为"📝 您预约的内容有更新，请确认最新版本"，body 包含内容标题、活动主题、活动日期等信息。

---

### 需求 6：默认邮件模板内容

**用户故事：** 作为系统运维人员，我希望系统部署后自动包含内容更新通知的默认模板，以便无需手动配置即可使用。

#### 验收标准

1. THE System SHALL 为 `contentUpdated` 的 zh 模板设置 subject 为"📝 您预约的内容有更新，请确认最新版本"。
2. THE System SHALL 为 `contentUpdated` 的 en 模板设置 subject 为"📝 Reserved content has been updated, please review the latest version"。
3. THE System SHALL 为 `contentUpdated` 的 ja 模板设置 subject 为"📝 予約したコンテンツが更新されました。最新版をご確認ください"。
4. THE System SHALL 为 `contentUpdated` 的 ko 模板设置 subject 为"📝 예약한 콘텐츠가 업데이트되었습니다. 최신 버전을 확인해 주세요"。
5. THE System SHALL 为 `contentUpdated` 的 zh-TW 模板设置 subject 为"📝 您預約的內容有更新，請確認最新版本"。
6. THE System SHALL 在所有默认模板的 body 中包含 `{{contentTitle}}`、`{{userName}}`、`{{activityTopic}}`、`{{activityDate}}` 四个模板变量。
7. THE System SHALL 在所有默认模板的 body 末尾包含自动发送声明文本。

---

### 需求 7：SuperAdmin 设置页面集成

**用户故事：** 作为 SuperAdmin，我希望在现有设置页面中看到内容更新通知的开关和模板编辑入口，以便统一管理所有邮件通知。

#### 验收标准

1. WHEN SuperAdmin 导航至管理设置页面的"邮件通知"分类，THE System SHALL 在现有邮件通知开关列表中新增"内容更新通知"开关项。
2. THE System SHALL 在"内容更新通知"开关项旁展示功能描述，说明此通知在内容编辑后自动发送给活跃预约用户。
3. WHEN SuperAdmin 点击"内容更新通知"的模板编辑按钮，THE System SHALL 打开邮件模板编辑器，展示 `contentUpdated` 类型的模板内容。
4. THE System SHALL 复用现有的 EmailTemplateEditorModal 组件，支持 Locale 切换、subject/body 编辑、变量参考面板。
5. WHEN 非 SuperAdmin 管理员导航至设置页面，THE System SHALL 不展示邮件通知设置区域。

---

### 需求 8：国际化支持

**用户故事：** 作为使用不同语言的管理员，我希望内容更新通知相关的 UI 标签支持多语言，以便界面完全本地化。

#### 验收标准

1. THE System SHALL 在 zh 语言文件中添加"内容更新通知"相关的翻译键值。
2. THE System SHALL 在 en 语言文件中添加"Content Update Notification"相关的翻译键值。
3. THE System SHALL 在 ja 语言文件中添加"コンテンツ更新通知"相关的翻译键值。
4. THE System SHALL 在 ko 语言文件中添加"콘텐츠 업데이트 알림"相关的翻译键值。
5. THE System SHALL 在 zh-TW 语言文件中添加"內容更新通知"相关的翻译键值。
6. THE System SHALL 使用 `useTranslation` hook 获取翻译文本，不硬编码任何用户可见字符串。

