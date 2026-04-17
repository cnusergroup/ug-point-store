# 批量发分积分规则 - 设计

## 数据模型

### Settings 表扩展（feature-toggles）
在现有 `PointsMall-Settings` 表的 feature-toggles 记录中新增字段：

```typescript
interface PointsRuleConfig {
  uglPointsPerEvent: number;        // UGL 每场积分，默认 50
  volunteerPointsPerEvent: number;  // 志愿者每场积分，默认 30
  volunteerMaxPerEvent: number;     // 志愿者每场最大人数，默认 10
  speakerTypeAPoints: number;       // Speaker A类积分，默认 100
  speakerTypeBPoints: number;       // Speaker B类积分，默认 50
  speakerRoundtablePoints: number;  // 圆桌嘉宾积分，默认 50
}
```

存储位置：Settings 表 `pk=SETTINGS, sk=feature-toggles` 的 Item 中新增 `pointsRuleConfig` 字段。

### 默认值
当 `pointsRuleConfig` 不存在时，使用默认值：
- uglPointsPerEvent: 50
- volunteerPointsPerEvent: 30
- volunteerMaxPerEvent: 10
- speakerTypeAPoints: 100
- speakerTypeBPoints: 50
- speakerRoundtablePoints: 50

## API 变更

### GET /api/settings/feature-toggles
响应新增 `pointsRuleConfig` 字段（公开接口，Admin 和前端都可读取）。

### PUT /api/admin/settings/feature-toggles
请求体新增可选的 `pointsRuleConfig` 对象（仅 SuperAdmin）。

### POST /api/admin/batch-points
请求体新增：
- `speakerType?: 'typeA' | 'typeB' | 'roundtable'` — Speaker 发分时必填
- 后端校验：
  - 根据 targetRole + speakerType 从配置读取正确积分值
  - 验证请求中的 pointsPerPerson 是否与配置一致
  - Volunteer 时验证 userIds 数量 ≤ volunteerMaxPerEvent
  - 查询 BatchDistributions 表，检查同一活动+同一角色下是否已有重复用户，有则拒绝并返回重复用户列表

### GET /api/admin/batch-points/awarded?activityId={id}&targetRole={role}
新增接口，返回指定活动+角色下已获得积分的用户ID列表。
前端在选人时调用，用于标记不可选用户。

## 前端变更

### SuperAdmin 设置页面
在「功能设置」页面新增「积分规则配置」section：
- 6 个数字输入框，对应 6 个配置项
- 保存按钮，调用 PUT /api/admin/settings/feature-toggles

### Admin 批量发分页面
1. 调整流程顺序：活动 → 角色 → （Speaker类型）→ 选人 → 确认
2. 积分输入框改为只读显示，值从配置自动填入
3. Speaker 角色时显示类型选择器（A类/B类/圆桌嘉宾）
4. Volunteer 角色时，选人超过 maxCount 显示错误提示并阻止提交
5. 确认弹窗中显示积分来源说明（如"A类 Speaker 积分: 100"）
