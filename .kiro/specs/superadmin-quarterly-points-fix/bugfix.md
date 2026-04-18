# Bugfix Requirements Document

## Introduction

SuperAdmin 通过季度奖励功能（`handleQuarterlyAward`）向社区成员发放自定义积分时，被 `executeBatchDistribution()` 中的固定积分值校验（`POINTS_MISMATCH`）拦截，导致无法成功发放。该校验原本仅应限制 Admin 的常规批量发分操作（积分值必须与 `pointsRuleConfig` 配置一致），但当前实现对所有调用方无差别生效，阻断了 SuperAdmin 设置自定义积分值的能力。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN SuperAdmin 通过季度奖励接口发放自定义积分值（与 pointsRuleConfig 配置不一致）THEN the system 返回 POINTS_MISMATCH 错误，拒绝发放

1.2 WHEN SuperAdmin 通过季度奖励接口发放积分值恰好等于 pointsRuleConfig 配置值 THEN the system 允许发放，但这仅是巧合而非设计意图，SuperAdmin 的自定义积分能力实质上被剥夺

### Expected Behavior (Correct)

2.1 WHEN SuperAdmin 通过季度奖励接口发放自定义积分值（与 pointsRuleConfig 配置不一致）THEN the system SHALL 跳过 POINTS_MISMATCH 校验，正常执行积分发放

2.2 WHEN SuperAdmin 通过季度奖励接口发放任意正整数积分值 THEN the system SHALL 成功完成发放并返回 distributionId、successCount 和 totalPoints

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Admin 通过常规批量发分接口发放积分且积分值与 pointsRuleConfig 配置不一致 THEN the system SHALL CONTINUE TO 返回 POINTS_MISMATCH 错误，拒绝发放

3.2 WHEN Admin 通过常规批量发分接口发放积分且积分值与 pointsRuleConfig 配置一致 THEN the system SHALL CONTINUE TO 正常执行积分发放

3.3 WHEN 任何调用方通过 executeBatchDistribution 发放积分 THEN the system SHALL CONTINUE TO 执行用户去重、重复发放检查、志愿者人数限制等其他校验逻辑

3.4 WHEN Admin 批量发分时 targetRole 为 Volunteer 且人数超过 volunteerMaxPerEvent THEN the system SHALL CONTINUE TO 返回 VOLUNTEER_LIMIT_EXCEEDED 错误

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type BatchDistributionCall
  OUTPUT: boolean
  
  // Returns true when the caller is SuperAdmin quarterly award
  // (i.e., the call should skip points validation)
  RETURN X.skipPointsValidation = true AND X.points ≠ calculateExpectedPoints(X.targetRole, X.speakerType, config)
END FUNCTION
```

## Property Specification

```pascal
// Property: Fix Checking — SuperAdmin quarterly award with custom points
FOR ALL X WHERE isBugCondition(X) DO
  result ← executeBatchDistribution'(X)
  ASSERT result.success = true
  ASSERT result.distributionId IS NOT NULL
  ASSERT result.successCount = |unique(X.userIds)|
  ASSERT result.totalPoints = result.successCount × X.points
END FOR
```

## Preservation Goal

```pascal
// Property: Preservation Checking — Admin batch distribution still enforces points validation
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT executeBatchDistribution(X) = executeBatchDistribution'(X)
END FOR
```
