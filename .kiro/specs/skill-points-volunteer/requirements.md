# 技能分归类为志愿者 — 需求文档

## 引言

当前批量发放积分时，技能认领分（直播支持 / 海报创作 / 推文排版）与活动基础分**合并写入同一条积分流水记录**，`targetRole` 取发放时选择的身份（如 UserGroupLeader）。这导致技能分被错误地计入发放身份的分类（如 UGL），无论实际是什么身份。

本需求要求：**无论发放时是什么身份，技能分一律归类为「志愿者（Volunteer）」分类**。分值不变，仅改变分类归属。同时需要对**已发放的历史技能分**做分类迁移。

### 关键既有事实（来自代码核对）

- 发放写入：`packages/backend/src/admin/batch-points.ts` 中 `totalUserPoints = activityPoints + skillPoints`，写**一条** `PointsRecords`，`targetRole = input.targetRole`。
- 用户表分类累计字段：`earnTotalLeader` / `earnTotalSpeaker` / `earnTotalVolunteer` 按 `totalUserPoints`（含技能分）累加到发放身份对应字段。
- 技能认领有精确记录表 `PointsMall-Claims`（ActivitySkillClaims）：每条含 `activityId`、`userId`、`skill`、`pointsAwarded`、`distributionId`、`claimedAt`，可精确还原每一笔历史技能分。
- 用户总余额字段 `points` 独立维护。

---

## 需求 1：发放逻辑——技能分独立成 Volunteer 记录

**用户故事：** 作为管理员，当我批量发放积分且包含技能认领时，我希望技能分作为独立的志愿者分类记录入账，以便分类统计准确。

#### 验收标准
1. WHEN 一次批量发放中某用户**既有活动基础分又有技能分** THEN 系统 SHALL 写入两条 `PointsRecords`：一条 `targetRole=<发放身份>` `amount=活动基础分`，一条 `targetRole=Volunteer` `amount=技能分`。
2. WHEN 某用户**仅有技能分**（不在 userIds 列表，只在 skillClaims） THEN 系统 SHALL 写入一条 `targetRole=Volunteer` `amount=技能分` 的记录。
3. WHEN 某用户**仅有活动基础分**（无技能认领） THEN 系统 SHALL 维持原行为，写一条 `targetRole=<发放身份>` 的记录。
4. 技能分记录 SHALL 保留 `activityId`、`activityUG`、`activityTopic`、`activityDate`、`activityType` 等活动信息。
5. 技能分记录的 `source` SHALL 清晰标识其为技能认领分（含技能类型）。
6. 用户总余额 `points` 的增量 SHALL 与改造前一致（基础分+技能分之和不变）。

## 需求 2：用户表分类累计字段

**用户故事：** 作为数据统计方，我希望用户表的角色分类累计字段正确反映技能分归属志愿者。

#### 验收标准
1. WHEN 发放含技能分 THEN 系统 SHALL 将技能分计入该用户的 `earnTotalVolunteer`，将活动基础分计入发放身份对应字段（`earnTotalLeader`/`earnTotalSpeaker`/`earnTotalVolunteer`）。
2. 用户的 `earnTotal`（总获得）SHALL 保持为基础分+技能分之和（不变）。

## 需求 3：历史数据迁移

**用户故事：** 作为管理员，我希望已经发放的历史技能分也被重新归类为志愿者，使新旧数据口径一致。

#### 验收标准
1. WHEN 执行迁移 THEN 系统 SHALL 依据 `PointsMall-Claims` 表的每条技能认领记录（userId/activityId/pointsAwarded/distributionId）定位对应的历史合并 `PointsRecords`。
2. WHEN 历史合并记录 `amount > 技能分`（含基础分） THEN 迁移 SHALL 将原记录 `amount` 减去技能分（还原为纯基础分，`targetRole` 不变），并新增一条 `targetRole=Volunteer` `amount=技能分` 的记录（保留活动信息）。
3. WHEN 历史合并记录 `amount == 技能分`（纯技能、无基础分） THEN 迁移 SHALL 直接将该记录 `targetRole` 改为 `Volunteer`。
4. WHEN 执行迁移 THEN 系统 SHALL 调整相关用户表字段：发放身份分类字段（`earnTotalLeader`/`earnTotalSpeaker`）减去技能分，`earnTotalVolunteer` 加上技能分。
5. 迁移 SHALL **不改变**任何用户的 `points` 总余额与 `earnTotal`。
6. 迁移 SHALL 可重复执行而不重复拆分（幂等：通过标记如 `skillSplit=true` 或检测已存在 Volunteer 技能记录避免重复）。
7. 迁移前 SHALL 输出将影响的记录数与用户数清单供人工确认。

## 需求 4：正确性与可验证

#### 验收标准
1. WHEN 迁移完成 THEN 每个受影响用户的 `points` 余额 SHALL 与迁移前完全一致。
2. WHEN 迁移完成 THEN 对每个受影响用户，`earnTotalLeader + earnTotalSpeaker + earnTotalVolunteer` 之和 SHALL 与迁移前一致。
3. 全系统技能分总额（来自 `PointsMall-Claims` 的 pointsAwarded 合计）SHALL 等于迁移后 `targetRole=Volunteer` 技能记录的 amount 合计。

## 需求 5：报表一致

#### 验收标准
1. WHEN 改造与迁移完成 THEN "用户积分排名"、"积分明细"等按 `targetRole` 统计的报表 SHALL 将技能分体现在 Volunteer 分类下，而非发放身份分类。
2. 报表的活动日期口径（activityDate）SHALL 不受影响。
