# 实现计划：内容中心（Content Hub）

## 概述

为积分商城系统新增内容共享与知识管理模块。涉及共享类型与错误码扩展、5 张新 DynamoDB 表（ContentItems、ContentCategories、ContentComments、ContentLikes、ContentReservations）、1 个新 Content Lambda 函数、Admin Handler 路由扩展、5 个前端新页面（内容列表、内容详情、内容上传、管理端内容管理、管理端分类管理）、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增内容中心相关类型定义
    - 在 `packages/shared/src/types.ts` 中新增以下类型：
      - `ContentStatus` 类型：`'pending' | 'approved' | 'rejected'`
      - `ContentItem` 接口：contentId、title、description、categoryId、categoryName、uploaderId、uploaderNickname、uploaderRole、fileKey、fileName、fileSize、videoUrl（可选）、status、rejectReason（可选）、reviewerId（可选）、reviewedAt（可选）、likeCount、commentCount、reservationCount、createdAt、updatedAt
      - `ContentItemSummary` 接口：contentId、title、categoryName、uploaderNickname、likeCount、commentCount、reservationCount、createdAt
      - `ContentCategory` 接口：categoryId、name、createdAt
      - `ContentComment` 接口：commentId、contentId、userId、userNickname、userRole、content、createdAt
      - `ContentReservation` 接口：pk、userId、contentId、createdAt
    - _需求: 1.2, 4.2, 5.6, 7.1, 7.5, 8.3, 9.2_

  - [x] 1.2 新增错误码定义
    - 在 `packages/shared/src/errors.ts` 的 `ErrorCodes` 中新增：
      - `INVALID_CONTENT_FILE_TYPE`（400）：不支持的文档格式，仅支持 PPT/PPTX/PDF/DOC/DOCX
      - `CONTENT_FILE_TOO_LARGE`（400）：文档文件大小超过 50MB 上限
      - `INVALID_VIDEO_URL`（400）：视频链接格式无效
      - `INVALID_CONTENT_TITLE`（400）：内容标题格式无效（1~100 字符）
      - `INVALID_CONTENT_DESCRIPTION`（400）：内容描述格式无效（1~2000 字符）
      - `CONTENT_NOT_FOUND`（404）：内容不存在
      - `CATEGORY_NOT_FOUND`（404）：分类不存在
      - `CONTENT_ALREADY_REVIEWED`（400）：该内容已被审核
      - `INVALID_COMMENT_CONTENT`（400）：评论内容无效（1~500 字符）
      - `RESERVATION_REQUIRED`（400）：需先完成使用预约才能下载
      - `CONTENT_REVIEW_FORBIDDEN`（403）：仅 SuperAdmin 可审核内容
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 1.4, 1.5, 1.6, 2.1, 2.4, 3.2, 4.5, 7.3, 7.4_


  - [x] 1.3 编写文档格式校验属性测试
    - **Property 1: 文档格式校验正确性**
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - 使用 fast-check 生成随机 MIME 类型字符串，验证不属于 5 种允许类型时被拒绝，属于时通过
    - **验证: 需求 1.4**

  - [x] 1.4 编写视频 URL 格式校验属性测试
    - **Property 2: 视频 URL 格式校验正确性**
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - 使用 fast-check 生成随机字符串和合法/非法 URL，验证非法 URL 被拒绝，合法 URL 通过
    - **验证: 需求 1.6**

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 5 张 DynamoDB 表定义
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `ContentItems` 表：PK=`contentId`（String），GSI `status-createdAt-index`（PK=status, SK=createdAt）、GSI `categoryId-createdAt-index`（PK=categoryId, SK=createdAt）、GSI `uploaderId-createdAt-index`（PK=uploaderId, SK=createdAt）
      - `ContentCategories` 表：PK=`categoryId`（String）
      - `ContentComments` 表：PK=`commentId`（String），GSI `contentId-createdAt-index`（PK=contentId, SK=createdAt）
      - `ContentLikes` 表：PK=`pk`（String），GSI `contentId-index`（PK=contentId）
      - `ContentReservations` 表：PK=`pk`（String），GSI `contentId-index`（PK=contentId）
    - 导出 5 张表的公共属性供 ApiStack 引用，添加 CfnOutput
    - _需求: 1.7, 2.2, 3.1, 5.1, 7.1, 8.1_

  - [x] 2.2 新增 Content Lambda 函数和 API 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `contentItemsTable`、`contentCategoriesTable`、`contentCommentsTable`、`contentLikesTable`、`contentReservationsTable` 属性
      - 新增 `ContentFunction` Lambda（入口 `content/handler.ts`），授予 ContentItems、ContentCategories、ContentComments、ContentLikes、ContentReservations、Users、PointsRecords 表读写权限，授予 S3 `content/*` 路径读写权限
      - 新增用户端内容 API 路由：
        - POST `/api/content/upload-url` → ContentFunction
        - POST `/api/content` → ContentFunction
        - GET `/api/content` → ContentFunction
        - GET `/api/content/categories` → ContentFunction
        - GET `/api/content/{id}` → ContentFunction
        - POST `/api/content/{id}/comments` → ContentFunction
        - GET `/api/content/{id}/comments` → ContentFunction
        - POST `/api/content/{id}/like` → ContentFunction
        - POST `/api/content/{id}/reserve` → ContentFunction
        - GET `/api/content/{id}/download` → ContentFunction
      - 新增管理端内容路由（集成到 Admin Lambda）：
        - GET `/api/admin/content` → AdminFunction
        - PATCH `/api/admin/content/{id}/review` → AdminFunction
        - DELETE `/api/admin/content/{id}` → AdminFunction
        - POST `/api/admin/content/categories` → AdminFunction
        - PUT `/api/admin/content/categories/{id}` → AdminFunction
        - DELETE `/api/admin/content/categories/{id}` → AdminFunction
      - 为 Admin Lambda 添加 ContentItems、ContentCategories、ContentComments、ContentLikes、ContentReservations 表读写权限和 S3 `content/*` 路径删除权限
    - 更新 `packages/cdk/bin/app.ts` 传递 5 张新表引用给 ApiStack
    - 更新 `configureImagesBucket` 方法为 Content Lambda 添加 S3 权限
    - _需求: 1.1, 2.1, 4.1, 5.1, 7.1, 8.1, 9.1_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型编译通过、CDK 代码编译通过，新增表和 Lambda 定义正确。如有问题请向用户确认。

- [x] 4. 后端内容上传模块
  - [x] 4.1 实现内容上传核心逻辑
    - 创建 `packages/backend/src/content/upload.ts`
    - 实现 `getContentUploadUrl(input, s3Client, bucket)` 函数：
      - 校验 contentType 属于 5 种允许的 MIME 类型，否则返回 INVALID_CONTENT_FILE_TYPE
      - 生成 S3 Key：`content/{userId}/{ulid}/{fileName}`
      - 使用 PutObjectCommand 生成预签名 URL，设置 ContentLength 上限 50MB
    - 实现 `createContentItem(input, dynamoClient, tables)` 函数：
      - 校验 title（1~100 字符）、description（1~2000 字符）
      - 校验 categoryId 存在于 ContentCategories 表，否则返回 CATEGORY_NOT_FOUND
      - 校验 videoUrl 格式合法性（可选），否则返回 INVALID_VIDEO_URL
      - 使用 ULID 生成 contentId，状态设为 pending
      - 初始化 likeCount=0、commentCount=0、reservationCount=0
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 4.2 编写内容上传单元测试
    - 创建 `packages/backend/src/content/upload.test.ts`
    - 测试有效文件类型上传成功、无效文件类型被拒绝、文件大小超限被拒绝、必填字段缺失被拒绝、videoUrl 格式校验、分类不存在被拒绝、新建内容初始状态为 pending
    - _需求: 1.1~1.7_

  - [x] 4.3 编写新建内容初始状态属性测试
    - **Property 3: 新建内容初始状态不变量**
    - 创建 `packages/backend/src/content/upload.property.test.ts`
    - 使用 fast-check 生成随机有效上传输入，验证创建成功后 status=pending、likeCount=0、commentCount=0、reservationCount=0
    - **验证: 需求 1.7**

- [x] 5. 后端内容列表与详情模块
  - [x] 5.1 实现内容列表与详情核心逻辑
    - 创建 `packages/backend/src/content/list.ts`
    - 实现 `listContentItems(options, dynamoClient, contentItemsTable)` 函数：
      - 仅返回 status=approved 的内容
      - 无分类筛选时使用 GSI `status-createdAt-index` 查询，ScanIndexForward=false
      - 有分类筛选时使用 GSI `categoryId-createdAt-index` 查询 + FilterExpression status=approved
      - 返回摘要字段：contentId、title、categoryName、uploaderNickname、likeCount、commentCount、reservationCount、createdAt
      - 支持 pageSize 和 lastKey 分页
    - 实现 `getContentDetail(contentId, userId, dynamoClient, tables)` 函数：
      - GetCommand 获取内容记录，非 approved 状态返回 CONTENT_NOT_FOUND
      - 如果 userId 存在，并行查询 Reservations 和 Likes 表判断 hasReserved/hasLiked
      - 返回完整内容信息 + hasReserved + hasLiked 标志
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 9.1, 9.2, 9.3_

  - [x] 5.2 编写内容列表与详情单元测试
    - 创建 `packages/backend/src/content/list.test.ts`
    - 测试用户端仅返回 approved 内容、分类筛选正确性、分页查询正确性、详情返回 hasReserved/hasLiked 标志、空列表返回空数组
    - _需求: 4.1, 4.2, 4.5, 9.1, 9.3, 9.4_

  - [x] 5.3 编写用户端列表仅展示已审核通过内容属性测试
    - **Property 7: 用户端内容列表仅展示已审核通过内容且按时间倒序**
    - 创建 `packages/backend/src/content/list.property.test.ts`
    - 使用 fast-check 生成随机混合状态内容集，验证返回的每条记录 status=approved 且按 createdAt 降序排列
    - **验证: 需求 4.1, 9.1**

  - [x] 5.4 编写分类筛选正确性属性测试
    - **Property 8: 分类筛选正确性**
    - 在 `packages/backend/src/content/list.property.test.ts` 中添加
    - 使用 fast-check 生成随机内容 + 随机分类，验证筛选后每条记录的 categoryId 等于指定值
    - **验证: 需求 3.1, 3.4**

  - [x] 5.5 编写列表摘要字段完整性属性测试
    - **Property 18: 内容列表摘要字段完整性**
    - 在 `packages/backend/src/content/list.property.test.ts` 中添加
    - 使用 fast-check 生成随机内容记录，验证返回的 ContentItemSummary 包含 title、categoryName、uploaderNickname、likeCount、commentCount、reservationCount 全部字段
    - **验证: 需求 9.2**

  - [x] 5.6 编写分页正确性属性测试
    - **Property 19: 分页正确性**
    - 在 `packages/backend/src/content/list.property.test.ts` 中添加
    - 使用 fast-check 生成大于 pageSize 的内容数据集，验证分页返回不超过 pageSize 条记录且使用 lastKey 继续查询返回不重复记录
    - **验证: 需求 9.3**

- [x] 6. 后端评论模块
  - [x] 6.1 实现评论核心逻辑
    - 创建 `packages/backend/src/content/comment.ts`
    - 实现 `addComment(input, dynamoClient, tables)` 函数：
      - 校验 content 非空且 ≤ 500 字符，否则返回 INVALID_COMMENT_CONTENT
      - 校验 contentId 对应的内容存在且 status=approved
      - PutCommand 写入 Comments 表
      - UpdateCommand 原子递增 ContentItems 表的 commentCount
    - 实现 `listComments(options, dynamoClient, commentsTable)` 函数：
      - 使用 GSI `contentId-createdAt-index` 查询，ScanIndexForward=false（时间倒序）
      - pageSize 默认 20，最大 100，支持 lastKey 分页
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 6.2 编写评论单元测试
    - 创建 `packages/backend/src/content/comment.test.ts`
    - 测试有效评论创建成功、空白评论被拒绝、超长评论被拒绝、评论列表时间倒序、commentCount 递增
    - _需求: 7.1~7.6_

  - [x] 6.3 编写评论内容校验属性测试
    - **Property 12: 评论内容校验正确性**
    - 创建 `packages/backend/src/content/comment.property.test.ts`
    - 使用 fast-check 生成随机长度字符串和空白字符串，验证空白或超过 500 字符时被拒绝，1~500 字符时通过
    - **验证: 需求 7.3, 7.4**

  - [x] 6.4 编写评论列表时间倒序属性测试
    - **Property 13: 评论列表时间倒序**
    - 在 `packages/backend/src/content/comment.property.test.ts` 中添加
    - 使用 fast-check 生成随机评论集，验证查询结果按 createdAt 降序排列
    - **验证: 需求 7.2**

  - [x] 6.5 编写评论记录完整性属性测试
    - **Property 14: 评论记录完整性**
    - 在 `packages/backend/src/content/comment.property.test.ts` 中添加
    - 使用 fast-check 生成随机有效评论输入，验证返回的 Comment 包含 userNickname、userRole、createdAt 且 commentCount 递增 1
    - **验证: 需求 7.5, 7.6**

- [x] 7. 后端点赞模块
  - [x] 7.1 实现点赞核心逻辑
    - 创建 `packages/backend/src/content/like.ts`
    - 实现 `toggleLike(input, dynamoClient, tables)` 函数：
      - PK=`{userId}#{contentId}`，先 GetCommand 查询是否已存在
      - 已存在：DeleteCommand 删除 + UpdateCommand 原子递减 likeCount
      - 不存在：PutCommand 创建 + UpdateCommand 原子递增 likeCount
      - 返回操作后的 liked 状态和最新 likeCount
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 7.2 编写点赞单元测试
    - 创建 `packages/backend/src/content/like.test.ts`
    - 测试首次点赞创建记录、重复点赞取消记录、likeCount 正确递增/递减
    - _需求: 8.1~8.6_

  - [x] 7.3 编写点赞切换 Round-Trip 属性测试
    - **Property 15: 点赞切换 Round-Trip**
    - 创建 `packages/backend/src/content/like.property.test.ts`
    - 使用 fast-check 生成随机用户/内容对，验证点赞后再取消点赞 likeCount 恢复初始值且 Like 记录被删除
    - **验证: 需求 8.1, 8.2**

  - [x] 7.4 编写点赞计数非负属性测试
    - **Property 16: 点赞计数非负不变量**
    - 在 `packages/backend/src/content/like.property.test.ts` 中添加
    - 使用 fast-check 生成随机点赞/取消序列，验证 likeCount 在任何时刻都 ≥ 0
    - **验证: 需求 8.5**

  - [x] 7.5 编写点赞幂等性属性测试
    - **Property 17: 点赞幂等性**
    - 在 `packages/backend/src/content/like.property.test.ts` 中添加
    - 使用 fast-check 生成随机用户/内容对 + 多次操作，验证 ContentLikes 表中该组合记录最多一条
    - **验证: 需求 8.6**

- [x] 8. 后端预约与下载模块
  - [x] 8.1 实现预约与下载核心逻辑
    - 创建 `packages/backend/src/content/reservation.ts`
    - 实现 `createReservation(input, dynamoClient, tables, rewardPoints)` 函数：
      - PK=`{userId}#{contentId}`，使用 ConditionExpression `attribute_not_exists(pk)` 防止重复
      - 已存在时返回 `{ success: true, alreadyReserved: true }`，不重复发放积分
      - 新建预约时使用 TransactWriteItems 原子操作：
        1. PutCommand 写入 Reservations 表（带 ConditionExpression）
        2. UpdateCommand 递增 ContentItems 表的 reservationCount
        3. UpdateCommand 递增上传者 Users 表 points
        4. PutCommand 写入 PointsRecords 表，source="content_hub_reservation"
      - rewardPoints 从环境变量读取
    - 实现 `getDownloadUrl(contentId, userId, dynamoClient, s3Client, tables, bucket)` 函数：
      - 查询 Reservations 表确认用户已预约，未预约返回 RESERVATION_REQUIRED
      - 获取 ContentItem 的 fileKey，生成 S3 GetObject 预签名 URL（有效期 1 小时）
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_

  - [x] 8.2 编写预约与下载单元测试
    - 创建 `packages/backend/src/content/reservation.test.ts`
    - 测试预约创建成功 + 积分发放、重复预约幂等、未预约下载被拒绝、已预约下载成功
    - _需求: 5.1~5.6, 6.1~6.4_

  - [x] 8.3 编写预约与下载权限联动属性测试
    - **Property 9: 预约与下载权限联动（Round-Trip）**
    - 创建 `packages/backend/src/content/reservation.property.test.ts`
    - 使用 fast-check 生成随机用户/内容对，验证未预约时下载返回 RESERVATION_REQUIRED，完成预约后下载成功
    - **验证: 需求 4.5, 5.1, 5.2**

  - [x] 8.4 编写预约幂等性属性测试
    - **Property 10: 预约幂等性**
    - 在 `packages/backend/src/content/reservation.property.test.ts` 中添加
    - 使用 fast-check 生成随机用户/内容对 + 重复操作，验证 Reservations 表中该组合记录最多一条且上传者仅获得一次积分奖励
    - **验证: 需求 6.4**

  - [x] 8.5 编写预约积分发放正确性属性测试
    - **Property 11: 预约积分发放正确性**
    - 在 `packages/backend/src/content/reservation.property.test.ts` 中添加
    - 使用 fast-check 生成随机内容 + 随机预约，验证上传者积分余额增加配置的奖励积分数且生成 type=earn、source="content_hub_reservation" 的积分记录
    - **验证: 需求 6.1, 6.3**

- [x] 9. 后端管理端内容模块
  - [x] 9.1 实现管理端内容审核与分类管理逻辑
    - 创建 `packages/backend/src/content/admin.ts`
    - 实现 `reviewContent(input, dynamoClient, contentItemsTable)` 函数：
      - GetCommand 获取内容记录，不存在返回 CONTENT_NOT_FOUND
      - 状态非 pending 返回 CONTENT_ALREADY_REVIEWED
      - approve 时更新 status=approved、记录 reviewerId 和 reviewedAt
      - reject 时更新 status=rejected、记录 rejectReason、reviewerId 和 reviewedAt
    - 实现 `listAllContent(options, dynamoClient, contentItemsTable)` 函数：
      - 支持按 status 筛选，使用 GSI `status-createdAt-index` 查询
      - 无筛选时 Scan + 按 createdAt 倒序排列
      - 支持分页
    - 实现 `deleteContent(contentId, dynamoClient, s3Client, tables, bucket)` 函数：
      - 删除 S3 文档文件
      - 批量删除关联的 Comments、Likes、Reservations 记录（BatchWriteCommand）
      - 删除 ContentItem 记录
    - 实现分类 CRUD：`createCategory`、`updateCategory`、`deleteCategory`、`listCategories`
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 9.2 编写管理端内容单元测试
    - 创建 `packages/backend/src/content/admin.test.ts`
    - 测试审核通过/拒绝、重复审核被拒绝、删除内容级联清理、分类 CRUD
    - _需求: 2.1~2.6_

  - [x] 9.3 编写审核权限校验属性测试
    - **Property 4: 内容审核权限校验**
    - 创建 `packages/backend/src/content/admin.property.test.ts`
    - 使用 fast-check 生成随机角色集合，验证不含 SuperAdmin 时被拒绝，含 SuperAdmin 时通过
    - **验证: 需求 2.1**

  - [x] 9.4 编写管理端状态筛选正确性属性测试
    - **Property 5: 管理端状态筛选正确性**
    - 在 `packages/backend/src/content/admin.property.test.ts` 中添加
    - 使用 fast-check 生成随机内容记录 + 随机状态，验证筛选后每条记录 status 等于指定值
    - **验证: 需求 2.2**

  - [x] 9.5 编写审核状态流转正确性属性测试
    - **Property 6: 内容审核状态流转正确性**
    - 在 `packages/backend/src/content/admin.property.test.ts` 中添加
    - 使用 fast-check 生成随机 pending/approved/rejected 内容，验证 pending 审核通过→approved、审核拒绝→rejected 且 rejectReason 非空；approved/rejected 再次审核返回 CONTENT_ALREADY_REVIEWED
    - **验证: 需求 2.3, 2.4**

- [x] 10. 后端 Handler 路由
  - [x] 10.1 创建 Content Handler（用户端）
    - 创建 `packages/backend/src/content/handler.ts`
    - 实现独立 Lambda 函数路由分发，所有路由需 JWT 认证（复用 auth-middleware）：
      - POST `/api/content/upload-url` → getContentUploadUrl
      - POST `/api/content` → createContentItem
      - GET `/api/content` → listContentItems
      - GET `/api/content/categories` → listCategories（公开）
      - GET `/api/content/:id` → getContentDetail
      - POST `/api/content/:id/comments` → addComment
      - GET `/api/content/:id/comments` → listComments
      - POST `/api/content/:id/like` → toggleLike
      - POST `/api/content/:id/reserve` → createReservation
      - GET `/api/content/:id/download` → getDownloadUrl
    - 环境变量：CONTENT_ITEMS_TABLE、CONTENT_CATEGORIES_TABLE、CONTENT_COMMENTS_TABLE、CONTENT_LIKES_TABLE、CONTENT_RESERVATIONS_TABLE、USERS_TABLE、POINTS_RECORDS_TABLE、IMAGES_BUCKET、CONTENT_REWARD_POINTS
    - _需求: 1.1, 4.1, 5.1, 7.1, 8.1, 9.1_

  - [x] 10.2 扩展 Admin Handler 添加内容管理路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量：CONTENT_ITEMS_TABLE、CONTENT_CATEGORIES_TABLE、CONTENT_COMMENTS_TABLE、CONTENT_LIKES_TABLE、CONTENT_RESERVATIONS_TABLE
      - 新增路由正则和路由分发：
        - GET `/api/admin/content` → listAllContent
        - PATCH `/api/admin/content/:id/review` → reviewContent（需 SuperAdmin 权限校验）
        - DELETE `/api/admin/content/:id` → deleteContent
        - POST `/api/admin/content/categories` → createCategory
        - PUT `/api/admin/content/categories/:id` → updateCategory
        - DELETE `/api/admin/content/categories/:id` → deleteCategory
      - 导入 `reviewContent`、`listAllContent`、`deleteContent`、`createCategory`、`updateCategory`、`deleteCategory` 从 `../content/admin`
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 10.3 编写 Handler 路由单元测试
    - 创建 `packages/backend/src/content/handler.test.ts`
    - 测试 Content Handler 各路由分发正确性
    - 更新 `packages/backend/src/admin/handler.test.ts`，添加内容管理路由测试
    - _需求: 1.1, 2.1, 4.1, 5.1, 7.1, 8.1_

- [x] 11. 检查点 - 后端模块验证
  - 运行所有后端内容模块测试（upload、list、comment、like、reservation、admin、handler），确保逻辑正确。如有问题请向用户确认。

- [x] 12. 前端内容列表页
  - [x] 12.1 创建内容列表页面
    - 创建 `packages/frontend/src/pages/content/index.tsx` 和 `packages/frontend/src/pages/content/index.scss`
    - 页面功能：
      - 顶部标题栏 + 上传入口按钮（已登录用户可见）
      - 分类筛选标签栏：展示所有 ContentCategory + "全部"选项，点击切换筛选
      - 内容列表：每项展示标题、分类标签、上传者昵称、点赞数、评论数、预约数
      - 按上传时间倒序排列
      - 分页加载（下拉加载更多）
      - 空状态提示
      - 点击内容项跳转详情页
    - API 调用：GET `/api/content`、GET `/api/content/categories`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/content/index` 路由
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 3.1, 3.3, 9.1, 9.2, 9.3, 9.4_

- [x] 13. 前端内容详情页
  - [x] 13.1 创建内容详情页面
    - 创建 `packages/frontend/src/pages/content/detail.tsx` 和 `packages/frontend/src/pages/content/detail.scss`
    - 页面功能：
      - 内容信息区域：标题、描述、上传者昵称 + 角色徽章、分类标签、上传时间
      - 文档预览区域：
        - PDF 文件使用 PDF.js 内嵌预览
        - PPT/PPTX/DOC/DOCX 文件使用 Office Online Viewer 预览（iframe）
      - 视频链接区域：展示视频 URL，点击跳转观看（如有）
      - 预约/下载区域：
        - 未预约时展示"使用预约"按钮
        - 已预约时展示"下载资料"按钮
      - 点赞按钮：展示点赞数 + 当前用户是否已点赞的视觉状态
      - 评论区域：
        - 评论列表（时间倒序）：每条展示评论者昵称、角色徽章、评论内容、评论时间
        - 评论输入框 + 提交按钮
        - 分页加载更多评论
      - 统计信息：点赞数、评论数、预约数
    - API 调用：GET `/api/content/:id`、POST `/api/content/:id/like`、POST `/api/content/:id/reserve`、GET `/api/content/:id/download`、POST `/api/content/:id/comments`、GET `/api/content/:id/comments`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/content/detail` 路由
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4_

- [x] 14. 前端内容上传页
  - [x] 14.1 创建内容上传页面
    - 创建 `packages/frontend/src/pages/content/upload.tsx` 和 `packages/frontend/src/pages/content/upload.scss`
    - 页面功能：
      - 上传表单：
        - 标题输入（必填，1~100 字符）
        - 描述输入（必填，1~2000 字符）
        - 分类选择（必填，下拉选择 ContentCategory）
        - 文档文件上传（必填，支持 PPT/PPTX/PDF/DOC/DOCX，≤50MB）
        - 视频 URL 输入（可选）
      - 文件上传流程：先调用 POST `/api/content/upload-url` 获取预签名 URL，再上传文件到 S3
      - 提交后调用 POST `/api/content` 创建内容记录
      - 成功后提示"内容已提交，等待审核"并跳转内容列表页
      - 前端输入校验：文件格式、文件大小、标题长度、描述长度、URL 格式
    - API 调用：POST `/api/content/upload-url`、POST `/api/content`、GET `/api/content/categories`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/content/upload` 路由
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.2_

- [x] 15. 检查点 - 前端用户端页面验证
  - 确保内容列表页、详情页、上传页编译通过，路由注册正确，页面间跳转逻辑完整。如有问题请向用户确认。

- [x] 16. 前端管理端内容管理页
  - [x] 16.1 创建管理端内容管理页面
    - 创建 `packages/frontend/src/pages/admin/content.tsx` 和 `packages/frontend/src/pages/admin/content.scss`
    - 页面功能：
      - 顶部工具栏：返回按钮 + 标题"内容管理"
      - 状态筛选标签栏：全部 | 待审核 | 已通过 | 已拒绝（默认待审核）
      - 内容列表：每行展示标题、上传者昵称、分类标签、状态标签、上传时间
      - 点击记录展示详情弹窗：完整内容信息、文档预览链接
      - 审核操作：
        - 通过按钮：确认后更新状态为 approved
        - 拒绝弹窗：输入拒绝原因（1~500 字符），确认后更新状态为 rejected
      - 删除操作：确认弹窗后删除内容及关联数据
      - 操作成功后刷新列表并显示提示
      - 下拉加载更多
    - API 调用：GET `/api/admin/content`、PATCH `/api/admin/content/:id/review`、DELETE `/api/admin/content/:id`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/content` 路由
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 17. 前端管理端分类管理页
  - [x] 17.1 创建管理端分类管理页面
    - 创建 `packages/frontend/src/pages/admin/categories.tsx` 和 `packages/frontend/src/pages/admin/categories.scss`
    - 页面功能：
      - 顶部工具栏：返回按钮 + 标题"分类管理" + 新建分类按钮
      - 分类列表：每行展示分类名称、创建时间、编辑/删除操作
      - 新建/编辑分类弹窗：分类名称输入
      - 删除确认弹窗
      - 操作成功后刷新列表
    - API 调用：GET `/api/content/categories`、POST `/api/admin/content/categories`、PUT `/api/admin/content/categories/:id`、DELETE `/api/admin/content/categories/:id`
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/categories` 路由
    - _需求: 2.6_

  - [x] 17.2 在管理面板首页和商城首页添加内容中心入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 的 ADMIN_LINKS 中添加两个导航卡片：
      - "内容管理"：跳转 `/pages/admin/content`
      - "分类管理"：跳转 `/pages/admin/categories`
    - 在商城首页或底部导航中添加"内容中心"入口，跳转 `/pages/content/index`
    - _需求: 2.1, 9.1_

- [x] 18. 检查点 - 前端管理端页面验证
  - 确保管理端内容管理页、分类管理页编译通过，路由注册正确，管理操作流程完整。如有问题请向用户确认。

- [x] 19. i18n 多语言翻译
  - [x] 19.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增 `contentHub` 模块：
      - `list`：内容列表页文案（标题、筛选标签、空状态、上传按钮、统计标签等）
      - `detail`：内容详情页文案（预览标签、预约按钮、下载按钮、评论区标题、评论输入占位符、提交评论、点赞等）
      - `upload`：内容上传页文案（表单标签、占位符、文件上传提示、格式限制、提交按钮、成功提示等）
      - `admin`：管理端内容管理文案（审核操作、状态标签、删除确认等）
      - `categories`：分类管理文案（新建、编辑、删除确认等）
    - 同时在 `admin.dashboard` 中新增 `contentTitle`、`contentDesc`、`categoriesTitle`、`categoriesDesc` 键
    - _需求: 10.1, 10.2_

  - [x] 19.2 添加 5 种语言翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加 `contentHub` 模块的简体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加 `contentHub` 模块的英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加 `contentHub` 模块的日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加 `contentHub` 模块的韩文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加 `contentHub` 模块的繁体中文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 10.1, 10.2, 10.3_

  - [x] 19.3 在内容中心前端页面中使用 i18n
    - 在内容列表页、详情页、上传页、管理端内容管理页、分类管理页中：
      - 导入 `useTranslation`，在组件顶部调用 `const { t } = useTranslation()`
      - 将所有硬编码文案替换为 `t('contentHub.xxx.xxx')` 调用
      - 保持动态内容（内容标题、描述、用户昵称等）不翻译
    - _需求: 10.1, 10.2_

- [x] 20. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 本次新增 5 张 DynamoDB 表（ContentItems、ContentCategories、ContentComments、ContentLikes、ContentReservations）和 1 个新 Content Lambda 函数
- 属性测试验证设计文档中定义的 19 个正确性属性
- 文档预览采用 Office Online Viewer（PPT/DOC）+ PDF.js（PDF），无需额外后端服务
- 使用预约时通过 DynamoDB TransactWriteItems 保证预约记录创建与积分发放的原子性
- 点赞操作幂等：PK=`{userId}#{contentId}` 天然保证同一用户对同一内容最多一条 Like 记录
- 预约去重：PK=`{userId}#{contentId}` + ConditionExpression 防止重复创建和重复发放积分
- 管理端内容路由扩展现有 Admin Lambda，复用管理员权限校验逻辑
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
