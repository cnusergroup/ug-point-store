# Tasks: 差旅 Tab 积分逻辑调整（Speaker 角色积分）

## Task 1: Backend - queryEarnTotal 增加 Speaker 角色过滤

- [x] 1.1 修改 `packages/backend/src/travel/apply.ts` 中的 `queryEarnTotal` 函数，在 FilterExpression 中增加 `targetRole = "Speaker"` 条件
  - 将 `FilterExpression: '#t = :earn'` 改为 `FilterExpression: '#t = :earn AND #tr = :speaker'`
  - 在 ExpressionAttributeNames 中增加 `'#tr': 'targetRole'`
  - 在 ExpressionAttributeValues 中增加 `':speaker': 'Speaker'`
- [x] 1.2 更新 `queryEarnTotal` 函数的 JSDoc 注释，说明现在仅统计 targetRole="Speaker" 的 earn 记录
- [x] 1.3 更新 `getTravelQuota` 函数的 JSDoc 注释，说明 earnTotal 现在仅包含 Speaker 角色积分

## Task 2: Shared Types - TravelQuota 字段重命名

- [x] 2.1 修改 `packages/shared/src/types.ts` 中 `TravelQuota` 接口，将 `earnTotal` 重命名为 `speakerEarnTotal`
- [x] 2.2 修改 `packages/backend/src/travel/apply.ts` 中 `getTravelQuota` 函数的返回值，将 `earnTotal` 改为 `speakerEarnTotal: earnTotal`
- [x] 2.3 修改 `packages/backend/src/travel/apply.ts` 中 `submitTravelApplication` 和 `resubmitTravelApplication` 函数中所有引用 earnTotal 变量的地方（局部变量名可保持不变，仅确保返回值和接口一致）

## Task 3: Frontend - Mall Page 差旅卡片展示 Speaker 积分进度

- [x] 3.1 在 `packages/frontend/src/pages/index/index.tsx` 的 `renderTravelCard` 函数中，新增 Speaker 积分进度行，显示 `speakerEarnTotal / threshold`
- [x] 3.2 实现积分进度颜色逻辑：`speakerEarnTotal >= threshold` 时使用 `--success` 色，否则使用 `--text-secondary` 色
- [x] 3.3 更新差旅卡片门槛文案，使用新的 i18n 键 `mall.travelSpeakerThreshold`（替换 `mall.travelThreshold`）
- [x] 3.4 更新积分不足提示文案，使用新的 i18n 键 `mall.travelSpeakerInsufficientPoints`（替换 `mall.travelInsufficientPoints`）
- [x] 3.5 在 `packages/frontend/src/pages/index/index.scss` 中添加 Speaker 积分进度行的样式

## Task 4: Frontend - My Travel Page 展示 Speaker 积分明细

- [x] 4.1 在 `packages/frontend/src/pages/my-travel/index.tsx` 的配额概览区域新增 Speaker 积分明细卡片组（speakerEarnTotal、travelEarnUsed、domesticThreshold、internationalThreshold）
- [x] 4.2 保留现有的"国内 X 次 / 国际 Y 次"可用次数卡片
- [x] 4.3 在 `packages/frontend/src/pages/my-travel/index.scss` 中添加积分明细卡片组的样式

## Task 5: i18n - 更新和新增翻译键

- [x] 5.1 在 `packages/frontend/src/i18n/types.ts` 中新增翻译键类型定义：`mall.travelSpeakerPoints`、`mall.travelSpeakerThreshold`、`mall.travelSpeakerInsufficientPoints`、`travel.myTravel.speakerEarnTotal`、`travel.myTravel.travelEarnUsed`、`travel.myTravel.domesticThresholdLabel`、`travel.myTravel.internationalThresholdLabel`
- [x] 5.2 在 `packages/frontend/src/i18n/zh.ts` 中添加中文翻译
- [x] 5.3 在 `packages/frontend/src/i18n/en.ts` 中添加英文翻译
- [x] 5.4 在 `packages/frontend/src/i18n/ja.ts` 中添加日文翻译
- [x] 5.5 在 `packages/frontend/src/i18n/ko.ts` 中添加韩文翻译
- [x] 5.6 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加繁体中文翻译

## Task 6: Frontend - TravelQuota 字段引用同步更新

- [x] 6.1 在 `packages/frontend/src/pages/index/index.tsx` 中将所有 `travelQuota.earnTotal` 引用更新为 `travelQuota.speakerEarnTotal`（如有）
- [x] 6.2 在 `packages/frontend/src/pages/my-travel/index.tsx` 中将所有 `quota.earnTotal` 引用更新为 `quota.speakerEarnTotal`（如有）
- [x] 6.3 全局搜索其他前端文件中对 `TravelQuota.earnTotal` 的引用并同步更新

## Task 7: Testing - 属性测试和单元测试

- [x] 7.1 在 `packages/backend/src/travel/apply.property.test.ts` 中新增 Property 1 测试：生成混合 targetRole 的 PointsRecords mock 数据，验证 queryEarnTotal 仅汇总 Speaker 角色记录
- [x] 7.2 更新现有 Property 5（submitTravelApplication）的 mock 数据，确保 queryEarnTotal mock 返回的是 Speaker 过滤后的值
- [x] 7.3 更新现有 Property 11（resubmitTravelApplication）的 mock 数据，确保一致性
- [x] 7.4 运行全部测试确保通过：`npx vitest --run packages/backend/src/travel/`
- [x] 7.5 运行 TypeScript 编译检查确保无类型错误
