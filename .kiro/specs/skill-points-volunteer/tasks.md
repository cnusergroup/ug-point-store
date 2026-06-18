# 技能分归类为志愿者 — 实施任务

- [x] 1. 改造发放逻辑：技能分拆成独立 Volunteer 记录
  - 修改 `packages/backend/src/admin/batch-points.ts` 用户循环：
    - 拆分 `PointsRecords` 写入：基础分一条（原身份）、技能分一条（Volunteer），按需各自写入
    - 两条记录 balanceAfter 顺序累加；保留活动信息字段
    - 技能分记录新增 source 文案（标识技能认领 + 技能类型）
  - 调整用户表 Update：基础分计入发放身份字段，技能分计入 `earnTotalVolunteer`；`points`/`earnTotal` 仍按总额；当发放身份为 Volunteer 时合并为单一 += 表达式避免重复 SET
  - 注意 TransactWriteItems 25 项上限与分批计数
  - _需求: 1.1–1.6, 2.1–2.2_

- [x] 2. 发放逻辑单元测试
  - 在 `batch-points.test.ts` 增加用例：基础+技能 / 纯技能 / 纯基础 三场景
  - 断言：写入记录条数、各记录 targetRole 与 amount、用户表 earn{Role} 与 earnTotalVolunteer 增量、points/earnTotal 不变
  - _需求: 1.1–1.6, 2.1–2.2_

- [x] 3. 历史迁移脚本（dry-run + apply）
  - 新建脚本 `packages/backend/scripts/migrate-skill-points-to-volunteer.ts`
  - 遍历 `PointsMall-Claims`，按 (userId, activityId, distributionId) 聚合 skillSum
  - 定位历史合并 `PointsRecords`，按设计执行拆分/改分类（幂等：`skillSplit` 标记）
  - 调整用户表 earn{身份} -= skillSum、earnTotalVolunteer += skillSum；points/earnTotal 不变
  - 支持 `--dry-run`（仅输出影响记录数/用户数/技能分合计，不写）与 `--apply`
  - _需求: 3.1–3.7_

- [x] 4. 迁移脚本正确性测试
  - 构造测试数据验证：拆分正确、幂等重复执行无副作用、points/earnTotal 守恒、earn{Role} 三项之和守恒、技能分总额守恒
  - _需求: 4.1–4.3_

- [x] 5. 部署发放改造并验证
  - `npx tsc -b` + 部署 `PointsMall-ApiStack`
  - 线上做一次小额发放（含技能）验证新记录分类正确
  - _需求: 1, 2_

- [x] 6. 执行历史迁移
  - 跑 dry-run，输出影响清单，提交人工确认
  - 确认后跑 apply
  - 抽样核对受影响用户：points 不变、分类字段正确迁移
  - _需求: 3, 4_

- [x] 7. 报表核对
  - 用户积分排名 / 积分明细 按 targetRole 验证技能分体现在 Volunteer 分类
  - 确认 activityDate 口径未受影响
  - _需求: 5.1–5.2_
