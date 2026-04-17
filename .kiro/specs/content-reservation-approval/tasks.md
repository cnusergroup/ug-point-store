# 任务列表：内容预约活动审批（Content Reservation Approval）

## 任务

- [x] 1. Shared 类型与错误码扩展
  - [x] 1.1 在 `packages/shared/src/types.ts` 中扩展 ContentReservation 接口，新增 activityId、activityType、activityUG、activityTopic、activityDate、status、reviewerId、reviewedAt 字段
  - [x] 1.2 在 ErrorCodes 和 ErrorMessages 中新增 DUPLICATE_ACTIVITY_RESERVATION、RESERVATION_ALREADY_REVIEWED、ACTIVITY_NOT_FOUND 错误码
  - [x] 1.3 新增 ReservationStatus 类型（'pending' | 'approved' | 'rejected'）和 ReservationApprovalItem 接口

- [x] 2. CDK 基础设施变更
  - [x] 2.1 在 `packages/cdk/lib/database-stack.ts` 中为 ContentReservations 表新增 status-createdAt-index GSI（PK=status, SK=createdAt）
  - [x] 2.2 在 `packages/cdk/lib/database-stack.ts` 中为 ContentReservations 表新增 userId-activityId-index GSI（PK=userId, SK=activityId）
  - [x] 2.3 在 `packages/cdk/lib/api-stack.ts` 中为 Content Lambda 新增 ACTIVITIES_TABLE 和 UGS_TABLE 环境变量及读权限

- [x] 3. 预约流程后端改造
  - [x] 3.1 改造 `packages/backend/src/content/reservation.ts` 的 CreateReservationInput 接口，新增 activityId、activityType、activityUG、activityTopic、activityDate 字段
  - [x] 3.2 改造 createReservation 函数：新增 activityId 存在性验证（查询 Activities 表）
  - [x] 3.3 改造 createReservation 函数：新增 userId+activityId 去重检查（查询 userId-activityId-index GSI）
  - [x] 3.4 改造 createReservation 函数：移除积分发放逻辑（移除 TransactWriteCommand 中的 Users 积分更新和 PointsRecords 写入），仅保留预约记录创建和 reservationCount 递增
  - [x] 3.5 改造 createReservation 函数：预约记录新增 status=pending 和活动快照字段
  - [x] 3.6 更新 `packages/backend/src/content/handler.ts` 的 handleCreateReservation，从请求体解析活动字段并传入 createReservation，新增 activitiesTable 参数
  - [x] 3.7 更新现有 reservation.test.ts 和 reservation.property.test.ts 测试以适配新逻辑

- [x] 4. 预约审批后端服务
  - [x] 4.1 新建 `packages/backend/src/content/reservation-approval.ts`，实现 reviewReservation 函数（approve: 原子更新状态+发放积分+创建积分记录；reject: 更新状态）
  - [x] 4.2 实现 listReservationApprovals 函数，支持按 status 查询（使用 status-createdAt-index GSI）和 UG 名称过滤
  - [x] 4.3 实现可见性逻辑：SuperAdmin 看全部，Leader Admin 看负责 UG，普通 Admin 看无 Leader 的 UG
  - [x] 4.4 编写 reservation-approval.test.ts 单元测试
  - [x] 4.5 编写 reservation-approval.property.test.ts 属性测试（Properties 1-4, 6-9, 12）

- [x] 5. 活动列表接口
  - [x] 5.1 在 `packages/backend/src/content/handler.ts` 中新增 GET /api/content/reservation-activities 路由
  - [x] 5.2 实现活动列表查询逻辑：查询 active UGs → 过滤活动 → 按 activityDate 倒序 → 分页
  - [x] 5.3 编写活动列表接口测试

- [x] 6. Admin Handler 路由扩展
  - [x] 6.1 在 `packages/backend/src/admin/handler.ts` 中新增 GET /api/admin/reservation-approvals 路由
  - [x] 6.2 在 `packages/backend/src/admin/handler.ts` 中新增 PATCH /api/admin/reservation-approvals/{pk}/review 路由
  - [x] 6.3 实现路由处理函数，调用 reservation-approval.ts 的业务逻辑
  - [x] 6.4 更新 admin handler.test.ts 测试

- [x] 7. 预约积分值配置
  - [x] 7.1 在 `packages/backend/src/settings/feature-toggles.ts` 中扩展 FeatureToggles 接口，新增 reservationApprovalPoints 字段（默认 10）
  - [x] 7.2 更新 getFeatureToggles 和 updateFeatureToggles 函数支持新字段

- [x] 8. 前端 — 活动选择器组件
  - [x] 8.1 在内容详情页中实现活动选择器弹窗（Activity Selector Modal），包含活动列表、搜索框、确认按钮
  - [x] 8.2 调用 GET /api/content/reservation-activities 获取活动列表
  - [x] 8.3 实现客户端搜索过滤（按 UG 名称、主题、日期模糊匹配）
  - [x] 8.4 改造预约按钮点击逻辑：先弹出活动选择器，选择后再调用预约接口（传入活动信息）

- [x] 9. 前端 — 预约审批管理页面
  - [x] 9.1 新建 `packages/frontend/src/pages/admin/reservation-approvals.tsx` 页面
  - [x] 9.2 新建 `packages/frontend/src/pages/admin/reservation-approvals.scss` 样式文件
  - [x] 9.3 实现状态筛选标签（全部 / 待审批 / 已通过 / 已拒绝）
  - [x] 9.4 实现预约列表展示（内容标题、预约人、活动信息、状态、操作按钮）
  - [x] 9.5 实现通过/拒绝操作弹窗
  - [x] 9.6 实现分页加载
  - [x] 9.7 在 Admin Dashboard 中新增"活动预约审批"导航卡片

- [x] 10. 前端 — 设置页面扩展
  - [x] 10.1 在 Settings 页面新增"预约审批积分值"配置项（SuperAdmin 可见），包含正整数输入框和保存逻辑

- [x] 11. 前端 — Taro 路由注册
  - [x] 11.1 在 `packages/frontend/src/app.config.ts` 中注册 reservation-approvals 页面路由

- [x] 12. 国际化支持
  - [x] 12.1 在 `packages/frontend/src/i18n/types.ts` 中新增活动选择器、预约审批页面、积分配置相关翻译键
  - [x] 12.2 在 zh.ts（简体中文）中添加翻译
  - [x] 12.3 在 en.ts（英文）中添加翻译
  - [x] 12.4 在 ja.ts（日文）中添加翻译
  - [x] 12.5 在 ko.ts（韩文）中添加翻译
  - [x] 12.6 在 zh-TW.ts（繁体中文）中添加翻译
