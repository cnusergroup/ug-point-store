# 需求文档：内容中心（Content Hub）

## 简介

Content Hub 是积分商城系统中的内容共享与知识管理模块。各种角色的用户可以上传 PPT、文档等资料，并可附带视频链接。商城用户可在线预览已上传的文档内容。内容支持分类管理、评论、点赞功能。用户通过"使用预约"功能预约内容后可下载对应资料，同时系统自动为上传者发放积分奖励。SuperAdmin 可对内容进行审核与管理。

## 词汇表

- **Content_Hub**：内容中心模块，负责内容的上传、预览、分类、预约下载、评论与点赞等功能。
- **Content_Item**：一条内容记录，包含文档文件、标题、描述、分类、可选视频 URL、上传者信息、状态等。
- **Content_Category**：内容分类，用于组织和筛选 Content_Item。
- **Content_Uploader**：上传内容的用户，可以是任意角色（UserGroupLeader、CommunityBuilder、Speaker、Volunteer、Admin、SuperAdmin）。
- **Content_Viewer**：浏览和预览内容的商城用户。
- **Reservation**：使用预约记录，用户对某条 Content_Item 发起的预约，预约成功后可下载对应资料。
- **Comment**：用户对 Content_Item 发表的文字评论。
- **Like**：用户对 Content_Item 的点赞操作。
- **Content_Admin_Panel**：SuperAdmin 管理后台中的内容管理页面。
- **Points_System**：积分系统，负责积分的发放与记录。

---

## 需求

### 需求 1：内容上传

**用户故事：** 作为任意角色的用户，我希望能上传 PPT 或文档资料并附带视频链接，以便将知识内容分享给商城中的其他用户。

#### 验收标准

1. THE Content_Hub SHALL 允许所有已登录用户（UserGroupLeader、CommunityBuilder、Speaker、Volunteer、Admin、SuperAdmin）上传内容。
2. WHEN Content_Uploader 提交上传表单，THE Content_Hub SHALL 要求提供以下必填字段：标题、描述、分类、文档文件（支持 PPT、PPTX、PDF、DOC、DOCX 格式）。
3. WHEN Content_Uploader 提交上传表单，THE Content_Hub SHALL 允许提供可选字段：视频 URL 地址。
4. WHEN 上传的文档文件格式不属于 PPT、PPTX、PDF、DOC、DOCX，THE Content_Hub SHALL 拒绝上传并返回文件格式不支持的错误提示。
5. WHEN 上传的文档文件大小超过 50MB，THE Content_Hub SHALL 拒绝上传并返回文件过大的错误提示。
6. WHEN Content_Uploader 提供视频 URL 时，THE Content_Hub SHALL 验证 URL 格式的合法性。
7. WHEN 内容上传成功，THE Content_Hub SHALL 将 Content_Item 状态设置为 pending（待审核）。

---

### 需求 2：内容审核与管理

**用户故事：** 作为 SuperAdmin，我希望能审核、管理和删除内容，以确保 Content Hub 中的内容质量。

#### 验收标准

1. THE Content_Admin_Panel SHALL 仅对拥有 SuperAdmin 角色的用户可见和可访问。
2. THE Content_Admin_Panel SHALL 展示所有 Content_Item 的列表，支持按状态（pending、approved、rejected）筛选。
3. WHEN SuperAdmin 审核通过一条 Content_Item，THE Content_Hub SHALL 将该 Content_Item 状态更新为 approved，使其对所有用户可见。
4. WHEN SuperAdmin 审核拒绝一条 Content_Item，THE Content_Hub SHALL 将该 Content_Item 状态更新为 rejected，并记录拒绝原因。
5. WHEN SuperAdmin 删除一条 Content_Item，THE Content_Hub SHALL 移除该 Content_Item 及其关联的所有 Comment、Like 和 Reservation 记录。
6. THE Content_Admin_Panel SHALL 支持创建、编辑和删除 Content_Category。

---

### 需求 3：内容分类

**用户故事：** 作为用户，我希望内容按分类组织，以便快速找到感兴趣的资料。

#### 验收标准

1. THE Content_Hub SHALL 在内容列表页展示所有可用的 Content_Category，支持按分类筛选内容。
2. WHEN Content_Uploader 上传内容时，THE Content_Hub SHALL 要求选择一个 Content_Category。
3. THE Content_Hub SHALL 支持"全部"筛选选项，展示所有已审核通过的 Content_Item。
4. FOR ALL Content_Item，每条内容 SHALL 关联且仅关联一个 Content_Category（不变量属性）。

---

### 需求 4：内容在线预览

**用户故事：** 作为商城用户，我希望能在线预览已上传的文档内容，以便在预约下载前了解资料内容。

#### 验收标准

1. THE Content_Hub SHALL 仅展示状态为 approved 的 Content_Item 给普通用户。
2. WHEN Content_Viewer 点击某条 Content_Item，THE Content_Hub SHALL 展示内容详情页，包含标题、描述、上传者信息、分类、上传时间。
3. WHEN Content_Item 包含文档文件，THE Content_Hub SHALL 提供文档在线预览功能，支持 PPT、PPTX、PDF、DOC、DOCX 格式的在线查看。
4. WHEN Content_Item 包含视频 URL，THE Content_Hub SHALL 在详情页展示视频链接，用户点击后可跳转观看。
5. WHILE 用户未对该 Content_Item 进行使用预约，THE Content_Hub SHALL 仅提供在线预览功能，不提供下载功能。

---

### 需求 5：使用预约与下载

**用户故事：** 作为商城用户，我希望通过"使用预约"功能预约内容后下载对应资料，以便在本地使用这些资料。

#### 验收标准

1. WHEN Content_Viewer 在内容详情页点击"使用预约"按钮，THE Content_Hub SHALL 创建一条 Reservation 记录，关联该用户和该 Content_Item。
2. WHEN Reservation 创建成功，THE Content_Hub SHALL 为该用户解锁该 Content_Item 的文档下载功能。
3. WHEN 用户已对某条 Content_Item 完成使用预约，THE Content_Hub SHALL 在详情页展示"下载资料"按钮替代"使用预约"按钮。
4. WHEN 用户点击"下载资料"按钮，THE Content_Hub SHALL 提供文档文件的下载。
5. THE Content_Hub SHALL 记录每条 Content_Item 的预约总次数，并在内容列表和详情页展示。
6. FOR ALL Reservation 记录，每条记录 SHALL 包含用户 ID、Content_Item ID 和预约时间（不变量属性）。

---

### 需求 6：积分奖励

**用户故事：** 作为内容上传者，我希望当其他用户预约使用我上传的内容时获得积分奖励，以激励我持续分享优质内容。

#### 验收标准

1. WHEN 一条新的 Reservation 创建成功，THE Points_System SHALL 为该 Content_Item 的 Content_Uploader 发放积分奖励。
2. THE Points_System SHALL 为每次预约奖励固定积分数（由 SuperAdmin 在系统中配置）。
3. WHEN 积分发放成功，THE Points_System SHALL 创建一条积分记录，来源标记为"content_hub_reservation"。
4. IF 同一用户对同一 Content_Item 重复预约，THEN THE Content_Hub SHALL 忽略重复预约请求，不创建新的 Reservation 记录，不重复发放积分。

---

### 需求 7：评论功能

**用户故事：** 作为商城用户，我希望能对内容发表评论，以便与其他用户交流对资料的看法。

#### 验收标准

1. WHEN 已登录用户在内容详情页提交评论，THE Content_Hub SHALL 创建一条 Comment 记录，关联该用户和该 Content_Item。
2. THE Content_Hub SHALL 在内容详情页按时间倒序展示所有 Comment。
3. WHEN 用户提交空白评论内容，THE Content_Hub SHALL 拒绝提交并提示评论内容不能为空。
4. WHEN 评论内容超过 500 个字符，THE Content_Hub SHALL 拒绝提交并提示评论内容过长。
5. THE Content_Hub SHALL 在每条 Comment 中展示评论者昵称、角色徽章和评论时间。
6. THE Content_Hub SHALL 在内容列表和详情页展示每条 Content_Item 的评论总数。

---

### 需求 8：点赞功能

**用户故事：** 作为商城用户，我希望能对内容点赞或取消点赞，以便表达对优质内容的认可。

#### 验收标准

1. WHEN 已登录用户点击内容的点赞按钮且当前未点赞，THE Content_Hub SHALL 创建一条 Like 记录并将该 Content_Item 的点赞计数加 1。
2. WHEN 已登录用户点击内容的点赞按钮且当前已点赞，THE Content_Hub SHALL 删除对应 Like 记录并将该 Content_Item 的点赞计数减 1。
3. THE Content_Hub SHALL 在内容列表和详情页展示每条 Content_Item 的点赞总数。
4. THE Content_Hub SHALL 在点赞按钮上通过视觉状态区分当前用户是否已点赞。
5. FOR ALL Content_Item，点赞计数 SHALL 大于等于 0（不变量属性）。
6. FOR ALL 用户与 Content_Item 的组合，同一用户对同一 Content_Item 的 Like 记录 SHALL 最多存在一条（幂等性属性）。

---

### 需求 9：内容列表与搜索

**用户故事：** 作为商城用户，我希望能浏览和搜索内容列表，以便发现感兴趣的资料。

#### 验收标准

1. THE Content_Hub SHALL 在内容列表页展示所有已审核通过的 Content_Item，按上传时间倒序排列。
2. THE Content_Hub SHALL 为每条列表项展示：标题、分类标签、上传者昵称、点赞数、评论数、预约数。
3. THE Content_Hub SHALL 支持分页加载，每页展示固定数量的 Content_Item。
4. WHEN 内容列表为空，THE Content_Hub SHALL 展示空状态提示。

---

### 需求 10：多语言支持

**用户故事：** 作为用户，我希望 Content Hub 的界面文案支持多语言，以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Content_Hub SHALL 为所有界面文案提供 5 种语言的翻译：简体中文（zh）、英文（en）、日文（ja）、韩文（ko）、繁体中文（zh-TW）。
2. THE Content_Hub SHALL 复用现有的 i18n 框架和 TranslationDict 类型结构。
3. FOR ALL Content_Hub 界面文案，每条文案 SHALL 在 5 种语言的翻译文件中均有对应条目（完整性属性）。
