# 实现计划：内容标签系统（Content Tags）

## 概述

为内容中心（Content Hub）新增用户创建的标签系统。涉及：共享类型扩展（TagRecord 接口、标签校验/规范化函数）、新增错误码、新增 ContentTags DynamoDB 表、新增后端标签模块 `content/tags.ts` 和管理端标签模块 `content/admin-tags.ts`、扩展现有 upload/edit/list/handler 模块支持标签、Admin Handler 新增标签管理路由、前端新增 TagInput 组件和 TagCloud 筛选、管理端标签管理面板、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增标签相关类型和校验函数
    - 在 `packages/shared/src/types.ts` 中新增：
      - `TagRecord` 接口：tagId（string）、tagName（string）、usageCount（number）、createdAt（string）
      - `normalizeTagName(name: string): string` 函数：trim + toLowerCase
      - `validateTagName(name: string): boolean` 函数：规范化后 2~20 字符
      - `validateTagsArray(tags: string[]): { valid: boolean; normalizedTags: string[]; error?: string }` 函数：0~5 个标签、每个合法、无重复
    - 在 `ContentItem` 接口中新增可选字段 `tags?: string[]`
    - 在 `ContentItemSummary` 接口中新增可选字段 `tags?: string[]`
    - _需求: 1.1, 1.2, 1.4, 1.5, 2.1, 2.6, 2.7, 2.8, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 1.2 新增标签错误码定义
    - 在 `packages/shared/src/errors.ts` 的 `ErrorCodes` 中新增：
      - `INVALID_TAG_NAME`（400）：标签名无效（需 2~20 字符，不能为纯空白）
      - `TOO_MANY_TAGS`（400）：标签数量超过上限（最多 5 个）
      - `DUPLICATE_TAG_NAME`（400）：标签名重复
      - `TAG_MERGE_SELF_ERROR`（400）：不能将标签合并到自身
      - `TAG_NOT_FOUND`（404）：标签不存在
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 2.1, 2.2, 2.8, 7.7, 7.8_

  - [x] 1.3 编写标签数组校验属性测试（Property 1）
    - **Property 1: 标签数组校验正确性**
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - 使用 fast-check 生成随机字符串数组（长度 0~10，字符串长度 0~30，含空白/重复变体）
    - 验证：数组长度 > 5 时返回 TOO_MANY_TAGS；任一元素规范化后不在 2~20 范围时返回 INVALID_TAG_NAME；存在规范化后重复时返回 DUPLICATE_TAG_NAME；全部合法时返回 valid: true
    - **验证: 需求 1.4, 1.5, 2.1, 2.2, 2.6, 2.8, 3.1, 9.1**

  - [x] 1.4 编写标签名规范化属性测试（Property 2 + 3 + 4）
    - **Property 2: 标签名规范化正确性**
    - **Property 3: 标签名规范化幂等性**
    - **Property 4: 规范化与校验可交换性**
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - 使用 fast-check 生成随机字符串（含前后空白、大小写混合）
    - 验证：normalizeTagName(s) === s.trim().toLowerCase()；normalizeTagName 幂等；规范化与校验可交换
    - **验证: 需求 2.7, 9.2, 9.4, 9.5**

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 ContentTags DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `contentTagsTable`：PK=`tagId`（String），GSI `tagName-index`（PK=tagName）
      - 表名 `PointsMall-ContentTags`，PAY_PER_REQUEST 计费模式
      - 导出公共属性和 CfnOutput
    - _需求: 1.1_

  - [x] 2.2 更新 API Stack 配置
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `contentTagsTable` 属性
      - Content Lambda 新增环境变量 `CONTENT_TAGS_TABLE`
      - Admin Lambda 新增环境变量 `CONTENT_TAGS_TABLE`
      - Content Lambda 新增 ContentTags 表读写权限
      - API Gateway 新增路由：
        - GET `/api/content/tags/search` → contentFn
        - GET `/api/content/tags/hot` → contentFn
        - GET `/api/content/tags/cloud` → contentFn
    - 更新 `packages/cdk/bin/app.ts` 传递 `contentTagsTable` 引用给 ApiStack
    - _需求: 1.1, 4.1, 5.1, 6.6, 7.1_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型编译通过、CDK 代码编译通过，新增表和环境变量配置正确。如有问题请向用户确认。

- [x] 4. 后端标签核心模块
  - [x] 4.1 实现标签搜索与热门标签逻辑
    - 创建 `packages/backend/src/content/tags.ts`
    - 实现 `searchTags(options, dynamoClient, contentTagsTable)` 函数：
      - prefix 长度 < 1 时返回空数组
      - 对 prefix 执行 normalizeTagName 后 Scan + FilterExpression `begins_with(tagName, :prefix)`
      - 按 usageCount 降序排序，取前 limit 条（默认 10）
    - 实现 `getHotTags(dynamoClient, contentTagsTable)` 函数：
      - Scan 全量数据，按 usageCount 降序排序，取前 10 条
    - 实现 `getTagCloudTags(dynamoClient, contentTagsTable)` 函数：
      - Scan 全量数据，按 usageCount 降序排序，取前 20 条
    - _需求: 4.1, 4.2, 4.3, 5.1, 5.2, 6.6_

  - [x] 4.2 实现标签同步逻辑
    - 在 `packages/backend/src/content/tags.ts` 中新增：
    - 实现 `syncTagsOnCreate(tags, dynamoClient, contentTagsTable)` 函数：
      - 对每个标签名执行 normalizeTagName
      - 使用 tagName-index GSI 查询是否存在
      - 不存在：PutCommand 创建新 TagRecord（usageCount=1）
      - 已存在：UpdateCommand `ADD usageCount :one` 原子递增
    - 实现 `syncTagsOnEdit(oldTags, newTags, dynamoClient, contentTagsTable)` 函数：
      - 计算 removedTags 和 addedTags
      - removedTags：UpdateCommand 递减 usageCount（最小为 0）
      - addedTags：同 syncTagsOnCreate 逻辑
    - _需求: 1.6, 2.3, 2.4, 3.2_

  - [x] 4.3 编写标签模块单元测试
    - 创建 `packages/backend/src/content/tags.test.ts`
    - 测试 searchTags 前缀匹配、排序、限制、空前缀返回空
    - 测试 getHotTags 排序、限制、不足 10 条返回全部
    - 测试 getTagCloudTags 排序、限制 20 条
    - 测试 syncTagsOnCreate 新建标签 usageCount=1、已存在标签递增
    - 测试 syncTagsOnEdit 增删标签 usageCount 变化
    - _需求: 1.1, 1.6, 2.3, 2.4, 3.2, 4.1, 4.2, 5.1, 5.2, 6.6_

  - [x] 4.4 编写标签自动补全搜索属性测试（Property 8）
    - **Property 8: 标签自动补全搜索正确性**
    - 创建 `packages/backend/src/content/tags.property.test.ts`
    - 使用 fast-check 生成随机前缀 + 随机 TagRecord 集合
    - 验证：返回的每条 TagRecord 的 tagName 以规范化后的前缀开头，结果按 usageCount 降序排列，数量不超过 10
    - **验证: 需求 4.1, 4.2**

  - [x] 4.5 编写热门标签属性测试（Property 9）
    - **Property 9: 热门标签正确性**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机 TagRecord 集合（不同 usageCount）
    - 验证：返回结果按 usageCount 降序排列，数量不超过 10，不足 10 条时返回全部
    - **验证: 需求 5.1, 5.2**

  - [x] 4.6 编写标签云属性测试（Property 11）
    - **Property 11: 标签云正确性**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机 TagRecord 集合
    - 验证：返回结果按 usageCount 降序排列，数量不超过 20
    - **验证: 需求 6.6**

  - [x] 4.7 编写内容创建时标签同步属性测试（Property 5）
    - **Property 5: 内容创建时标签同步正确性**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效标签数组 + mock DynamoDB
    - 验证：每个标签名在 ContentTags 表中存在对应 TagRecord；新标签 usageCount=1；已存在标签 usageCount 递增 1；所有 usageCount ≥ 0
    - **验证: 需求 1.1, 1.6, 2.3, 2.4**

  - [x] 4.8 编写内容编辑时标签同步属性测试（Property 6）
    - **Property 6: 内容编辑时标签同步正确性**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机旧/新标签数组 + mock DynamoDB
    - 验证：被移除标签 usageCount 减少 1；被新增标签 usageCount 增加 1；未变化标签 usageCount 不变；所有 usageCount ≥ 0
    - **验证: 需求 1.6, 3.2**

  - [x] 4.9 编写向后兼容性属性测试（Property 14）
    - **Property 14: 向后兼容性**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机 ContentItem（有/无 tags 字段）
    - 验证：不包含 tags 字段的记录读取时返回空数组；不包含 tags 参数的请求正常处理
    - **验证: 需求 8.1, 8.2, 8.4**

- [x] 5. 扩展现有内容模块支持标签
  - [x] 5.1 扩展 upload.ts 支持标签
    - 在 `packages/backend/src/content/upload.ts` 的 `CreateContentItemInput` 中新增可选字段 `tags?: string[]`
    - 在 `createContentItem` 函数中：
      - 如果提供 tags，调用 `validateTagsArray` 校验，失败返回对应错误码
      - 对每个标签执行 `normalizeTagName`
      - 创建 ContentItem 时写入 `tags` 字段（默认 `[]`）
      - 创建成功后调用 `syncTagsOnCreate(normalizedTags)` 更新 ContentTags 表
    - _需求: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 5.2 扩展 edit.ts 支持标签
    - 在 `packages/backend/src/content/edit.ts` 的 `EditContentItemInput` 中新增可选字段 `tags?: string[]`
    - 在 `editContentItem` 函数中：
      - 如果提供 tags，调用 `validateTagsArray` 校验
      - 对每个标签执行 `normalizeTagName`
      - 读取旧 ContentItem 的 `tags`（`item.tags ?? []`）
      - UpdateCommand 更新 `tags` 字段
      - 调用 `syncTagsOnEdit(oldTags, newTags)` 更新 ContentTags 表
    - 新增 `contentTagsTable` 参数传递
    - _需求: 3.1, 3.2, 3.3, 3.4_

  - [x] 5.3 扩展 list.ts 支持标签筛选
    - 在 `packages/backend/src/content/list.ts` 的 `ListContentItemsOptions` 中新增可选字段 `tag?: string`
    - 在 `listContentItems` 函数中：
      - 有 tag 筛选时：在现有查询基础上添加 FilterExpression `contains(tags, :tag)`
      - tag 筛选可与 categoryId 筛选同时使用
    - 在 `listContentItems` 返回的 items 映射中新增 `tags: item.tags ?? []`
    - _需求: 6.2, 6.4, 6.5, 8.1, 8.2_

  - [x] 5.4 扩展 handler.ts 新增标签路由
    - 在 `packages/backend/src/content/handler.ts` 中：
      - 新增环境变量 `CONTENT_TAGS_TABLE`
      - 导入 `searchTags`、`getHotTags`、`getTagCloudTags` 从 `./tags`
      - 新增 GET 路由：
        - `/api/content/tags/search?prefix=xxx` → searchTags
        - `/api/content/tags/hot` → getHotTags
        - `/api/content/tags/cloud` → getTagCloudTags
      - 在 `handleCreateContentItem` 中传递 `body.tags` 和 `contentTagsTable`
      - 在 `handleEditContentItem` 中传递 `body.tags` 和 `contentTagsTable`
      - 在 `handleListContentItems` 中传递 `tag` 查询参数
    - _需求: 4.1, 5.1, 6.6_

  - [x] 5.5 扩展现有模块单元测试
    - 更新 `packages/backend/src/content/upload.test.ts`：测试带标签上传成功、无标签上传默认空数组、无效标签被拒绝
    - 更新 `packages/backend/src/content/edit.test.ts`：测试编辑标签成功、编辑后读取 round-trip
    - 更新 `packages/backend/src/content/list.test.ts`：测试按标签筛选、标签 + 分类组合筛选、无 tags 字段旧内容兼容
    - 更新 `packages/backend/src/content/handler.test.ts`：测试新增标签路由分发
    - _需求: 2.1~2.8, 3.1~3.4, 6.2, 6.4, 6.5, 8.1, 8.2_

  - [x] 5.6 编写标签编辑 Round-Trip 属性测试（Property 7）
    - **Property 7: 标签编辑 Round-Trip**
    - 在 `packages/backend/src/content/tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效标签数组 + mock DynamoDB
    - 验证：编辑 ContentItem 的 tags 后再读取，返回的 tags 数组与编辑时提交的规范化标签数组完全一致
    - **验证: 需求 3.4**

  - [x] 5.7 编写标签筛选属性测试（Property 10）
    - **Property 10: 标签筛选正确性**
    - 在 `packages/backend/src/content/list.property.test.ts` 中添加
    - 使用 fast-check 生成随机 ContentItem 集合（混合状态/标签/分类）
    - 验证：返回的每条 ContentItem 的 tags 数组包含指定标签名；如果指定了 categoryId 则 categoryId 匹配；status 等于 approved
    - **验证: 需求 6.2, 6.4, 6.5**

- [x] 6. 检查点 - 后端标签模块验证
  - 运行所有后端内容模块测试（tags、upload、edit、list、handler），确保标签逻辑正确。如有问题请向用户确认。

- [x] 7. 后端管理端标签模块
  - [x] 7.1 实现管理端标签管理逻辑
    - 创建 `packages/backend/src/content/admin-tags.ts`
    - 实现 `listAllTags(dynamoClient, contentTagsTable)` 函数：
      - Scan 全量数据，按 tagName 升序排序
    - 实现 `mergeTags(input, dynamoClient, tables)` 函数：
      - 校验 sourceTagId !== targetTagId，否则返回 TAG_MERGE_SELF_ERROR
      - GetCommand 获取 source 和 target TagRecord，不存在返回 TAG_NOT_FOUND
      - Scan ContentItems 表，FilterExpression `contains(tags, :sourceTagName)`
      - 对每条匹配的 ContentItem：替换 tags 数组中的 sourceTagName 为 targetTagName，去重
      - UpdateCommand 将 source.usageCount 加到 target.usageCount（减去去重数量）
      - DeleteCommand 删除 source TagRecord
    - 实现 `deleteTag(tagId, dynamoClient, tables)` 函数：
      - GetCommand 获取 TagRecord，不存在返回 TAG_NOT_FOUND
      - Scan ContentItems 表，FilterExpression `contains(tags, :tagName)`
      - 对每条匹配的 ContentItem：从 tags 数组中移除该 tagName，UpdateCommand 更新
      - DeleteCommand 删除 TagRecord
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 7.2 扩展 admin/handler.ts 新增标签管理路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量 `CONTENT_TAGS_TABLE`
      - 导入 `listAllTags`、`mergeTags`、`deleteTag` 从 `../content/admin-tags`
      - 新增路由正则和路由分发：
        - GET `/api/admin/tags` → listAllTags
        - POST `/api/admin/tags/merge` → mergeTags（需 SuperAdmin 权限校验）
        - DELETE `/api/admin/tags/:id` → deleteTag（需 SuperAdmin 权限校验）
    - _需求: 7.1, 7.2, 7.3, 7.5, 7.7, 7.8_

  - [x] 7.3 编写管理端标签单元测试
    - 创建 `packages/backend/src/content/admin-tags.test.ts`
    - 测试 listAllTags 按 tagName 升序排序
    - 测试 mergeTags 正常合并、去重、自合并拒绝、不存在拒绝
    - 测试 deleteTag 正常删除、不存在拒绝
    - 更新 `packages/backend/src/admin/handler.test.ts`：测试标签管理路由分发、非 SuperAdmin 被拒绝
    - _需求: 7.1~7.9_

  - [x] 7.4 编写标签合并属性测试（Property 12）
    - **Property 12: 标签合并正确性**
    - 创建 `packages/backend/src/content/admin-tags.property.test.ts`
    - 使用 fast-check 生成随机源/目标标签 + 随机 ContentItem 集合
    - 验证：所有原本包含源标签名的 ContentItem 中源标签被替换为目标标签；去重后目标标签仅出现一次；目标 usageCount 正确；源 TagRecord 被删除
    - **验证: 需求 7.3, 7.4, 7.9**

  - [x] 7.5 编写标签删除属性测试（Property 13）
    - **Property 13: 标签删除正确性**
    - 在 `packages/backend/src/content/admin-tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机标签 + 随机 ContentItem 集合
    - 验证：所有原本包含该标签名的 ContentItem 中不再包含该标签名；受影响 ContentItem 的 tags 数组长度减少；TagRecord 被删除
    - **验证: 需求 7.5, 7.6**

  - [x] 7.6 编写管理端标签列表排序属性测试（Property 15）
    - **Property 15: 管理端标签列表排序正确性**
    - 在 `packages/backend/src/content/admin-tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机 TagRecord 集合
    - 验证：listAllTags 返回结果按 tagName 升序排列，且包含所有 TagRecord
    - **验证: 需求 7.2**

  - [x] 7.7 编写标签管理权限校验属性测试（Property 16）
    - **Property 16: 标签管理权限校验**
    - 在 `packages/backend/src/content/admin-tags.property.test.ts` 中添加
    - 使用 fast-check 生成随机角色集合
    - 验证：不包含 SuperAdmin 时标签管理操作被拒绝；包含 SuperAdmin 时权限校验通过
    - **验证: 需求 7.1**

- [x] 8. 检查点 - 后端管理端标签验证
  - 运行所有后端标签管理模块测试（admin-tags、admin/handler），确保管理端标签逻辑正确。如有问题请向用户确认。


- [x] 9. 前端 TagInput 组件
  - [x] 9.1 创建 TagInput 自动补全组件
    - 创建 `packages/frontend/src/components/TagInput/index.tsx` 和 `index.scss`
    - 组件功能：
      - 标签输入框，支持输入时自动补全（调用 GET `/api/content/tags/search?prefix=xxx`）
      - 自动补全下拉列表展示匹配标签（按 usageCount 降序）
      - 点击下拉项或回车添加标签到已选列表
      - 输入不存在的标签名时允许创建新标签
      - 已选标签以 chip 形式展示，支持点击删除
      - 最多 5 个标签，达到上限时禁用输入
      - Hot Tags 区域：调用 GET `/api/content/tags/hot` 展示热门标签 chip，点击添加
      - 达到 5 个标签上限时禁用 Hot Tag chip 选择并展示视觉提示
    - Props：`value: string[]`、`onChange: (tags: string[]) => void`、`maxTags?: number`
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.2 集成 TagInput 到上传和编辑页面
    - 在 `packages/frontend/src/pages/content/upload.tsx` 中：
      - 导入 TagInput 组件
      - 在上传表单中添加标签输入区域
      - 新建模式：tags 初始为空数组
      - 编辑模式：tags 预填充现有标签
      - 提交时将 tags 数组包含在请求体中
    - _需求: 2.1, 2.5, 3.1, 5.3, 5.4_

- [x] 10. 前端 TagCloud 筛选组件
  - [x] 10.1 创建 TagCloud 组件并集成到内容列表页
    - 创建 `packages/frontend/src/components/TagCloud/index.tsx` 和 `index.scss`
    - 组件功能：
      - 调用 GET `/api/content/tags/cloud` 获取标签云数据（Top 20）
      - 水平滚动展示标签 chip，按 usageCount 降序排列
      - 点击标签切换选中状态（高亮），触发筛选回调
      - 再次点击取消选中，恢复全部内容
    - 在 `packages/frontend/src/pages/content/index.tsx` 中：
      - 在分类筛选栏下方添加 TagCloud 组件
      - 选中标签时在 API 请求中添加 `tag` 查询参数
      - 支持分类 + 标签同时筛选
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 10.2 在内容详情页展示标签
    - 在 `packages/frontend/src/pages/content/detail.tsx` 中：
      - 在内容信息区域展示标签列表（chip 形式）
      - 无标签时不展示标签区域
    - _需求: 8.1, 8.2_

- [x] 11. 前端管理端标签管理面板
  - [x] 11.1 创建标签管理页面
    - 创建 `packages/frontend/src/pages/admin/tags.tsx` 和 `packages/frontend/src/pages/admin/tags.scss`
    - 页面功能：
      - 顶部工具栏：返回按钮 + 标题"标签管理"
      - 标签列表：每行展示 tagName、usageCount，按 tagName 升序排列
      - 合并操作：选择源标签和目标标签，确认后调用 POST `/api/admin/tags/merge`
      - 删除操作：确认弹窗后调用 DELETE `/api/admin/tags/:id`
      - 操作成功后刷新列表
    - API 调用：GET `/api/admin/tags`、POST `/api/admin/tags/merge`、DELETE `/api/admin/tags/:id`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/tags` 路由
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 11.2 在管理面板首页添加标签管理入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 的 ADMIN_LINKS 中添加导航卡片：
      - "标签管理"：跳转 `/pages/admin/tags`，仅 SuperAdmin 可见
    - _需求: 7.1_

- [x] 12. 检查点 - 前端页面验证
  - 确保 TagInput 组件、TagCloud 组件、标签管理页面编译通过，路由注册正确，页面间交互逻辑完整。如有问题请向用户确认。

- [x] 13. i18n 多语言翻译
  - [x] 13.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增标签相关键：
      - `contentHub.tags`：标签输入组件文案（placeholder、hotTagsTitle、maxTagsHint、addTag、removeTag）
      - `contentHub.tagCloud`：标签云文案（title、noTags）
      - `contentHub.tagManagement`：标签管理页文案（title、tagName、usageCount、merge、delete、mergeConfirm、deleteConfirm、mergeSuccess、deleteSuccess、selectSource、selectTarget、mergeSelfError、tagNotFound）
    - 在 `admin.dashboard` 中新增 `tagsTitle`、`tagsDesc` 键
    - _需求: 10.1, 10.2_

  - [x] 13.2 添加 5 种语言标签相关翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加标签相关简体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加标签相关英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加标签相关日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加标签相关韩文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加标签相关繁体中文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 10.1, 10.2, 10.3_

  - [x] 13.3 在标签相关前端页面中使用 i18n
    - 在 TagInput 组件、TagCloud 组件、标签管理页面中：
      - 导入 `useTranslation`，在组件顶部调用 `const { t } = useTranslation()`
      - 将所有硬编码文案替换为 `t('contentHub.tags.xxx')` / `t('contentHub.tagCloud.xxx')` / `t('contentHub.tagManagement.xxx')` 调用
    - _需求: 10.1, 10.2_

- [x] 14. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确，i18n 翻译完整，CDK 编译通过。如有问题请向用户确认。

## 备注

- 新增 1 张 DynamoDB 表（ContentTags），PK=tagId，GSI tagName-index
- ContentItems 表新增可选 `tags` 字段，无需数据迁移，读取时默认 `[]`
- 标签名存储前统一 trim + toLowerCase，保证一致性
- 标签 usageCount 通过 DynamoDB UpdateCommand ADD 原子操作维护
- 标签总量预计 < 1000，自动补全和热门标签使用 Scan + 客户端排序
- 标签筛选使用 FilterExpression `contains(tags, :tag)`，数据量可控
- 合并/删除操作为低频 SuperAdmin 操作，全表扫描可接受
- 属性测试验证设计文档中定义的 16 个正确性属性
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
- Admin Lambda 已有 `PointsMall-*` 通配符 DynamoDB 权限，无需额外配置表权限
- Admin 标签管理路由通过现有 `{proxy+}` 自动覆盖，无需额外 API Gateway 配置