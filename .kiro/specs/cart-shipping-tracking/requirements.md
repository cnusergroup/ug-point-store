# 需求文档 - 购物车、收货信息与物流追踪

## 简介

本功能为积分商城系统（Points Mall）新增购物车、收货信息管理和物流追踪三大模块。当前系统仅支持单件商品逐一兑换，用户无法批量选购；兑换后也无需填写收货地址，且无法查看物品的发货状态。本次需求旨在：

1. 提供购物车功能，允许用户将多件积分商品加入购物车并一次性批量兑换
2. 在下单时收集收件人姓名、手机号、收货地址等配送信息
3. 提供订单物流状态追踪，让用户了解兑换商品的发货和配送进度

本功能复用现有的认证、商品、积分等服务，新增购物车服务（Cart_Service）、收货地址服务（Address_Service）和订单服务（Order_Service）。

---

## 词汇表

- **购物车（Cart）**：用户暂存待兑换商品的临时容器，每个用户拥有一个购物车
- **购物车项（Cart_Item）**：购物车中的单条商品记录，包含商品 ID 和数量
- **购物车服务（Cart_Service）**：负责购物车的增删改查操作的后端模块
- **收货地址（Shipping_Address）**：用户保存的配送地址信息，包含收件人、手机号和详细地址
- **收货地址服务（Address_Service）**：负责收货地址的增删改查操作的后端模块
- **订单（Order）**：用户通过购物车批量兑换生成的兑换单，包含多个商品、收货信息和物流状态
- **订单服务（Order_Service）**：负责订单创建、查询和状态管理的后端模块
- **物流状态（Shipping_Status）**：订单的配送进度，包括待发货（pending）、已发货（shipped）、运输中（in_transit）、已签收（delivered）
- **物流记录（Shipping_Event）**：物流状态变更的单条时间线记录
- **积分商城（Points_Mall）**：本系统整体
- **用户（User）**：已登录系统的任意身份用户
- **管理员（Admin）**：负责管理后台操作的人员，包括更新物流状态
- **积分商品（Points_Product）**：可用积分购买的商品
- **Code 专属商品（Code_Product）**：仅通过 Code 兑换的商品，不可加入购物车
- **兑换服务（Redemption_Service）**：现有的兑换逻辑模块
- **积分服务（Points_Service）**：现有的积分管理模块

---

## 需求

### 需求 1：购物车 - 添加商品

**用户故事：** 作为用户，我希望将多件积分商品加入购物车，以便稍后一起兑换。

#### 验收标准

1. WHEN 用户对一件积分商品点击"加入购物车"，THE Cart_Service SHALL 将该商品添加至该用户的购物车，默认数量为 1
2. WHEN 用户对购物车中已存在的商品再次点击"加入购物车"，THE Cart_Service SHALL 将该商品在购物车中的数量增加 1
3. IF 用户尝试将 Code 专属商品加入购物车，THEN THE Cart_Service SHALL 拒绝该操作并返回"Code 专属商品不支持加入购物车"的提示
4. IF 用户尝试添加的商品已下架或库存为零，THEN THE Cart_Service SHALL 拒绝该操作并返回对应的错误提示
5. WHILE 用户的购物车中商品种类数达到 20 种上限，THE Cart_Service SHALL 拒绝添加新商品并返回"购物车已满"的提示


---

### 需求 2：购物车 - 查看与管理

**用户故事：** 作为用户，我希望查看和管理购物车中的商品，以便调整兑换计划。

#### 验收标准

1. THE Cart_Service SHALL 在购物车页面展示所有购物车项，每项包含商品名称、商品图片、所需积分、数量和小计积分
2. THE Cart_Service SHALL 在购物车页面底部展示所有选中商品的积分总计
3. WHEN 用户修改某购物车项的数量，THE Cart_Service SHALL 立即更新该项的小计积分和购物车总计
4. WHEN 用户将某购物车项的数量设为零或点击删除，THE Cart_Service SHALL 从购物车中移除该商品
5. IF 购物车中某商品在用户查看时已下架或库存不足，THEN THE Cart_Service SHALL 将该商品标记为"不可兑换"状态并在界面上提示用户
6. THE Cart_Service SHALL 支持用户通过勾选框选择部分商品进行兑换，未选中的商品保留在购物车中

---

### 需求 3：收货地址管理（个人中心）

**用户故事：** 作为用户，我希望在个人中心统一管理我的收货地址，以便在兑换时快速选择配送信息，不用每次都重新填写。

#### 验收标准

1. THE Points_Mall SHALL 在个人中心（Profile）页面提供"收货地址"管理入口，用户可进入地址列表页查看、添加、编辑和删除收货地址
2. THE Address_Service SHALL 允许用户添加收货地址，包含收件人姓名、手机号码和详细地址三个必填字段
3. IF 用户提交的手机号码格式不符合中国大陆手机号规则（11 位数字，以 1 开头），THEN THE Address_Service SHALL 返回"手机号格式错误"的提示
4. IF 用户提交的收件人姓名为空或超过 20 个字符，THEN THE Address_Service SHALL 返回"收件人姓名格式错误"的提示
5. IF 用户提交的详细地址为空或超过 200 个字符，THEN THE Address_Service SHALL 返回"详细地址格式错误"的提示
6. THE Address_Service SHALL 允许用户编辑已保存的收货地址
7. THE Address_Service SHALL 允许用户删除已保存的收货地址
8. THE Address_Service SHALL 允许用户设置一个默认收货地址，地址列表中默认地址以醒目标识显示
9. WHILE 用户的收货地址数量达到 10 个上限，THE Address_Service SHALL 拒绝添加新地址并返回"收货地址数量已达上限"的提示
10. WHEN 用户下单时未手动选择收货地址且存在默认地址，THE Order_Service SHALL 自动选中默认收货地址
11. WHEN 用户在下单确认页选择收货地址时，THE Order_Service SHALL 展示用户已保存的所有地址供选择，默认地址排在最前
12. THE Points_Mall SHALL 在下单确认页提供"新增地址"快捷入口，用户可在不离开下单流程的情况下添加新地址

---

### 需求 4：购物车批量兑换下单

**用户故事：** 作为用户，我希望将购物车中选中的商品一次性兑换并填写收货信息，以便高效完成兑换流程。

#### 验收标准

1. WHEN 用户在购物车中选中商品并点击"立即兑换"，THE Order_Service SHALL 展示订单确认页面，包含选中商品列表、积分总计和收货地址选择
2. WHEN 用户确认订单，THE Order_Service SHALL 校验用户积分余额是否大于或等于所有选中商品的积分总计
3. WHEN 用户确认订单，THE Order_Service SHALL 校验所有选中商品的库存是否充足
4. WHEN 用户确认订单，THE Order_Service SHALL 校验用户对所有选中商品是否具有兑换权限（身份匹配）
5. WHEN 所有校验通过，THE Order_Service SHALL 原子性地扣减用户积分、减少各商品库存、生成订单记录和积分扣减记录
6. WHEN 订单创建成功，THE Order_Service SHALL 将购物车中已兑换的商品移除
7. WHEN 订单创建成功，THE Order_Service SHALL 返回订单编号并跳转至订单详情页
8. IF 用户积分余额不足以兑换所有选中商品，THEN THE Order_Service SHALL 返回"积分不足"的错误提示，不扣减任何积分
9. IF 任一选中商品库存不足，THEN THE Order_Service SHALL 返回该商品的"库存不足"错误提示，不扣减任何积分
10. IF 用户未选择收货地址，THEN THE Order_Service SHALL 返回"请选择收货地址"的错误提示
11. IF 用户身份不满足某选中商品的兑换条件，THEN THE Order_Service SHALL 返回"无兑换权限"的错误提示并指明具体商品

---

### 需求 5：订单列表与详情查看

**用户故事：** 作为用户，我希望查看我的所有订单及每个订单的详细信息，以便了解兑换和配送情况。

#### 验收标准

1. THE Order_Service SHALL 在订单列表页展示用户的所有订单，每条包含订单编号、创建时间、商品数量、积分总计和当前物流状态
2. THE Order_Service SHALL 按创建时间倒序排列订单列表
3. THE Order_Service SHALL 支持分页加载订单列表，每页默认 10 条
4. WHEN 用户点击某订单，THE Order_Service SHALL 展示订单详情，包含商品列表（名称、图片、数量、积分）、收货信息、积分总计和物流状态时间线
5. THE Order_Service SHALL 在订单详情中展示收件人姓名、手机号（中间四位用 * 遮蔽）和收货地址

---

### 需求 6：物流状态追踪

**用户故事：** 作为用户，我希望查看兑换商品的物流状态，以便了解配送进度。

#### 验收标准

1. THE Order_Service SHALL 支持以下四种物流状态：待发货（pending）、已发货（shipped）、运输中（in_transit）、已签收（delivered）
2. WHEN 订单创建成功，THE Order_Service SHALL 将初始物流状态设为"待发货"
3. THE Order_Service SHALL 在订单详情页以时间线形式展示所有物流状态变更记录，每条记录包含状态、时间和备注
4. WHEN 物流状态发生变更，THE Order_Service SHALL 记录变更时间和操作备注
5. THE Order_Service SHALL 在订单列表中以不同颜色或图标区分各物流状态

---

### 需求 7：管理端 - 订单与物流管理

**用户故事：** 作为管理员，我希望查看所有订单并更新物流状态，以便管理商品配送流程。

#### 验收标准

1. THE Admin SHALL 能够查看所有用户的订单列表，支持按物流状态筛选
2. THE Admin SHALL 能够查看任意订单的详细信息，包含商品列表、收货信息和物流时间线
3. WHEN 管理员更新订单物流状态，THE Order_Service SHALL 记录新状态、变更时间和管理员填写的备注
4. THE Order_Service SHALL 仅允许物流状态按以下顺序流转：pending → shipped → in_transit → delivered
5. IF 管理员尝试将物流状态回退到前一状态，THEN THE Order_Service SHALL 拒绝该操作并返回"物流状态不可回退"的提示
6. WHEN 管理员将订单状态更新为"已发货"，THE Order_Service SHALL 要求管理员填写物流单号
7. THE Admin SHALL 能够查看订单统计信息，包含各物流状态的订单数量

---

### 需求 8：购物车与现有单品兑换的兼容

**用户故事：** 作为用户，我希望在使用购物车的同时仍可通过商品详情页直接兑换单件商品，以便灵活选择兑换方式。

#### 验收标准

1. THE Points_Mall SHALL 在积分商品详情页同时提供"立即兑换"和"加入购物车"两个操作按钮
2. WHEN 用户在商品详情页点击"立即兑换"，THE Order_Service SHALL 创建仅包含该单件商品的订单，流程与购物车下单一致（需选择收货地址）
3. THE Points_Mall SHALL 保留现有的 Code 专属商品兑换流程不变，Code 专属商品不经过购物车和订单流程
4. WHEN 用户通过"立即兑换"下单成功，THE Order_Service SHALL 生成与购物车下单格式一致的订单记录，支持物流追踪

---

### 需求 9：商品兑换数量选择

**用户故事：** 作为用户，我希望在商品详情页和购物车中选择兑换数量，以便一次兑换多件同一商品。

#### 验收标准

1. THE Points_Mall SHALL 在积分商品详情页提供数量选择器（+/- 按钮），默认数量为 1
2. WHEN 用户调整数量后点击"加入购物车"，THE Cart_Service SHALL 将该商品以指定数量添加到购物车
3. WHEN 用户调整数量后点击"立即兑换"，THE Order_Service SHALL 以指定数量创建订单
4. THE Points_Mall SHALL 在数量选择器旁显示所需积分小计（单价 × 数量）
5. IF 用户选择的数量超过商品当前库存，THEN THE Points_Mall SHALL 禁用增加按钮并提示"库存不足"
6. THE Cart_Service SHALL 在购物车页面支持修改每个商品的兑换数量

---

### 需求 10：商品规格/尺寸选项

**用户故事：** 作为管理员，我希望在上架商品时设置规格选项（如尺寸 S/M/L/XL），以便用户在兑换时选择合适的规格。

#### 验收标准

1. THE Admin SHALL 在创建积分商品时可选择性地添加规格选项（如尺寸：S、M、L、XL）
2. THE Admin SHALL 能够为每个规格选项设置独立的库存数量
3. WHEN 商品设置了规格选项，THE Points_Mall SHALL 在商品详情页展示规格选择器，用户必须选择一个规格后才能加入购物车或兑换
4. WHEN 用户选择规格后，THE Points_Mall SHALL 显示该规格对应的库存数量
5. THE Order_Service SHALL 在订单记录中保存用户选择的规格信息
6. THE Cart_Service SHALL 在购物车中展示每个商品选择的规格
7. IF 商品未设置规格选项，THEN THE Points_Mall SHALL 按现有流程处理，无需选择规格

---

### 需求 11：商品多图展示

**用户故事：** 作为管理员，我希望为商品上传多张展示图片，以便用户从多个角度了解商品。

#### 验收标准

1. THE Admin SHALL 在创建或编辑商品时支持上传最多 5 张展示图片
2. THE Points_Mall SHALL 在商品详情页以轮播图形式展示所有商品图片
3. THE Points_Mall SHALL 在商品列表页使用第一张图片作为封面展示
4. IF 管理员未上传任何图片，THEN THE Points_Mall SHALL 显示默认占位图（与现有行为一致）
5. THE Admin SHALL 能够调整图片的展示顺序
6. THE Admin SHALL 能够删除已上传的图片
