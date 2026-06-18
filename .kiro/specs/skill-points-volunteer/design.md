# 技能分归类为志愿者 — 设计文档

## 1. 现状分析

### 发放写入（`packages/backend/src/admin/batch-points.ts`）
对 `allUniqueUserIds`（userIds ∪ skillClaims.userIds）中每个用户：
```
activityPoints = isActivityUser ? input.points : 0
skillPoints    = Σ(认领技能对应配置分)
totalUserPoints = activityPoints + skillPoints
→ 用户表: points += total, earnTotal += total, earn{Role} += total   // {Role}=发放身份
→ PointsRecords: 1 条, amount=total, targetRole=input.targetRole
```

### 关键依赖
- 技能配置：`pointsRuleConfig.{liveSupportPoints, posterDesignPoints, articleEditingPoints}`
- 技能认领表 `PointsMall-Claims`（env `CLAIMS_TABLE`）：PK=activityId, SK=skill；字段 userId/pointsAwarded/distributionId/claimedAt。
- 发放批次表 `PointsMall-BatchDistributions`：记录每次发放（distributionId、activityId、targetRole 等）。

## 2. 发放逻辑改造

在用户循环内，将「合并写一条」改为「按来源拆分」：

```
activityPoints = isActivityUser ? input.points : 0
skillPoints    = Σ skill config
roleField      = earnTotalLeader/Speaker/Volunteer (按 input.targetRole)

// 用户表更新（一次 Update 完成，保证 points/earnTotal 不变）
SET points     += (activityPoints + skillPoints)
    earnTotal  += (activityPoints + skillPoints)
    {roleField}        += activityPoints        // 基础分计入发放身份
    earnTotalVolunteer += skillPoints           // 技能分计入志愿者
// 注意：当 input.targetRole === 'Volunteer' 时，roleField 本身就是 earnTotalVolunteer，
//       需合并为单个 += (activityPoints + skillPoints) 表达式，避免对同一字段两次 SET。

// PointsRecords：
if (activityPoints > 0) 写记录A: amount=activityPoints, targetRole=input.targetRole, source=活动基础分
if (skillPoints   > 0) 写记录B: amount=skillPoints,    targetRole='Volunteer',     source=技能认领分(含技能名)
// 两条 balanceAfter 顺序累加：先A后B（若都存在）
```

### balanceAfter 处理
当前用单条 `newBalance`。改造后若拆两条：
- recordA.balanceAfter = currentBalance + activityPoints
- recordB.balanceAfter = currentBalance + activityPoints + skillPoints
- 仅有一条时即为该条的累加结果。

### source 文案
- 基础分：沿用 `buildMergedSource`（仅活动部分，不含技能）。
- 技能分：新增构造，如 `技能认领:Volunteer|{UG}|{topic}|{date}|技能:海报创作,直播支持`。

### 事务性
记录A、记录B、用户表 Update、技能认领 Put 仍在同一 `TransactWriteItems` 内（注意 25 项上限；批量发放本就分批，技能分增加的写入项需纳入分批计数）。

## 3. 用户表字段语义

| 字段 | 改造后含义 |
|------|-----------|
| points | 不变（基础+技能总额累加） |
| earnTotal | 不变（基础+技能总额） |
| earnTotalLeader/Speaker | 仅累计该身份的**活动基础分** |
| earnTotalVolunteer | 累计 Volunteer 活动基础分 **+ 所有技能分** |

## 4. 历史数据迁移

### 数据来源
遍历 `PointsMall-Claims` 全表，每条 = 一笔历史技能分（userId, activityId, skill, pointsAwarded, distributionId）。

按 (userId, activityId, distributionId) 聚合该用户在该次发放的技能分合计 `skillSum`。

### 定位历史 PointsRecords
对每个 (userId, activityId)：查该用户在该 activityId 的 earn 记录（scan userId 过滤 activityId，或用 source 含 distributionId 辅助）。匹配「合并记录」= 含技能分的那条（targetRole 为发放身份、amount 包含 skillSum）。

### 迁移操作（幂等）
对每条命中的合并记录 R（amount=A，targetRole=Role）：
- **若已存在该 (userId,activityId) 的 Volunteer 技能记录，或 R 带标记 `skillSplit=true`** → 跳过（幂等）。
- **若 A > skillSum**（含基础分）：
  - 更新 R：`amount = A - skillSum`，加标记 `skillSplit=true`，balanceAfter 不强制修正（历史展示值，余额以 users.points 为准）。
  - 新增记录 V：`targetRole=Volunteer, amount=skillSum`, 保留活动字段, source=技能认领分, `skillSplit=true`。
- **若 A == skillSum**（纯技能）：
  - 更新 R：`targetRole=Volunteer`，加标记 `skillSplit=true`。
- 用户表：`{发放身份字段} -= skillSum`，`earnTotalVolunteer += skillSum`。**points / earnTotal 不变**。

### 安全与可回滚
- 迁移脚本分两阶段：① **dry-run**：仅扫描+输出"将影响 X 条记录、Y 个用户、技能分合计 Z"，不写任何数据；② **apply**：人工确认后执行。
- 写操作前对每个用户记录迁移前的 `earnTotalLeader/Speaker/Volunteer` 快照（日志），便于核对/回滚。
- 用 `skillSplit` 标记保证可重复执行不重复拆分。

## 5. 边界情况
- 用户当次纯技能、`input.targetRole` 恰为 Volunteer：基础分=0，技能分记录即 Volunteer，无需额外区分（合并为一条 Volunteer 即可）。
- 一个用户在同一活动多次/多技能：skillSum 为合计。
- 技能配置分值历史变化：迁移以 `Claims.pointsAwarded`（发放当时记录的实际分）为准，不重新按当前配置计算。

## 6. 测试策略
- 单元测试（batch-points）：基础+技能、纯技能、纯基础三种场景下记录条数、targetRole、amount、用户表字段增量正确；points/earnTotal 不变。
- 迁移脚本：构造含合并记录的测试数据，验证拆分正确、幂等、points/earnTotal 守恒、earn{Role} 守恒。
- 回归：现有 batch-points 测试全绿。

## 7. 部署与执行顺序
1. 部署发放逻辑改造（ApiStack）——之后新发放即正确分类。
2. 跑迁移 dry-run，输出影响清单，人工确认。
3. 跑迁移 apply。
4. 抽样验证 + 报表核对。
