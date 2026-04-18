# SuperAdmin Quarterly Points Fix — Bugfix Design

## Overview

`executeBatchDistribution()` 中的 `POINTS_MISMATCH` 校验对所有调用方无差别生效，导致 SuperAdmin 通过 `handleQuarterlyAward()` 发放自定义积分值时被拦截。修复方案是在 `BatchDistributionInput` 接口中新增 `skipPointsValidation` 可选字段，使 `executeBatchDistribution()` 在该字段为 `true` 时跳过积分值校验，同时保持 Admin 常规批量发分的校验逻辑不变。

## Glossary

- **Bug_Condition (C)**: 调用 `executeBatchDistribution()` 时 `skipPointsValidation` 为 `true` 且 `points` 与 `calculateExpectedPoints()` 计算值不一致的情况
- **Property (P)**: 当 `skipPointsValidation` 为 `true` 时，积分发放应跳过 `POINTS_MISMATCH` 校验并成功执行
- **Preservation**: Admin 常规批量发分（`skipPointsValidation` 为 `false`/`undefined`）的 `POINTS_MISMATCH` 校验必须继续生效
- **`executeBatchDistribution()`**: `packages/backend/src/admin/batch-points.ts` 中的核心批量积分发放函数
- **`handleQuarterlyAward()`**: `packages/backend/src/admin/handler.ts` 中的 SuperAdmin 季度奖励处理函数，调用 `executeBatchDistribution()`
- **`POINTS_MISMATCH`**: 当 `input.points !== calculateExpectedPoints(...)` 时返回的错误码
- **`pointsRuleConfig`**: 存储在 feature-toggles 中的积分规则配置，定义各角色的固定积分值

## Bug Details

### Bug Condition

当 SuperAdmin 通过季度奖励接口调用 `executeBatchDistribution()` 时，函数内部的 `POINTS_MISMATCH` 校验无条件地将 `input.points` 与 `calculateExpectedPoints()` 的返回值进行比较。由于季度奖励允许自定义积分值，该值通常与配置值不一致，导致校验失败并返回错误。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type BatchDistributionInput
  OUTPUT: boolean

  config ← getFeatureToggles().pointsRuleConfig
  expectedPoints ← calculateExpectedPoints(input.targetRole, input.speakerType, config)

  RETURN input.skipPointsValidation = true
         AND input.points ≠ expectedPoints
END FUNCTION
```

### Examples

- SuperAdmin 发放季度奖励 200 分给 UserGroupLeader（配置值为 50 分）→ **当前**: 返回 `POINTS_MISMATCH` 错误 → **期望**: 成功发放
- SuperAdmin 发放季度奖励 500 分给 Speaker typeA（配置值为 100 分）→ **当前**: 返回 `POINTS_MISMATCH` 错误 → **期望**: 成功发放
- SuperAdmin 发放季度奖励 75 分给 Volunteer（配置值为 30 分）→ **当前**: 返回 `POINTS_MISMATCH` 错误 → **期望**: 成功发放
- SuperAdmin 发放季度奖励 50 分给 UserGroupLeader（配置值恰好为 50 分）→ **当前**: 成功（巧合）→ **期望**: 成功（但不应依赖配置值匹配）

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Admin 常规批量发分时，`POINTS_MISMATCH` 校验必须继续生效（`skipPointsValidation` 为 `false`/`undefined`）
- Admin 常规批量发分时，积分值与配置一致的请求必须继续正常执行
- 所有调用方的用户去重逻辑（`Set(input.userIds)`）必须继续生效
- 所有调用方的重复发放检查（`getAwardedUserIds`）必须继续生效
- Volunteer 人数限制校验（`volunteerMaxPerEvent`）必须继续生效
- 活动存在性校验（`activitiesTable` 提供时）必须继续生效

**Scope:**
所有不涉及 `skipPointsValidation` 字段的调用应完全不受此修复影响。这包括：
- Admin 常规批量发分（不传 `skipPointsValidation` 或传 `false`）
- 所有非积分校验相关的逻辑路径（去重、重复检查、事务写入、记录创建）

## Hypothesized Root Cause

基于代码分析，根因明确：

1. **无条件积分校验**: `executeBatchDistribution()` 在第 0b 步无条件执行 `POINTS_MISMATCH` 校验（`batch-points.ts` 第 ~165-175 行），没有任何机制允许调用方跳过此校验
   - 校验逻辑: `if (input.points !== expectedPoints) return { success: false, error: { code: 'POINTS_MISMATCH', ... } }`
   - 该校验在活动存在性检查之后、志愿者人数限制检查之前执行

2. **接口缺少跳过标志**: `BatchDistributionInput` 接口没有 `skipPointsValidation` 字段，`handleQuarterlyAward()` 无法告知 `executeBatchDistribution()` 跳过积分校验

3. **调用方无法区分**: `handleQuarterlyAward()` 和 Admin 常规批量发分使用完全相同的 `executeBatchDistribution()` 入口，没有任何参数区分两种调用场景

## Correctness Properties

Property 1: Bug Condition - SuperAdmin 季度奖励跳过积分校验

_For any_ input where `skipPointsValidation` is `true` and `points` is any positive integer (regardless of whether it matches `calculateExpectedPoints`), the fixed `executeBatchDistribution()` SHALL skip the `POINTS_MISMATCH` check and successfully distribute points, returning `success: true` with valid `distributionId`, `successCount`, and `totalPoints`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Admin 常规批量发分积分校验不变

_For any_ input where `skipPointsValidation` is `false` or `undefined` and `points` does not match `calculateExpectedPoints()`, the fixed `executeBatchDistribution()` SHALL return `POINTS_MISMATCH` error, producing the same result as the original function, preserving Admin batch distribution validation behavior.

**Validates: Requirements 3.1, 3.2**

## Fix Implementation

### Changes Required

根因已确认，修复方案如下：

**File**: `packages/backend/src/admin/batch-points.ts`

**Interface**: `BatchDistributionInput`

**Specific Changes**:
1. **新增可选字段**: 在 `BatchDistributionInput` 接口中添加 `skipPointsValidation?: boolean` 字段
   - 放在 `activityDate` 字段之后
   - 添加 JSDoc 注释说明用途

2. **条件跳过校验**: 在 `executeBatchDistribution()` 的 `POINTS_MISMATCH` 校验处，增加 `input.skipPointsValidation` 判断
   - 修改条件为: `if (!input.skipPointsValidation && input.points !== expectedPoints)`
   - 当 `skipPointsValidation` 为 `true` 时跳过整个积分值比较

**File**: `packages/backend/src/admin/handler.ts`

**Function**: `handleQuarterlyAward()`

**Specific Changes**:
3. **传递跳过标志**: 在 `handleQuarterlyAward()` 调用 `executeBatchDistribution()` 时，在 input 对象中添加 `skipPointsValidation: true`

## Testing Strategy

### Validation Approach

测试策略分两阶段：首先在未修复代码上验证 bug 存在（探索性测试），然后验证修复后的代码正确工作且不引入回归。

### Exploratory Bug Condition Checking

**Goal**: 在实施修复前，通过测试确认 bug 的存在和根因。

**Test Plan**: 编写测试模拟 SuperAdmin 季度奖励场景，传入与 `pointsRuleConfig` 不一致的自定义积分值，在未修复代码上运行以观察 `POINTS_MISMATCH` 错误。

**Test Cases**:
1. **自定义积分值测试**: 调用 `executeBatchDistribution()` 传入 `points=200`（配置值为 50），验证返回 `POINTS_MISMATCH`（未修复代码上会失败）
2. **多角色自定义积分测试**: 对 UserGroupLeader、Speaker、Volunteer 分别传入不同于配置的积分值（未修复代码上会失败）
3. **配置值匹配测试**: 传入恰好等于配置值的积分，验证成功（未修复代码上会通过，确认根因是积分值比较）

**Expected Counterexamples**:
- `executeBatchDistribution()` 对任何 `points !== expectedPoints` 的输入返回 `POINTS_MISMATCH`
- 根因确认: 无条件的 `if (input.points !== expectedPoints)` 检查

### Fix Checking

**Goal**: 验证对所有满足 bug condition 的输入，修复后的函数产生期望行为。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := executeBatchDistribution_fixed(input)
  ASSERT result.success = true
  ASSERT result.distributionId IS NOT NULL
  ASSERT result.successCount = |unique(input.userIds)|
  ASSERT result.totalPoints = result.successCount × input.points
END FOR
```

### Preservation Checking

**Goal**: 验证对所有不满足 bug condition 的输入，修复后的函数与原函数行为一致。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT executeBatchDistribution(input) = executeBatchDistribution_fixed(input)
END FOR
```

**Testing Approach**: 推荐使用属性基测试（PBT）进行保留性检查，因为：
- 自动生成大量测试用例覆盖输入域
- 捕获手动单元测试可能遗漏的边界情况
- 对非 bug 输入的行为不变提供强保证

**Test Plan**: 先在未修复代码上观察 Admin 常规批量发分的行为，然后编写属性基测试验证修复后行为一致。

**Test Cases**:
1. **Admin 积分不匹配保留**: 验证 `skipPointsValidation` 为 `undefined` 时，积分不匹配仍返回 `POINTS_MISMATCH`
2. **Admin 积分匹配保留**: 验证 `skipPointsValidation` 为 `undefined` 时，积分匹配的请求仍正常执行
3. **其他校验保留**: 验证 `skipPointsValidation=true` 时，用户去重、重复发放检查、志愿者人数限制等校验仍然生效

### Unit Tests

- 测试 `skipPointsValidation=true` 时自定义积分值成功发放
- 测试 `skipPointsValidation=false` 时积分不匹配返回 `POINTS_MISMATCH`
- 测试 `skipPointsValidation=undefined` 时积分不匹配返回 `POINTS_MISMATCH`（默认行为）
- 测试 `skipPointsValidation=true` 时其他校验（去重、重复检查、志愿者限制）仍然生效

### Property-Based Tests

- 生成随机正整数积分值和 `skipPointsValidation=true`，验证所有情况下发放成功
- 生成随机积分值和 `skipPointsValidation=undefined`，验证积分不匹配时返回错误、匹配时成功
- 生成随机用户列表（含重复），验证去重逻辑在两种模式下均正常工作

### Integration Tests

- 测试 `handleQuarterlyAward()` 完整流程：SuperAdmin 发放自定义积分值成功
- 测试 Admin 常规批量发分完整流程：积分不匹配被拒绝
- 测试 SuperAdmin 季度奖励与 Admin 批量发分交替执行，互不影响
