# Requirements Document

> 需求文档：昵称修改（Nickname Change）

## Introduction

本功能为积分商城现有「设置」（Settings）页面新增一项自助能力：允许已登录用户（包括普通用户与 AWS 员工）自行修改自己的昵称（`Users.nickname`）。改名后，系统中通过 userId 实时查询/实时关联昵称的展示（个人资料页、员工参与度查询、内容排行榜、积分排行榜、活跃员工报表等）无需任何额外开发即自动生效；而记录改名前昵称文本快照的历史记录（如积分申请记录、批量发放记录、内容中心记录、差旅申请记录、预约审批记录、邀请记录、UG 记录、榜单公告记录等）保留原文，不做批量回填，这是预期行为。

为防止滥用，本功能新增昵称唯一性校验与改名频率限制。本功能复用现有「修改密码」的前端 UI 模式（设置页展开式表单）与后端更新模式（`Users` 表按 `userId` 更新），且不需要重新登录或重新签发身份令牌（JWT 中不缓存昵称）。

## Glossary

术语表：

- **User（用户）**：`Users` 表中的一条用户记录，主键为 `userId`，包含 `nickname` 字段。
- **Nickname（昵称）**：`Users.nickname` 字段，即用户在系统内展示的名称。
- **Nickname_Change_Service（昵称修改服务）**：本功能新增的后端逻辑，负责校验并更新用户昵称。
- **Settings_Page（设置页）**：现有前端个人设置页面，本功能在其中新增「修改昵称」表单入口，UI 模式与现有「修改密码」表单一致。
- **Change_Cooldown_Period（改名冷却期）**：同一用户两次成功改名之间必须间隔的最短时长，用于防止短时间内频繁改名造成混乱。取值为 24 小时。
- **Snapshot_Field（历史快照字段）**：数据表中记录操作发生时昵称原文的字段（如 `ClaimRecord.applicantNickname`、`DistributionRecord.distributorNickname` 等），一经写入不随用户后续改名回填。
- **Live_Join_Display（实时展示）**：通过 `userId` 从 `Users` 表实时读取 `nickname` 的展示场景（如个人资料页、员工参与度查询、积分排行榜），改名后自动反映最新昵称。
- **Nickname_History（昵称历史）**：`Users.nicknameHistory` 字段，数组类型，记录该用户历次改名前的昵称文本及对应改名时间，用于审计与客服排查。

## Requirements

### Requirement 1: 用户自助修改昵称

**User Story:** 作为已登录用户，我希望能在设置页修改自己的昵称，以便更新我在系统中展示的名称。

#### Acceptance Criteria

1. THE Settings_Page SHALL 提供一个「修改昵称」表单入口，交互方式（展开/收起表单）与现有「修改密码」表单一致
2. WHEN 用户在「修改昵称」表单中输入新昵称并提交时，THE Nickname_Change_Service SHALL 校验新昵称格式是否合法
3. WHEN 新昵称通过全部校验（格式、唯一性、频率限制）时，THE Nickname_Change_Service SHALL 将该用户的 `Users.nickname` 更新为新昵称，并在 3 秒内返回成功结果；THE Nickname_Change_Service SHALL 将该次更新操作视为成功，无论数据库中该字段的最终存储值是否与更新前不同
4. WHEN 昵称修改成功后，THE Settings_Page SHALL 刷新本地缓存的用户信息（复用现有 `fetchProfile` 逻辑），使昵称变更立即反映在当前会话的界面上
5. THE 昵称修改操作 SHALL 不要求用户重新登录，且 SHALL 不触发身份令牌（JWT）的重新签发
6. IF 用户提交的新昵称去除首尾空白后与该用户当前昵称完全相同（区分大小写比较），THEN THE Nickname_Change_Service SHALL 拒绝该请求、保持该用户全部字段（包括更新时间戳）不变，并返回提示「新昵称与当前昵称相同」的描述性错误
7. IF 昵称修改请求缺少必填的新昵称字段，THEN THE Nickname_Change_Service SHALL 拒绝该请求，不更新任何用户记录，并返回描述性错误

### Requirement 2: 昵称格式校验

**User Story:** 作为系统，我需要对用户提交的新昵称进行格式校验，以保证展示效果与数据一致性。

#### Acceptance Criteria

1. THE Nickname_Change_Service SHALL 在校验前对用户提交的新昵称去除首尾空白（trim）
2. THE Nickname_Change_Service SHALL 校验去除首尾空白后的新昵称长度是否在 1 至 20 个字符（按 Unicode 码点计数）范围内（假设默认值：与现有代码库中昵称相关测试及展示位宽的既有约定 1–20 字符保持一致；此数值为默认假设，如需调整可在后续设计阶段修改）
3. IF 去除首尾空白后的新昵称长度为 0，THEN THE Nickname_Change_Service SHALL 拒绝该请求、不修改该用户的 `nickname` 与 `nicknameHistory` 字段，并返回提示「昵称不能为空」的描述性错误
4. IF 去除首尾空白后的新昵称长度超过 20 个字符，THEN THE Nickname_Change_Service SHALL 拒绝该请求、不修改该用户的 `nickname` 与 `nicknameHistory` 字段，并返回描述性错误
5. THE Nickname_Change_Service SHALL 校验新昵称不包含任何控制字符（Unicode 控制字符范围，包括换行、回车、Tab 等）（假设默认值：现有系统对昵称字符集合无既有限制，本功能默认仅禁止控制字符以保护展示与存储安全，允许常规文字、数字、常见符号及 emoji；此规则为默认假设，如需更严格的字符白名单可在后续设计阶段调整）
6. IF 新昵称包含控制字符，THEN THE Nickname_Change_Service SHALL 拒绝该请求、不修改该用户的 `nickname` 与 `nicknameHistory` 字段，并返回描述性错误
7. THE Nickname_Change_Service SHALL 按以下固定顺序依次执行格式校验，并在首个未通过的校验项处立即停止后续校验：(1) 去除首尾空白后长度不为 0；(2) 长度不超过 20 个字符；(3) 不包含控制字符。THE Nickname_Change_Service SHALL 返回首个未通过校验项对应的错误；任一校验项未通过时，THE Nickname_Change_Service SHALL 不修改该用户的 `nickname` 与 `nicknameHistory` 字段（该用户记录上与本次昵称修改无关的其他字段，如访问日志时间戳，不受此约束）

### Requirement 3: 昵称唯一性校验

**User Story:** 作为系统管理员，我希望新昵称不会与其他现有用户的昵称完全相同，以避免用户之间产生混淆。

#### Acceptance Criteria

1. WHEN 用户提交昵称修改请求时，THE Nickname_Change_Service SHALL 校验去除首尾空白后的新昵称是否与除该用户本人以外的任意其他用户的当前昵称完全相同（区分大小写比较）
2. IF 新昵称与其他某个现有用户的当前昵称完全相同，THEN THE Nickname_Change_Service SHALL 立即将该请求判定为最终拒绝、不更新任何用户记录，并返回提示「该昵称已被使用」的描述性错误
3. WHEN 多个针对不同用户但目标为同一新昵称的修改请求并发提交时，THE Nickname_Change_Service SHALL 按请求到达系统的先后顺序处理，仅允许最先到达的请求成功，其余后到达的请求 SHALL 被立即判定为最终拒绝并返回「该昵称已被使用」的描述性错误，不存在任何中间或待定状态；IF 底层并发控制机制未能正确串行化并导致多个请求同时成功，THEN 多个用户的 `nickname` 字段 MAY 短暂存储相同的昵称文本，此情形不视为本需求的违反，但 Nickname_Change_Service SHALL 在下一次任一用户改名时恢复唯一性约束的正常校验
4. THE 昵称唯一性校验 SHALL 仅比较当前生效的用户昵称，不比较任何历史快照字段中保存的昵称文本

### Requirement 4: 改名频率限制

**User Story:** 作为系统管理员，我希望限制用户改名的频率，以防止短时间内多次改名造成混乱或被滥用。

#### Acceptance Criteria

1. THE Nickname_Change_Service SHALL 记录每个用户最近一次成功修改昵称的时间
2. WHEN 用户提交昵称修改请求时，THE Nickname_Change_Service SHALL 校验自该用户上一次成功修改昵称起是否已经过 Change_Cooldown_Period（24 小时）
3. IF 用户上一次成功修改昵称的时间距当前请求时间不足 24 小时，THEN THE Nickname_Change_Service SHALL 拒绝该请求，不更新任何用户记录，并返回提示「改名过于频繁，请稍后再试」的描述性错误，且错误信息 SHALL 包含用户可再次修改昵称的剩余等待时间或最早可修改时间；THE Nickname_Change_Service SHALL 拒绝所有落在冷却期内的请求，不存在允许例外通过的情形
4. IF 用户此前从未修改过昵称，THEN THE Nickname_Change_Service SHALL 不对其首次改名请求施加频率限制，且 SHALL 不向其返回冷却期相关的错误提示
5. THE 改名频率限制 SHALL 仅基于该用户自身的改名历史时间，不受其他用户改名行为影响

### Requirement 5: 昵称历史记录

**User Story:** 作为客服/管理员，我希望系统保留用户历次改名的记录，以便在需要时排查「这个人之前叫什么名字」。

#### Acceptance Criteria

1. WHEN 用户成功修改昵称时，THE Nickname_Change_Service SHALL 在该用户 `Users.nicknameHistory` 数组末尾追加一条包含改名前昵称文本与改名时间的记录
2. THE Nickname_Change_Service SHALL 将新追加的 Nickname_History 记录与 `Users.nickname` 字段的更新在同一次写操作中一并完成
3. IF 用户此前的 `Users.nicknameHistory` 字段不存在（例如从未改名过的既有用户），THEN THE Nickname_Change_Service SHALL 将该字段初始化为仅包含本次改名前昵称的数组，而不视为错误
4. THE Nickname_Change_Service SHALL 不对 `Users.nicknameHistory` 的数组长度设置上限，也不执行任何清理或截断操作

### Requirement 6: 历史记录快照字段不受影响

**User Story:** 作为系统，我需要保证用户改名不会影响任何历史记录中保存的昵称快照文本，以便历史记录忠实反映当时的状态。

#### Acceptance Criteria

1. WHEN 用户成功修改昵称时，THE Nickname_Change_Service SHALL 不修改任何 Snapshot_Field 中已保存的昵称文本，包括但不限于：`ClaimRecord.applicantNickname`、`ClaimRecord.reviewerNickname`、`DistributionRecord.distributorNickname`、`DistributionRecord.recipientDetails[].nickname`、`ContentItem.uploaderNickname`、`ContentComment.userNickname`、`TravelApplication.applicantNickname`、`TravelApplication.reviewerNickname`、`ReservationApprovalItem.reserverNickname`、`SkillClaimSummary.userNickname`、`InviteRecord.usedByNickname`、`UGRecord.leaderNickname`、`LeaderboardAnnouncementItem.recipientNickname`、`LeaderboardAnnouncementItem.distributorNickname`
2. THE Nickname_Change_Service SHALL 仅更新 `Users` 表中该用户的 `nickname` 字段（及必要的更新时间戳字段），不对任何其他数据表执行写操作
3. WHERE 用户改名前已存在的历史记录包含改名前的昵称文本，THE 系统 SHALL 在用户改名后继续按原文展示这些历史记录中的昵称文本，不进行批量回填或替换
4. THE 系统 SHALL 不提供批量回填历史记录昵称快照字段的功能

### Requirement 7: 实时展示自动生效

**User Story:** 作为用户，我希望改名后我的新昵称能立即出现在所有通过用户 ID 实时查询昵称的展示场景中，而无需额外操作。

#### Acceptance Criteria

1. WHEN 用户成功修改昵称后，THE Live_Join_Display 场景 SHALL 在下一次查询时展示该用户更新后的昵称，且不需要任何额外的数据迁移或缓存清理操作
2. THE Live_Join_Display 场景 SHALL 包括但不限于：个人资料页（profile）、活跃员工报表、内容排行榜、UGL 名单等报表（reports）、员工参与度查询系统（participation）、积分排行榜（leaderboard/ranking）
3. THE 昵称修改操作 SHALL 不需要对上述 Live_Join_Display 场景的现有查询逻辑进行任何修改

### Requirement 8: 权限与数据隔离

**User Story:** 作为系统，我需要保证昵称修改功能仅允许用户修改自己的昵称，且不影响其他系统功能的正常运行。

#### Acceptance Criteria

1. THE 昵称修改接口 SHALL 仅允许已认证用户修改其自身的昵称；IF 请求中携带指向其他用户的标识符，THEN THE Nickname_Change_Service SHALL 拒绝该请求，不更新任何用户记录，并返回描述性错误
2. IF 请求缺少有效认证或认证已过期，THEN THE Nickname_Change_Service SHALL 拒绝该请求并返回认证错误，不更新任何用户记录
3. WHERE 请求携带有效的认证凭证，THE Nickname_Change_Service SHALL 允许该请求继续处理，无论该凭证是否关联当前存在活跃会话
4. WHEN 对某用户执行昵称修改操作时，THE Nickname_Change_Service SHALL 不修改该用户的角色（roles）、积分余额（points）、密码（passwordHash）或其他账户字段
5. IF 昵称修改功能在任意操作中发生错误、异常或不可用，THEN THE 现有登录、积分商城与其他账户功能（包括登录服务自身发生故障时）SHALL 保持相互隔离，昵称修改功能的故障 SHALL 不引发这些功能出现由该故障导致的错误或服务中断

## Out of Scope（范围之外）

以下事项明确排除在本功能范围之外：

1. **历史快照字段批量回填**：不对 `ClaimRecord`、`DistributionRecord`、`ContentItem`、`ContentComment`、`TravelApplication`、`ReservationApprovalItem`、`SkillClaimSummary`、`InviteRecord`、`UGRecord`、`LeaderboardAnnouncementItem` 等表中已保存的昵称快照字段执行批量回填或替换（已决策为方案 A：保留历史原文）。
2. **证书模块（Credential）展示逻辑改动**：不改动 `credential-self-application` 与 `community-credentials` 模块中 `identityText` 等字段的生成或展示逻辑。证书代表发证当时的身份状态，不应随用户后续改名而变化。该模块 `identityText` 是否为昵称快照仍待确认，但无论确认结果如何，本次改动都不涉及该模块。
3. **JWT Token 重新签发**：不需要在改名后重新签发身份令牌。已确认 JWT payload（见 `packages/backend/src/auth/token.ts` 的 `TokenPayload`）不包含 `nickname` 字段，因此改名不影响现有 Token 的有效性。
4. **微信登录逻辑改动**：不修改微信登录流程。已确认微信登录仅在新用户创建时写入微信昵称作为初始值，不会覆盖已存在用户的昵称，因此不受本功能影响。
5. **昵称唯一性查重的具体存储/索引方案**：本文档仅声明「新昵称不能与他人当前昵称重复」这一约束，具体的查重实现方式（如新增 GSI 或其他方案）留待设计阶段确定。

