# 批量发分积分规则 - 实现任务

## Task 1: 后端 — Settings 表扩展积分规则配置
- [x] 在 `packages/backend/src/settings/feature-toggles.ts` 中定义 `PointsRuleConfig` 接口和 `DEFAULT_POINTS_RULE_CONFIG` 常量
- [x] GET 时如果 `pointsRuleConfig` 不存在，返回默认值
- [x] PUT 时验证 `pointsRuleConfig` 中所有值为正整数
- [x] 仅 SuperAdmin 可修改

## Task 2: 后端 — 批量发分接口校验
- [x] `POST /api/admin/batch-points` 新增 `speakerType` 参数支持
- [x] 从 Settings 读取 `pointsRuleConfig`
- [x] 根据 targetRole + speakerType 计算正确积分值
- [x] 验证请求中 `pointsPerPerson` 与配置一致，不一致返回 400
- [x] Volunteer 时验证 userIds 数量 ≤ `volunteerMaxPerEvent`，超限返回 400
- [x] 查询 BatchDistributions 表，检查同一活动+角色下是否有重复用户，有则返回 400 + 重复用户列表
- [x] 在 batch distribution 记录中保存 `speakerType`（如适用）

## Task 2b: 后端 — 已发分用户查询接口
- [x] 新增 `GET /api/admin/batch-points/awarded?activityId={id}&targetRole={role}`
- [x] 查询 BatchDistributions 表，返回该活动+角色下已获得积分的用户ID列表
- [x] Admin 和 SuperAdmin 均可访问

## Task 3: 前端 — SuperAdmin 积分规则配置 UI
- [x] 在 `packages/frontend/src/pages/admin/settings.tsx` 新增「积分规则配置」section
- [x] 6 个数字输入框 + 保存按钮
- [x] 读取现有配置填入，保存时调用 PUT API
- [x] 添加 i18n 键（中文）

## Task 4: 前端 — 批量发分页面改造
- [x] 调整 `packages/frontend/src/pages/admin/batch-points.tsx` 流程
- [x] 步骤 1: 先选活动（已有）
- [x] 步骤 2: 选角色（Leader/Speaker/Volunteer）
- [x] 步骤 3: Speaker 时显示类型选择器（A类/B类/圆桌嘉宾）
- [x] 步骤 4: 选人列表
- [x] 积分值自动从配置读取，显示为只读标签（去掉手动输入框）
- [x] Volunteer 选人超限时显示错误提示
- [x] 选人列表中标记已获得该角色积分的用户（灰色不可选），调用 awarded 接口
- [x] 确认弹窗中显示积分规则说明
- [x] 添加 i18n 键

## Task 5: 测试与部署
- [x] 后端单元测试：积分规则配置读写、批量发分校验（25 feature-toggles tests + 34 batch-points tests pass）
- [x] 前端构建
- [x] CDK 部署后端
- [x] S3 + CloudFront 部署前端
