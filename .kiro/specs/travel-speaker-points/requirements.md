# 需求文档：差旅 Tab 积分逻辑调整（Speaker 角色积分）

## 简介

当前差旅赞助系统中，`queryEarnTotal` 函数计算用户累计获得积分时，汇总了用户所有 `type = "earn"` 的 PointsRecord 记录，未区分 `targetRole` 字段。这导致用户以 Volunteer 或 UserGroupLeader 角色获得的积分也被计入差旅资格判定，与业务意图不符。本需求将差旅资格判定逻辑调整为仅统计 Speaker 角色获得的积分，同时在前端差旅相关页面展示 Speaker 积分明细（累计获得、已兑换消耗、国内/国际差旅门槛），并更新相关文案描述。

## 术语表

- **Speaker_Earn_Total（Speaker 累计获得积分）**：用户所有 `type = "earn"` 且 `targetRole = "Speaker"` 的 PointsRecord 的 amount 总和
- **Travel_Earn_Used（差旅已消耗积分）**：用户已用于差旅申请（pending + approved 状态）的累计 earn 配额，存储在 Users 表的 travelEarnUsed 字段
- **Travel_Quota_Service（差旅配额服务）**：后端处理差旅配额查询的服务模块，位于 `packages/backend/src/travel/apply.ts`
- **Mall_Page（商城页面）**：积分商城首页，包含差旅标签页和差旅卡片视图
- **My_Travel_Page（我的差旅页面）**：Speaker 查看差旅申请历史和配额概览的前端页面
- **TravelQuota（差旅配额接口）**：`/api/travel/quota` 返回的配额数据结构，定义在 `packages/shared/src/types.ts`
- **Domestic_Threshold（国内差旅门槛）**：SuperAdmin 设置的申请一次国内差旅所需的 Speaker 累计获得积分
- **International_Threshold（国际差旅门槛）**：SuperAdmin 设置的申请一次国际差旅所需的 Speaker 累计获得积分
- **Available_Travel_Count（可用差旅次数）**：`floor((speakerEarnTotal - travelEarnUsed) / threshold)`

## 需求

### 需求 1：后端 queryEarnTotal 按 Speaker 角色过滤

**用户故事：** 作为系统，我希望差旅资格判定仅基于 Speaker 角色获得的积分，以便准确反映 Speaker 贡献与差旅赞助的对应关系。

#### 验收标准

1. WHEN Travel_Quota_Service 计算用户的累计获得积分时, THE Travel_Quota_Service SHALL 仅汇总 PointsRecords 表中该用户 `type = "earn"` 且 `targetRole = "Speaker"` 的记录的 amount 总和
2. THE Travel_Quota_Service SHALL 在 QueryCommand 的 FilterExpression 中同时过滤 `type = "earn"` 和 `targetRole = "Speaker"` 两个条件
3. WHEN 用户没有任何 `targetRole = "Speaker"` 的 earn 记录时, THE Travel_Quota_Service SHALL 返回 Speaker_Earn_Total 为 0
4. THE Travel_Quota_Service SHALL 在 submitTravelApplication 和 resubmitTravelApplication 函数中使用相同的 Speaker 角色过滤逻辑计算 earnTotal

### 需求 2：TravelQuota API 响应增加 Speaker 积分字段

**用户故事：** 作为 Speaker，我希望差旅配额接口返回 Speaker 角色积分明细，以便前端展示完整的积分概览信息。

#### 验收标准

1. WHEN Speaker 请求 GET /api/travel/quota, THE Travel_Quota_Service SHALL 返回以下字段：speakerEarnTotal（Speaker 累计获得积分）、travelEarnUsed（差旅已消耗积分）、domesticAvailable（国内可用次数）、internationalAvailable（国际可用次数）、domesticThreshold（国内差旅门槛）、internationalThreshold（国际差旅门槛）
2. THE TravelQuota 接口的 earnTotal 字段 SHALL 重命名为 speakerEarnTotal，明确表示该值仅包含 Speaker 角色获得的积分
3. THE TravelQuota TypeScript 接口定义（packages/shared/src/types.ts）SHALL 将 earnTotal 字段更新为 speakerEarnTotal
4. THE Travel_Quota_Service SHALL 确保 domesticAvailable 和 internationalAvailable 的计算公式使用 speakerEarnTotal：`floor((speakerEarnTotal - travelEarnUsed) / threshold)`

### 需求 3：商城页面差旅卡片展示 Speaker 积分进度

**用户故事：** 作为 Speaker，我希望在商城页面的差旅卡片上看到 Speaker 积分进度，以便直观了解距离差旅门槛还差多少积分。

#### 验收标准

1. WHEN 差旅标签页加载完成且用户拥有 Speaker 角色, THE Mall_Page SHALL 在每张差旅卡片上显示 Speaker 积分进度信息，格式为"Speaker 积分: {speakerEarnTotal}/{threshold}"
2. THE Mall_Page SHALL 在差旅卡片的积分进度文案中使用 i18n 翻译键，支持多语言显示
3. WHEN speakerEarnTotal 大于等于 threshold, THE Mall_Page SHALL 将积分进度文本显示为成功色（使用 CSS 变量 `--success`）
4. WHEN speakerEarnTotal 小于 threshold, THE Mall_Page SHALL 将积分进度文本显示为默认次要色（使用 CSS 变量 `--text-secondary`）

### 需求 4：我的差旅页面展示 Speaker 积分明细

**用户故事：** 作为 Speaker，我希望在我的差旅页面看到 Speaker 角色的积分明细，以便了解累计获得积分、已消耗积分和差旅门槛。

#### 验收标准

1. THE My_Travel_Page SHALL 在页面顶部配额概览区域展示以下四项信息：Speaker 累计获得积分（speakerEarnTotal）、已兑换消耗积分（travelEarnUsed）、国内差旅门槛（domesticThreshold）、国际差旅门槛（internationalThreshold）
2. THE My_Travel_Page SHALL 将现有的"国内 X 次 / 国际 Y 次"可用次数概览保留，作为配额概览的一部分
3. THE My_Travel_Page SHALL 使用清晰的分组布局展示积分明细，将 Speaker 累计获得积分和已消耗积分放在第一行，国内门槛和国际门槛放在第二行
4. THE My_Travel_Page SHALL 为所有新增的积分明细文案使用 i18n 翻译键

### 需求 5：前端文案更新为 Speaker 角色积分描述

**用户故事：** 作为用户，我希望差旅相关页面的文案明确说明资格基于 Speaker 角色获得的积分，以便正确理解差旅赞助的申请条件。

#### 验收标准

1. THE Mall_Page SHALL 将差旅卡片的积分门槛描述从"所需积分门槛: {threshold}"更新为"Speaker 积分门槛: {threshold}"
2. THE Mall_Page SHALL 将积分不足提示从"累计积分不足"更新为"Speaker 积分不足"
3. THE My_Travel_Page SHALL 在配额概览区域的标签文案中明确标注"Speaker"前缀，区分于总积分
4. THE i18n_System SHALL 在 zh、en、ja、ko、zh-TW 五种语言文件中更新和新增差旅相关翻译键
5. THE i18n_System SHALL 新增以下翻译键类别：Speaker 积分进度文案（mall.travelSpeakerPoints）、Speaker 积分明细标签（travel.myTravel.speakerEarnTotal、travel.myTravel.travelEarnUsed、travel.myTravel.domesticThresholdLabel、travel.myTravel.internationalThresholdLabel）

### 需求 6：前端引用 TravelQuota 字段名同步更新

**用户故事：** 作为开发者，我希望前端代码中所有引用 TravelQuota.earnTotal 的地方同步更新为 speakerEarnTotal，以便保持前后端类型一致。

#### 验收标准

1. THE Mall_Page SHALL 将所有引用 `travelQuota.earnTotal` 的代码更新为 `travelQuota.speakerEarnTotal`
2. THE My_Travel_Page SHALL 将所有引用 `quota.earnTotal` 的代码更新为 `quota.speakerEarnTotal`
3. IF 其他前端页面引用了 TravelQuota 的 earnTotal 字段, THEN THE Frontend SHALL 同步更新为 speakerEarnTotal
4. THE Frontend SHALL 确保 TypeScript 编译无类型错误
