# 需求文档

## 简介

积分商城系统（Points Mall）旨在激励 UserGroupLeader、CommunityBuilder、Speaker 和志愿者（Volunteer）更积极地参与日常社区活动。用户可通过兑换码（Code）获取积分，并在商城中使用积分或专属 Code 兑换商品。系统支持 PC 端、手机端和微信小程序多端访问，提供微信扫码登录和邮箱注册登录两种方式，并配备管理端供管理员管理商品。

---

## 词汇表

- **积分商城（Points_Mall）**：本系统整体，包含用户端和管理端
- **用户（User）**：已登录系统的任意身份用户
- **UserGroupLeader**：用户组组长身份，拥有特定商品兑换权限
- **CommunityBuilder**：社区建设者身份，拥有特定商品兑换权限
- **Speaker**：演讲者身份，拥有特定商品兑换权限
- **Volunteer**：志愿者身份，拥有特定商品兑换权限
- **管理员（Admin）**：负责管理商品、Code 和用户的后台操作人员
- **积分（Points）**：用户通过兑换码获得的虚拟货币，可用于购买积分商品
- **兑换码（Code）**：由管理员生成的字符串，用于获取积分或直接兑换特殊商品
- **积分商品（Points_Product）**：可用积分购买的商品，可能有身份限制
- **Code 专属商品（Code_Product）**：只能通过特定 Code 直接兑换、不可用积分购买的商品
- **商品（Product）**：积分商品和 Code 专属商品的统称
- **兑换记录（Redemption_Record）**：用户兑换商品或 Code 的历史记录
- **积分记录（Points_Record）**：用户积分变动的历史记录
- **认证服务（Auth_Service）**：负责处理用户登录、注册和身份验证的模块
- **商品服务（Product_Service）**：负责商品信息管理和查询的模块
- **兑换服务（Redemption_Service）**：负责处理积分兑换和 Code 兑换逻辑的模块
- **积分服务（Points_Service）**：负责积分发放、扣减和查询的模块

---

## 需求

### 需求 1：用户认证

**用户故事：** 作为访客，我希望通过微信扫码或邮箱注册登录系统，以便访问积分商城的个人功能。

#### 验收标准

1. THE Auth_Service SHALL 支持微信二维码扫码登录方式
2. THE Auth_Service SHALL 支持邮箱注册和邮箱密码登录方式
3. WHEN 用户通过微信扫码完成授权，THE Auth_Service SHALL 在 5 秒内完成登录并跳转至商城首页
4. WHEN 用户提交邮箱注册表单，THE Auth_Service SHALL 向该邮箱发送验证邮件
5. WHEN 用户点击验证邮件中的链接，THE Auth_Service SHALL 激活账号并允许登录
6. IF 用户提交的邮箱已被注册，THEN THE Auth_Service SHALL 返回"邮箱已存在"的错误提示
7. IF 用户输入的密码不符合规则（少于 8 位或不包含字母和数字），THEN THE Auth_Service SHALL 返回具体的密码格式错误提示
8. IF 用户连续 5 次登录失败，THEN THE Auth_Service SHALL 锁定该账号 15 分钟并提示用户
9. WHEN 用户登录成功，THE Auth_Service SHALL 生成有效期为 7 天的访问令牌（Token）
10. WHEN 用户的访问令牌过期，THE Auth_Service SHALL 引导用户重新登录
11. WHEN 用户主动退出登录，THE Auth_Service SHALL 清除本地存储的访问令牌并跳转至登录页

---

### 需求 2：多端访问支持

**用户故事：** 作为用户，我希望在 PC 端、手机浏览器和微信小程序上均可正常使用积分商城，以便随时随地访问。

#### 验收标准

1. THE Points_Mall SHALL 提供适配 PC 端（桌面浏览器，屏幕宽度 ≥ 1024px）的响应式界面
2. THE Points_Mall SHALL 提供适配手机端（移动浏览器，屏幕宽度 < 768px）的响应式界面
3. THE Points_Mall SHALL 提供微信小程序客户端
4. WHEN 用户在微信小程序中访问，THE Points_Mall SHALL 提供与 Web 端功能一致的商品浏览、积分查询和兑换功能
5. WHILE 用户在任意端已登录，THE Points_Mall SHALL 保持同一账号的积分数据实时同步

---

### 需求 3：用户角色与身份管理

**用户故事：** 作为管理员，我希望为用户分配身份角色，以便控制不同身份用户的商品兑换权限。

#### 验收标准

1. THE Points_Mall SHALL 支持以下四种用户身份：UserGroupLeader、CommunityBuilder、Speaker、Volunteer
2. THE Admin SHALL 能够为指定用户分配一个或多个身份
3. THE Admin SHALL 能够撤销指定用户的某一身份
4. WHEN 用户身份发生变更，THE Points_Mall SHALL 立即更新该用户的商品兑换权限
5. THE User SHALL 能够在个人中心查看自己当前拥有的身份列表

---

### 需求 4：积分获取（Code 兑换积分）

**用户故事：** 作为用户，我希望通过输入兑换码来获取积分，以便在商城中购买商品。

#### 验收标准

1. WHEN 用户提交有效的积分兑换码，THE Points_Service SHALL 将该 Code 对应的积分数量添加至用户账户
2. WHEN 用户成功兑换积分码，THE Points_Service SHALL 生成一条积分增加记录，包含时间、Code 标识和积分数量
3. IF 用户提交的 Code 不存在或已失效，THEN THE Points_Service SHALL 返回"兑换码无效"的错误提示
4. IF 用户提交的 Code 已被同一用户使用过，THEN THE Points_Service SHALL 返回"兑换码已使用"的错误提示
5. IF 用户提交的 Code 已达到最大使用次数上限，THEN THE Points_Service SHALL 返回"兑换码已达使用上限"的错误提示
6. THE User SHALL 能够查看自己的积分变动历史记录，记录包含时间、来源和积分变动数量

---

### 需求 5：积分商品浏览

**用户故事：** 作为用户，我希望浏览商城中的所有商品并了解兑换条件，以便决定如何使用积分。

#### 验收标准

1. THE Product_Service SHALL 在商品列表中展示所有上架商品，包括积分商品和 Code 专属商品
2. THE Product_Service SHALL 在每个商品卡片上显示该商品可兑换的身份范围（如：UserGroupLeader、CommunityBuilder、Speaker 或所有人）
3. WHEN 用户浏览商品列表，THE Product_Service SHALL 对当前用户无权兑换的商品以灰显或锁定状态展示
4. WHEN 用户查看 Code 专属商品详情，THE Product_Service SHALL 显示该商品对应的活动信息
5. WHEN 用户查看身份限定的积分商品详情，THE Product_Service SHALL 显示该商品的限定身份说明
6. THE Product_Service SHALL 支持按商品类型（积分商品 / Code 专属商品）筛选商品列表
7. THE Product_Service SHALL 支持按用户当前身份筛选可兑换商品列表

---

### 需求 6：积分商品兑换

**用户故事：** 作为有权限的用户，我希望使用积分兑换商品，以便获得奖励。

#### 验收标准

1. WHEN 用户对有权限的积分商品发起兑换请求，THE Redemption_Service SHALL 校验用户积分余额是否充足
2. WHEN 用户积分余额充足且有兑换权限，THE Redemption_Service SHALL 扣减对应积分并生成兑换记录
3. WHEN 兑换成功，THE Points_Service SHALL 生成一条积分扣减记录，包含时间、商品名称和扣减积分数量
4. IF 用户积分余额不足，THEN THE Redemption_Service SHALL 返回"积分不足"的错误提示，不扣减积分
5. IF 用户身份不满足商品的兑换条件，THEN THE Redemption_Service SHALL 返回"无兑换权限"的错误提示
6. IF 商品库存为零，THEN THE Redemption_Service SHALL 返回"商品库存不足"的错误提示
7. THE User SHALL 能够查看自己的兑换历史记录，记录包含时间、商品名称、兑换方式和状态

---

### 需求 7：Code 专属商品兑换

**用户故事：** 作为用户，我希望通过输入特定 Code 直接兑换专属商品，以便获得活动奖励。

#### 验收标准

1. WHEN 用户提交有效的商品兑换码，THE Redemption_Service SHALL 校验该 Code 是否与目标商品绑定
2. WHEN Code 校验通过，THE Redemption_Service SHALL 完成兑换并生成兑换记录，不扣减用户积分
3. IF 用户提交的 Code 与目标商品不匹配，THEN THE Redemption_Service SHALL 返回"兑换码与商品不匹配"的错误提示
4. IF 用户尝试用积分购买 Code 专属商品，THEN THE Redemption_Service SHALL 拒绝该操作并返回"该商品仅支持 Code 兑换"的提示
5. IF 用户提交的 Code 已被使用或已失效，THEN THE Redemption_Service SHALL 返回对应的错误提示

---

### 需求 8：管理端 - 商品管理

**用户故事：** 作为管理员，我希望在管理端上架、编辑和下架商品，以便维护商城商品目录。

#### 验收标准

1. THE Admin SHALL 能够创建积分商品，设置商品名称、描述、图片、所需积分数量、库存数量和可兑换身份范围
2. THE Admin SHALL 能够创建 Code 专属商品，设置商品名称、描述、图片、关联活动信息和库存数量
3. THE Admin SHALL 能够编辑已上架商品的所有字段
4. THE Admin SHALL 能够将商品状态切换为下架，下架后该商品在用户端不可见
5. WHEN 管理员下架商品，THE Product_Service SHALL 立即在用户端隐藏该商品
6. THE Admin SHALL 能够查看每个商品的兑换次数和当前库存数量

---

### 需求 9：管理端 - Code 管理

**用户故事：** 作为管理员，我希望生成和管理兑换码，以便控制积分发放和特殊商品兑换。

#### 验收标准

1. THE Admin SHALL 能够批量生成积分兑换码，设置每个 Code 对应的积分数量和最大使用次数
2. THE Admin SHALL 能够生成商品专属兑换码，并将其与指定 Code 专属商品绑定
3. THE Admin SHALL 能够查看每个 Code 的使用状态（未使用 / 已使用 / 已达上限）
4. THE Admin SHALL 能够禁用指定 Code，禁用后该 Code 立即失效
5. WHEN 管理员禁用 Code，THE Points_Service SHALL 拒绝后续使用该 Code 的所有兑换请求

---

### 需求 10：AWS 成本优化

**用户故事：** 作为系统架构师，我希望系统优先使用低成本的 AWS 服务，以便将运营成本控制在最低水平。

#### 验收标准

1. THE Points_Mall SHALL 优先使用 AWS 免费套餐或按需付费的 Serverless 服务（如 Lambda、DynamoDB、S3、CloudFront）
2. THE Points_Mall SHALL 使用 CloudFront + S3 托管前端静态资源，避免使用常驻 EC2 实例托管前端
3. THE Points_Mall SHALL 使用 API Gateway + Lambda 处理后端 API 请求，避免使用常驻服务器
4. WHILE 系统日活跃用户数低于 1000，THE Points_Mall SHALL 保持月度 AWS 基础设施费用低于 50 美元
5. THE Points_Mall SHALL 对 DynamoDB 使用按需（On-Demand）计费模式，避免预置容量浪费
