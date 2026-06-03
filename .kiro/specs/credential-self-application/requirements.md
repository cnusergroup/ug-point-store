# Requirements Document

> 需求文档：证书自助申请（Credential Self-Application）

## Introduction

本功能为 AWS User Group China 社区（awscommunity.cn）现有「社区凭证系统」（community-credentials）的扩展，新增一条**用户自助申请证书**的路径。在现有商城页面（积分广场 / 积分周边 / 差旅申请）的标签栏右侧新增一个「证书申请」标签。满足条件的用户可以在该标签下为自己参与并获得过身份积分的活动**即时生成**一张可在线验证的证书。

核心规则：

- 用户能申请证书的前提是：该用户在某个**已关联证书模版**的活动中，获得过**身份积分**（Speaker / UserGroupLeader / Volunteer，不含特殊活动积分）。
- 证书上展示的身份，由用户获得积分时所属的身份角色决定，并使用管理员在「活动-证书模版关联」中为该身份配置的证书身份文案。
- 管理员（仅 SuperAdmin）在凭证管理后台为活动设置「活动-证书模版关联」，并设定该模版允许哪些身份申请、各身份对应的证书身份文案。
- 申请时由用户自行填写姓名；同一用户在同一活动、同一身份下只能申请一次；证书一经生成不可编辑。
- 申请不消耗任何积分（积分仅作为资格判定的前提，扣分为 0）。
- 自助生成的证书复用现有凭证数据表、现有公开展示页面（`/c/{credentialId}`，含 QR 码 / OG / LinkedIn），并出现在现有凭证管理后台列表中（可搜索、可由 SuperAdmin 撤销）。
- 自助生成的证书统一使用英文（`locale = en`）渲染。
- 用户可在「我的 → 获得证书管理」区域查看自己获得的全部证书，并复制证书链接。

本功能继续复用现有积分商城技术栈（AWS Lambda + DynamoDB + API Gateway + CloudFront），并与现有 Credential Lambda 集成。

## Glossary

术语表：

- **Identity_Points（身份积分）**：用户在某场活动中以 `Speaker`、`UserGroupLeader` 或 `Volunteer` 身份获得的积分。对应积分记录 `PointsRecord` 中 `targetRole ∈ {Speaker, UserGroupLeader, Volunteer}` 且带有 `activityId` 的记录。不包含 `targetRole = SpecialActivity` 的特殊活动积分。
- **Source_Role（来源身份）**：用户获得 Identity_Points 时所属的身份角色，取值为 `Speaker`、`UserGroupLeader` 或 `Volunteer`。
- **Activity_Template_Association（活动-证书模版关联）**：管理员为某个活动配置的证书模版关联记录，存储该活动生成证书所需的全部信息（活动名称、活动日期、活动地点、签发组织、凭证 ID 前缀、允许申请的身份集合及各身份的证书身份文案等）。一个活动至多关联一个 Activity_Template_Association。
- **Allowed_Role_Config（允许身份配置）**：Activity_Template_Association 中的一项，描述一个被允许申请的 Source_Role 及其对应的 Role_Code 与 Identity_Text。
- **Role_Code（角色代码）**：用于拼装凭证 ID 的身份缩写，由 Source_Role 自动派生：`Speaker → SPK`、`Volunteer → VOL`、`UserGroupLeader → UGL`。
- **Identity_Text（证书身份文案）**：在证书公开页面上展示的身份名称文本，由管理员在 Allowed_Role_Config 中为每个 Source_Role 设定（如 `Speaker`、`Volunteer`、`User Group Leader`）。
- **Eligible_Application（可申请项）**：一个 `(用户, 活动, Source_Role)` 三元组，满足：该活动存在 Activity_Template_Association、该 Source_Role 在该关联的允许身份集合中、且用户拥有该活动该 Source_Role 的 Identity_Points、且用户尚未就该三元组申请过证书。
- **Self_Applied_Credential（自助申请证书）**：用户通过证书申请流程即时生成的 Credential 记录，标记为自助来源，并记录申请人 userId、来源活动 ID 与 Source_Role。
- **Credential（凭证）**：现有凭证记录，存储于 DynamoDB `PointsMall-Credentials` 表，详见 community-credentials 规格。
- **Credential_Page（凭证公开页面）**：现有公开展示页面，URL 为 `/c/{credentialId}`。
- **Credential_Lambda**：现有凭证服务 Lambda 函数。
- **Certificate_Application_Tab（证书申请标签）**：商城页面标签栏中新增的「证书申请」标签。
- **My_Credentials_View（获得证书管理）**：「我的」页面中新增的展示用户全部已获得证书的区域。
- **Admin_Credential_Page（凭证管理后台）**：现有管理员凭证管理页面，本功能在其中扩展「活动-证书模版关联」管理能力。
- **Issuing_Organization（签发组织）**：签发证书的社区组织名称，默认 `AWS User Group China`。

## Requirements

### Requirement 1: 活动-证书模版关联数据模型

**User Story:** 作为系统，我需要一个结构化的「活动-证书模版关联」数据模型，以便记录某活动生成证书所需的全部配置信息。

#### Acceptance Criteria

1. THE Activity_Template_Association SHALL 包含以下必填字段：`associationId`（主键）、`activityId`（关联的活动 ID）、`eventName`（活动名称，长度 1 到 200 个字符）、`eventPrefix`（凭证 ID 活动前缀，由 1 到 20 个大写字母 A–Z 与连字符 `-` 组成）、`year`（凭证 ID 年份，四位数字，取值 2000 到 2099）、`season`（凭证 ID 季节，取值 `Spring`、`Summer`、`Fall` 或 `Winter`）、`allowedRoles`（Allowed_Role_Config 列表，至少包含 1 项、至多包含 3 项）、`createdAt`（创建时间戳）、`createdBy`（创建者 userId）
2. THE Activity_Template_Association SHALL 包含以下可选字段：`eventDate`（活动日期）、`eventLocation`（活动地点，提供时长度 1 到 200 个字符）、`issuingOrganization`（签发组织，提供时长度 1 到 200 个字符）、`updatedAt`（更新时间戳）、`updatedBy`（更新者 userId）
3. WHERE `issuingOrganization` 未提供，THE Activity_Template_Association SHALL 使用默认值 `AWS User Group China`
4. THE Allowed_Role_Config SHALL 包含字段：`role`（Source_Role，取值 `Speaker`、`UserGroupLeader` 或 `Volunteer`）、`roleCode`（Role_Code，依据 `role` 取固定值：`Speaker → SPK`、`Volunteer → VOL`、`UserGroupLeader → UGL`）、`identityText`（Identity_Text，长度 1 到 100 个字符）
5. THE Activity_Template_Association 的 `locale` SHALL 固定为 `en`
6. THE 系统 SHALL 保证每个 `activityId` 至多存在一个 Activity_Template_Association
7. THE Activity_Template_Association 的 `allowedRoles` 列表中每个 Source_Role SHALL 至多出现一次

### Requirement 2: 管理员管理活动-证书模版关联

**User Story:** 作为 SuperAdmin，我希望在凭证管理后台为活动设置证书模版关联，以便指定哪些活动可以生成证书、允许哪些身份申请、以及每个身份对应的证书身份文案。

#### Acceptance Criteria

1. THE Admin_Credential_Page SHALL 提供「活动-证书模版关联」的创建、查看、编辑和删除入口
2. WHEN SuperAdmin 创建或编辑 Activity_Template_Association 时，THE Admin_Credential_Page SHALL 允许填写：关联活动、活动名称、活动日期、活动地点、签发组织、凭证 ID 前缀（`eventPrefix`、`year`、`season`）、允许申请的身份集合及每个身份的 Identity_Text
3. WHEN SuperAdmin 提交创建或编辑请求时，THE Credential_Lambda SHALL 校验以下约束：`eventPrefix` 仅由大写字母（A–Z）与连字符组成且长度为 1–20 个字符；`year` 为四位数字且取值在 2000–2100 之间；`season` 取值为 `Spring`、`Summer`、`Fall`、`Winter` 之一；活动名称长度为 1–200 个字符；每个 Identity_Text 长度为 1–100 个字符；允许申请的身份集合包含 1 至 3 个互不重复的 Source_Role
4. WHEN SuperAdmin 为某个 Source_Role 加入允许身份集合时，THE Credential_Lambda SHALL 依据 Source_Role 自动派生 Role_Code（`Speaker → SPK`、`Volunteer → VOL`、`UserGroupLeader → UGL`）
5. IF 允许身份集合中的某个 Source_Role 不属于 {`Speaker`、`Volunteer`、`UserGroupLeader`}，或集合中存在重复的 Source_Role，THEN THE Credential_Lambda SHALL 拒绝该请求、不创建或修改任何 Activity_Template_Association，并返回指明非法或重复身份的描述性错误
6. IF SuperAdmin 为一个已存在 Activity_Template_Association 的活动再次创建关联，THEN THE Credential_Lambda SHALL 拒绝该请求、保持原有关联不变，并返回错误提示「该活动已存在证书模版关联」
7. IF 创建或编辑请求缺少必填字段（关联活动、活动名称、凭证 ID 前缀的 `eventPrefix`/`year`/`season`、或至少一个允许身份），THEN THE Credential_Lambda SHALL 拒绝该请求、不创建或修改任何 Activity_Template_Association，并返回指明缺失字段的描述性错误
8. THE 创建、编辑、删除 Activity_Template_Association 操作 SHALL 仅限 SuperAdmin 角色执行
9. WHEN 非 SuperAdmin 用户尝试创建、编辑或删除 Activity_Template_Association 时，THE Credential_Lambda SHALL 返回 403 错误，且不创建、修改或删除任何 Activity_Template_Association

### Requirement 3: 证书申请资格判定

**User Story:** 作为用户，我希望系统能根据我的积分自动判定我可以申请哪些证书，以便我只看到自己有资格申请的项目。

#### Acceptance Criteria

1. WHEN 计算某用户的可申请项时，THE Credential_Lambda SHALL 仅基于该用户 `targetRole ∈ {Speaker, UserGroupLeader, Volunteer}` 且带 `activityId` 的积分记录进行判定
2. THE Credential_Lambda SHALL 在判定可申请项时排除 `targetRole = SpecialActivity` 的特殊活动积分
3. IF 用户在某活动以某 Source_Role 拥有至少一条 Identity_Points 记录（无论记录条数与积分正负）、且该活动存在 Activity_Template_Association、且该 Source_Role 在该关联的允许身份集合中、且不存在该 `(用户, 活动, Source_Role)` 三元组对应的 Self_Applied_Credential（无论其状态为 `active` 或 `revoked`），THEN THE Credential_Lambda SHALL 将该三元组判定为恰好一个 Eligible_Application
4. WHERE 用户在同一活动中以多个被允许的 Source_Role 获得过 Identity_Points，THE Credential_Lambda SHALL 为每个 Source_Role 分别生成恰好一个独立的 Eligible_Application，且同一 Source_Role 下的多条 Identity_Points 记录 SHALL 不产生重复的 Eligible_Application
5. IF 用户拥有某活动的 Identity_Points 但该活动不存在 Activity_Template_Association，THEN THE Credential_Lambda SHALL 不将其判定为 Eligible_Application
6. IF 用户拥有某活动某 Source_Role 的 Identity_Points 但该 Source_Role 不在该活动关联的允许身份集合中，THEN THE Credential_Lambda SHALL 不将该 Source_Role 判定为 Eligible_Application
7. IF Credential_Lambda 在计算可申请项过程中读取数据失败，THEN THE Credential_Lambda SHALL 返回描述性错误，而非返回空列表或部分结果

### Requirement 4: 证书申请标签展示

**User Story:** 作为用户，我希望在商城标签栏看到「证书申请」标签并查看我的可申请项，以便申请证书。

#### Acceptance Criteria

1. THE Certificate_Application_Tab SHALL 显示在商城页面标签栏中「差旅申请」标签的右侧
2. WHEN 已登录用户打开 Certificate_Application_Tab 时，THE Certificate_Application_Tab SHALL 展示该用户的全部 Eligible_Application 与已申请项
3. THE Certificate_Application_Tab SHALL 为每个可申请项与已申请项展示活动名称与证书身份（Identity_Text）
4. WHILE 某 `(用户, 活动, Source_Role)` 三元组尚未申请，THE Certificate_Application_Tab SHALL 为该项展示「申请」操作入口
5. WHILE 某 `(用户, 活动, Source_Role)` 三元组已申请，THE Certificate_Application_Tab SHALL 将该项标记为「已申请」并提供查看已生成证书公开页面的入口
6. IF Certificate_Application_Tab 在加载可申请项与已申请项时发生错误，THEN THE Certificate_Application_Tab SHALL 展示错误提示而非空状态
7. IF 用户成功加载且没有任何可申请项与已申请项，THEN THE Certificate_Application_Tab SHALL 展示空状态提示「暂无可申请的证书」

### Requirement 5: 自助申请并即时生成证书

**User Story:** 作为用户，我希望填写姓名后立即获得一张证书，以便展示我的社区贡献。

#### Acceptance Criteria

1. WHEN 用户对某个 Eligible_Application 发起申请时，THE Certificate_Application_Tab SHALL 提供一个可编辑的收件人姓名输入框，供用户填写 1 到 100 个字符（去除首尾空白后）的姓名
2. IF 收件人姓名去除首尾空白后长度为 0，THEN THE Certificate_Application_Tab SHALL 在提交前于前端阻止提交、不向服务端发起请求，并展示「姓名不能为空」的错误提示
3. WHEN 用户提交申请且收件人姓名去除首尾空白后长度为 1 到 100 个字符时，THE Credential_Lambda SHALL 即时生成一张 Self_Applied_Credential，并在 3 秒内返回包含凭证 ID 与公开页面 URL（`/c/{credentialId}`）的生成结果
4. IF 提交申请时收件人姓名去除首尾空白后长度为 0 或超过 100 个字符，THEN THE Credential_Lambda SHALL 拒绝该请求、不生成任何 Self_Applied_Credential，并返回描述性错误
5. THE Credential_Lambda SHALL 保证同一 `(用户, 活动, Source_Role)` 三元组至多生成一张 Self_Applied_Credential；WHEN 多个针对同一三元组的申请请求并发提交时，THE Credential_Lambda SHALL 仅令其中一个请求成功，并拒绝其余请求
6. IF 用户对一个已申请过的 `(用户, 活动, Source_Role)` 三元组再次提交申请，THEN THE Credential_Lambda SHALL 拒绝该请求、保持已有 Self_Applied_Credential 不变，并返回错误提示「该证书已申请」
7. IF 用户对一个不满足资格的 `(用户, 活动, Source_Role)` 三元组提交申请，THEN THE Credential_Lambda SHALL 拒绝该请求、不生成任何 Self_Applied_Credential，并返回 403 错误
8. THE Self_Applied_Credential 生成过程 SHALL 不扣减用户的任何积分
9. WHEN Self_Applied_Credential 生成成功后，THE 收件人姓名 SHALL 不可再被编辑

### Requirement 6: 身份映射与凭证 ID 生成

**User Story:** 作为系统，我需要根据用户获得积分时的身份生成证书身份与唯一凭证 ID，以便证书准确反映用户的贡献角色。

#### Acceptance Criteria

1. WHEN 生成 Self_Applied_Credential 时，THE Credential_Lambda SHALL 在关联的 `allowedRoles` 中选取 `role` 等于 Source_Role 的 Allowed_Role_Config，并将其 `identityText`（Identity_Text）持久化到该证书作为展示身份
2. WHEN 生成 Self_Applied_Credential 的凭证 ID 时，THE Credential_Lambda SHALL 使用关联的 `eventPrefix`、`year`、`season` 与 Source_Role 派生的 Role_Code，按现有凭证 ID 格式 `{EVENT_PREFIX}-{YEAR}-{SEASON}-{ROLE_CODE}-{SEQUENCE}` 生成凭证 ID，其中 SEQUENCE 为四位零填充数字、自 `0001` 起、每次递增 1
3. THE Credential_Lambda SHALL 确保同一 `eventPrefix`、`year`、`season` 与 Role_Code 下生成的序号严格单调递增（为当前最大序号加 1），且在并发申请下不产生重复或冲突的凭证 ID
4. THE Self_Applied_Credential 的 Role_Code 派生 SHALL 遵循固定规则：`Speaker → SPK`、`Volunteer → VOL`、`UserGroupLeader → UGL`
5. IF 关联中不存在 `role` 等于 Source_Role 的 Allowed_Role_Config，THEN THE Credential_Lambda SHALL 中止生成、不创建任何 Self_Applied_Credential，并返回描述性错误

### Requirement 7: 生成证书的存储与公开展示

**User Story:** 作为用户，我希望自助生成的证书拥有与官方批量签发证书一致的在线可验证公开页面，以便对外展示与验证。

#### Acceptance Criteria

1. THE Self_Applied_Credential SHALL 存储于现有 `PointsMall-Credentials` 表中
2. WHEN 用户访问某个存在的 Self_Applied_Credential 的 `/c/{credentialId}` 时，THE Credential_Page SHALL 复用现有渲染逻辑返回完整 HTML 页面，且该页面 SHALL 同时包含以下全部元素：收件人姓名、证书身份（Identity_Text）、活动名称、签发日期、凭证 ID、签发组织、含可扫描跳转至本页面完整 URL 的 QR 码的验证面板，以及 `og:title`、`og:description`、`og:url`、`og:type`、`og:image` 五个 OG meta 标签
3. THE Self_Applied_Credential 的 `locale` SHALL 固定为 `en`
4. WHILE Self_Applied_Credential 的 `locale` 为 `en`，THE Credential_Page SHALL 以英文渲染所有固定文案
5. WHEN 生成 Self_Applied_Credential 时，THE Credential_Lambda SHALL 将其 `issueDate` 设为证书生成当日日期，格式为 `YYYY-MM-DD`
6. THE Self_Applied_Credential 的初始 `status` SHALL 为 `active`
7. WHEN 用户访问 `status` 为 `revoked` 的 Self_Applied_Credential 的 `/c/{credentialId}` 时，THE Credential_Page SHALL 展示已撤销标记、隐藏验证通过状态，并隐藏「Add to LinkedIn」按钮（与现有 Credential_Page 撤销行为一致）
8. IF 用户访问的 `/c/{credentialId}` 对应的 Self_Applied_Credential 不存在，THEN THE Credential_Page SHALL 返回 404 未找到页面（与现有 Credential_Page 行为一致）

### Requirement 8: 我的—获得证书管理

**User Story:** 作为用户，我希望在「我的」页面查看自己获得的全部证书，以便集中管理与分享。

#### Acceptance Criteria

1. THE My_Credentials_View SHALL 在「我的」页面中提供一个查看自己已获得证书的入口
2. WHEN 已登录用户打开 My_Credentials_View 时，THE Credential_Lambda SHALL 在 5 秒内返回该用户名下全部 Self_Applied_Credential（含 `active` 与 `revoked` 状态），并按 `issueDate` 降序排列
3. IF Credential_Lambda 在加载用户证书时发生错误，THEN THE My_Credentials_View SHALL 展示错误提示与重试入口，而非空状态
4. THE My_Credentials_View SHALL 为每张证书展示活动名称、证书身份（Identity_Text）、凭证 ID、签发日期与当前状态（`active` / `revoked`）
5. WHEN 用户点击某张证书时，THE My_Credentials_View SHALL 打开该证书的 `/c/{credentialId}` 公开页面
6. WHEN 用户对某张证书触发「复制链接」操作时，THE My_Credentials_View SHALL 将该证书公开页面的完整 URL 复制到剪贴板，并在 3 秒内展示复制成功提示
7. IF 用户成功加载且尚未获得任何证书，THEN THE My_Credentials_View SHALL 展示空状态提示，且不展示错误提示
8. WHILE My_Credentials_View 正在加载用户证书，THE My_Credentials_View SHALL 展示加载中指示，且不展示空状态或错误状态
9. IF 「复制链接」操作失败，THEN THE My_Credentials_View SHALL 展示复制失败提示，并展示该证书公开页面的完整 URL 供手动复制

### Requirement 9: 证书申请 API 接口

**User Story:** 作为系统，我需要提供 RESTful API 接口支持证书申请相关操作。

#### Acceptance Criteria

1. THE Credential_Lambda SHALL 提供查询当前用户可申请项与已申请项的接口（需认证）
2. THE Credential_Lambda SHALL 提供提交证书申请并即时生成证书的接口（需认证）
3. THE Credential_Lambda SHALL 提供查询当前用户全部已获得证书的接口（需认证）
4. THE Credential_Lambda SHALL 提供管理员管理 Activity_Template_Association 的接口（创建、查询、编辑、删除，需认证）
5. THE 用户侧证书申请接口 SHALL 仅返回与处理请求发起者本人（由其认证身份确定的 userId）相关的数据，并 SHALL 忽略任何客户端提交的、指向其他用户的标识符
6. WHERE 请求发起者具有 SuperAdmin 角色，THE Credential_Lambda SHALL 允许其通过管理员侧接口访问全部用户的证书数据
7. THE 管理员侧 Activity_Template_Association 管理接口 SHALL 仅允许 SuperAdmin 角色访问
8. IF 非 SuperAdmin 用户访问管理员侧接口，THEN THE Credential_Lambda SHALL 返回 403 错误，且不暴露接口的存在与内部结构
9. IF 请求缺少有效认证或认证已过期，THEN THE Credential_Lambda SHALL 拒绝该请求并返回认证错误，不返回任何业务数据

### Requirement 10: 与现有凭证后台集成及数据标识

**User Story:** 作为管理员，我希望自助生成的证书与批量导入的证书一同在凭证管理后台可见、可区分、可撤销，以便统一运维。

#### Acceptance Criteria

1. THE Self_Applied_Credential SHALL 出现在 Admin_Credential_Page 的凭证列表中，可按凭证 ID、收件人姓名、活动名称进行不区分大小写的子串匹配搜索，并可按状态（`active` / `revoked`）筛选
2. THE Self_Applied_Credential SHALL 记录以下非空字段以标识其自助来源：`appliedByUserId`（申请人 userId）、`sourceActivityId`（来源活动 ID）与 `sourceRole`（Source_Role）
3. THE Admin_Credential_Page SHALL 依据 `appliedByUserId` 是否存在区分 Self_Applied_Credential 与批量导入的 Credential，并为每条记录展示来源类型标签（自助申请 / 批量导入）
4. WHEN SuperAdmin 撤销一张 `active` 状态的 Self_Applied_Credential 时，THE Credential_Lambda SHALL 复用现有撤销逻辑，将其 `status` 更新为 `revoked` 并记录 `revokedAt`、`revokedBy`、`revokeReason`
5. IF 撤销目标 Self_Applied_Credential 不存在或已处于 `revoked` 状态，THEN THE Credential_Lambda SHALL 阻止该撤销操作、保持该证书的 `status` 及其余字段不变，并返回描述性错误
6. THE Self_Applied_Credential 的撤销操作 SHALL 仅限 SuperAdmin 角色执行
7. IF 非 SuperAdmin 用户尝试撤销 Self_Applied_Credential，THEN THE Credential_Lambda SHALL 返回 403 错误，且保持该证书状态不变

### Requirement 11: 数据隔离与向后兼容

**User Story:** 作为系统，我希望证书自助申请功能不影响现有积分商城与凭证系统的正常运行。

#### Acceptance Criteria

1. THE 证书自助申请功能 SHALL 在其全部操作（资格判定、申请提交、证书生成、证书查询）执行前后保持用户的积分余额与积分记录（PointsRecord）不被创建、修改或删除
2. THE Activity_Template_Association 数据 SHALL 存储于独立于现有积分商城核心数据（商品、订单、积分记录、用户积分余额）的存储位置
3. WHEN 对 Activity_Template_Association 执行创建、编辑或删除操作时，THE Credential_Lambda SHALL 不创建、修改或删除任何现有积分商城核心数据记录（商品、订单、积分记录、用户积分余额）
4. IF 证书自助申请功能在任意操作中发生错误、异常或不可用，THEN THE 现有积分商城与差旅申请功能 SHALL 保持可用并对其请求返回正常响应，不出现由该故障引发的错误或服务中断
5. THE 证书自助申请相关的 API 路由 SHALL 使用与现有积分商城及凭证 API 路由不重复的唯一路径，且 SHALL 不覆盖、替换或拦截任何现有 API 路由的处理逻辑
6. THE 证书自助申请功能 SHALL 不改变现有批量导入证书（Credential）的存储结构、公开页面（Credential_Page）渲染逻辑与撤销行为
