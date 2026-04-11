# 需求文档：内容编辑与预约数展示增强（Content Edit & Reservation Count Display）

## 简介

本需求为现有 Content Hub 模块新增两项增强功能：（1）允许内容上传者编辑自己上传的内容项，包括修改标题、描述、分类、视频 URL 以及替换文档文件；（2）增强预约次数（reservationCount）在内容列表页和详情页的展示效果。编辑功能仅限原始上传者操作，且仅允许编辑处于 pending 或 rejected 状态的内容，编辑完成后状态重置为 pending 以便重新审核。替换文档文件时，旧的 S3 文件应被删除。

## 词汇表

- **Content_Hub**：内容中心模块，负责内容的上传、预览、分类、预约下载、评论与点赞等功能。
- **Content_Item**：一条内容记录，包含文档文件、标题、描述、分类、可选视频 URL、上传者信息、状态等。
- **Content_Uploader**：上传内容的用户，即 Content_Item 的 uploaderId 对应的用户。
- **Content_Category**：内容分类，用于组织和筛选 Content_Item。
- **Content_Editor**：对自己上传的 Content_Item 执行编辑操作的用户，必须与 Content_Uploader 为同一人。
- **Editable_Status**：允许编辑的内容状态集合，包含 pending 和 rejected 两种状态。
- **Reservation_Count**：Content_Item 被用户预约使用的累计次数，存储在 ContentItems 表的 reservationCount 字段中。
- **Edit_API**：后端 PUT /api/content/{id} 接口，用于处理内容编辑请求。

---

## 需求

### 需求 1：内容编辑权限控制

**用户故事：** 作为内容上传者，我希望只有我自己能编辑我上传的内容，以确保内容的所有权和安全性。

#### 验收标准

1. WHEN Content_Editor 发起编辑请求，THE Edit_API SHALL 验证请求用户的 userId 与 Content_Item 的 uploaderId 一致。
2. IF Content_Editor 的 userId 与 Content_Item 的 uploaderId 不一致，THEN THE Edit_API SHALL 拒绝请求并返回 FORBIDDEN 错误码。
3. WHEN Content_Editor 发起编辑请求，THE Edit_API SHALL 接受任何 status（pending、rejected、approved）的 Content_Item。
4. WHEN Content_Item 编辑成功，THE Edit_API SHALL 将 status 重置为 pending，确保修改后的内容经过重新审核。

---

### 需求 2：内容字段编辑

**用户故事：** 作为内容上传者，我希望能修改内容的标题、描述、分类和视频 URL，以便在审核前完善内容信息。

#### 验收标准

1. WHEN Content_Editor 提交编辑请求，THE Edit_API SHALL 接受以下可选更新字段：标题、描述、分类 ID、视频 URL。
2. WHEN Content_Editor 提供新的标题，THE Edit_API SHALL 验证标题长度在 1 至 100 字符范围内。
3. WHEN Content_Editor 提供新的描述，THE Edit_API SHALL 验证描述长度在 1 至 2000 字符范围内。
4. WHEN Content_Editor 提供新的分类 ID，THE Edit_API SHALL 验证该分类 ID 存在于 ContentCategories 表中。
5. WHEN Content_Editor 提供新的视频 URL，THE Edit_API SHALL 验证 URL 格式的合法性（http 或 https 协议）。
6. WHEN Content_Editor 提交空字符串作为视频 URL，THE Edit_API SHALL 清除该 Content_Item 的 videoUrl 字段。
7. WHEN 编辑请求中未包含某个字段，THE Edit_API SHALL 保留该字段的原始值不变。

---

### 需求 3：文档文件替换

**用户故事：** 作为内容上传者，我希望能上传新的文档文件替换旧文件，以便更新资料内容。

#### 验收标准

1. WHEN Content_Editor 提供新的 fileKey 和 fileName，THE Edit_API SHALL 将 Content_Item 的 fileKey 和 fileName 更新为新值。
2. WHEN Content_Item 的 fileKey 被更新为新值，THE Edit_API SHALL 删除旧 fileKey 对应的 S3 文件。
3. IF 旧 S3 文件删除失败，THEN THE Edit_API SHALL 记录错误日志但不阻塞编辑操作的成功返回。
4. WHEN Content_Editor 提供新的 fileSize，THE Edit_API SHALL 更新 Content_Item 的 fileSize 字段。
5. WHEN 编辑请求中未包含 fileKey，THE Edit_API SHALL 保留原有文档文件不变。

---

### 需求 4：编辑后状态重置

**用户故事：** 作为系统管理员，我希望编辑后的内容自动重置为待审核状态，以确保修改后的内容经过重新审核。

#### 验收标准

1. WHEN Content_Item 编辑成功，THE Edit_API SHALL 将 Content_Item 的 status 重置为 pending。
2. WHEN Content_Item 编辑成功，THE Edit_API SHALL 清除 Content_Item 的 rejectReason、reviewerId 和 reviewedAt 字段。
3. WHEN Content_Item 编辑成功，THE Edit_API SHALL 更新 Content_Item 的 updatedAt 字段为当前时间。
4. FOR ALL 编辑操作，编辑前后 Content_Item 的 likeCount、commentCount 和 reservationCount SHALL 保持不变（不变量属性）。

---

### 需求 5：内容编辑前端页面

**用户故事：** 作为内容上传者，我希望有一个编辑页面让我方便地修改内容信息和替换文件。

#### 验收标准

1. WHEN Content_Uploader 在内容详情页查看自己上传的 Content_Item，THE Content_Hub SHALL 展示"编辑"按钮。
2. WHILE Content_Item 的 status 为 approved，THE Content_Hub SHALL 展示"编辑"按钮，并提示编辑后需重新审核。
3. WHEN Content_Uploader 点击"编辑"按钮，THE Content_Hub SHALL 导航至编辑页面，并预填充当前 Content_Item 的所有字段值。
4. THE Content_Hub 编辑页面 SHALL 复用上传页面的表单布局和校验逻辑。
5. WHEN Content_Uploader 在编辑页面点击文件上传区域，THE Content_Hub SHALL 允许选择新文件替换现有文件。
6. WHEN Content_Uploader 未选择新文件，THE Content_Hub SHALL 展示当前文件名和文件大小信息。
7. WHEN Content_Uploader 提交编辑表单，THE Content_Hub SHALL 调用 Edit_API 并在成功后返回内容详情页。

---

### 需求 6：内容详情页对上传者的增强展示

**用户故事：** 作为内容上传者，我希望在详情页看到自己内容的审核状态信息，以便了解内容的当前状态。

#### 验收标准

1. WHEN Content_Uploader 查看自己上传的 Content_Item 详情，THE Content_Hub SHALL 展示该内容的当前状态（pending、approved、rejected）。
2. WHILE Content_Item 的 status 为 rejected，THE Content_Hub SHALL 展示拒绝原因（rejectReason）。
3. THE Edit_API 的 getContentDetail 接口 SHALL 允许 Content_Uploader 查看自己上传的非 approved 状态的 Content_Item。

---

### 需求 7：预约次数展示增强

**用户故事：** 作为商城用户，我希望能更直观地看到内容的预约使用次数，以便判断内容的受欢迎程度。

#### 验收标准

1. THE Content_Hub 内容列表页 SHALL 在每条 Content_Item 的统计区域展示 reservationCount。
2. THE Content_Hub 内容详情页 SHALL 在统计区域展示 reservationCount。
3. FOR ALL Content_Item，reservationCount SHALL 大于等于 0（不变量属性）。

---

### 需求 8：API 路由与 CDK 配置

**用户故事：** 作为开发者，我希望新增 PUT /api/content/{id} 路由以支持内容编辑功能。

#### 验收标准

1. THE Content_Hub 的 API Gateway SHALL 新增 PUT /api/content/{id} 路由，指向 Content Lambda。
2. THE Content Lambda SHALL 对 PUT /api/content/{id} 请求执行身份验证（auth-middleware）。
3. THE Content Lambda SHALL 拥有 S3 DeleteObject 权限以删除旧文档文件。
4. WHEN Edit_API 需要删除旧 S3 文件，THE Content Lambda SHALL 使用 content/ 前缀路径下的 DeleteObject 操作。
