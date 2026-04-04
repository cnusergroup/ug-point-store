# 需求文档 - 商品管理增强（多图上传、尺码管理、限购设置）

## 简介

本功能为积分商城系统（Points Mall）的管理端商品管理模块新增三项增强能力：

1. **多图上传**：管理员可为商品上传多张展示图片（最多 5 张），图片存储至 S3，支持删除已上传图片。第一张图片作为封面，商品详情页以轮播图形式展示。
2. **尺码/规格管理**：管理员可为商品启用尺码选项（如 S、M、L、XL），每个尺码设置独立库存。用户下单时必须选择尺码。未启用尺码的商品保持现有行为不变。
3. **限购设置**：管理员可设置商品是否限制每人购买数量。启用后可设定每人最多购买件数，系统在下单时强制校验。

现有系统已具备 S3 图片存储桶（FrontendStack 中的 ImagesBucket）、管理端商品 CRUD（`packages/backend/src/admin/products.ts`）、商品详情页（`pages/product/index.tsx`）和管理端商品页面（`pages/admin/products.tsx`）。本次需求在此基础上扩展。

---

## 词汇表

- **管理端（Admin）**：拥有 Admin 或 SuperAdmin 角色的用户使用的后台管理界面
- **商品管理服务（Product_Admin_Service）**：负责商品创建、编辑、上下架等管理操作的后端模块（`packages/backend/src/admin/products.ts`）
- **图片上传服务（Image_Upload_Service）**：负责生成 S3 预签名 URL、管理图片元数据的后端模块
- **商品详情页（Product_Detail_Page）**：用户查看商品信息的前端页面（`pages/product/index.tsx`）
- **管理端商品页面（Admin_Products_Page）**：管理员管理商品的前端页面（`pages/admin/products.tsx`）
- **图片桶（Images_Bucket）**：存储商品图片的 S3 存储桶，已在 CDK FrontendStack 中定义
- **预签名 URL（Presigned_URL）**：由后端生成的带有临时授权的 S3 上传/访问链接
- **尺码选项（Size_Option）**：商品的规格/尺码配置项，包含尺码名称和对应库存
- **限购数量（Purchase_Limit）**：每个用户对某商品的最大可购买数量
- **订单服务（Order_Service）**：负责订单创建和校验的后端模块
- **购物车服务（Cart_Service）**：负责购物车操作的后端模块
- **积分商城（Points_Mall）**：本系统整体

---

## 需求

### 需求 1：商品多图上传

**用户故事：** 作为管理员，我希望为商品上传多张展示图片并存储到 S3，以便用户从多个角度了解商品。

#### 验收标准

1. WHEN 管理员在创建或编辑商品时请求上传图片，THE Image_Upload_Service SHALL 生成一个指向 Images_Bucket 的 S3 预签名上传 URL，有效期为 5 分钟
2. THE Image_Upload_Service SHALL 将图片存储路径格式设为 `products/{productId}/{ulid}.{ext}`，其中 ext 为原始文件扩展名
3. THE Product_Admin_Service SHALL 允许每件商品最多关联 5 张图片，图片信息以有序数组形式存储在商品记录中
4. IF 管理员尝试为已有 5 张图片的商品上传新图片，THEN THE Image_Upload_Service SHALL 拒绝该操作并返回"图片数量已达上限（最多 5 张）"的提示
5. THE Admin_Products_Page SHALL 在商品表单中展示已上传图片的缩略图列表，支持拖拽或点击调整图片顺序
6. WHEN 管理员点击某张已上传图片的删除按钮，THE Image_Upload_Service SHALL 从 S3 删除该图片文件，并从商品记录中移除该图片信息
7. THE Product_Admin_Service SHALL 将图片数组中的第一张图片 URL 同步写入商品的 imageUrl 字段，以保持与现有列表页的兼容
8. IF 管理员删除所有图片，THEN THE Product_Admin_Service SHALL 将商品的 imageUrl 字段设为空字符串

### 需求 2：商品图片前端展示

**用户故事：** 作为用户，我希望在商品详情页看到商品的多张图片，以便全面了解商品外观。

#### 验收标准

1. WHEN 商品拥有多张图片，THE Product_Detail_Page SHALL 以轮播图（Swiper）形式展示所有图片，支持左右滑动切换
2. THE Product_Detail_Page SHALL 在轮播图下方显示当前图片的序号指示器（如 "2/5"）
3. THE Points_Mall SHALL 在商品列表页使用图片数组中的第一张图片作为封面展示
4. IF 商品未上传任何图片，THEN THE Product_Detail_Page SHALL 显示默认占位图（与现有行为一致）

### 需求 3：尺码/规格管理

**用户故事：** 作为管理员，我希望为商品设置尺码选项和各尺码的独立库存，以便管理不同规格的商品。

#### 验收标准

1. THE Admin_Products_Page SHALL 在商品表单中提供"启用尺码选项"开关
2. WHEN 管理员启用尺码选项，THE Admin_Products_Page SHALL 展示尺码配置区域，管理员可添加尺码名称（如 S、M、L、XL）并为每个尺码设置库存数量
3. THE Product_Admin_Service SHALL 将尺码信息以数组形式存储在商品记录中，每个元素包含尺码名称（name）和库存数量（stock）
4. WHEN 商品启用尺码选项，THE Product_Admin_Service SHALL 将商品的 stock 字段设为所有尺码库存之和
5. IF 管理员启用尺码选项但未添加任何尺码，THEN THE Product_Admin_Service SHALL 拒绝保存并返回"请至少添加一个尺码"的提示
6. IF 管理员为同一商品添加重复的尺码名称，THEN THE Product_Admin_Service SHALL 拒绝保存并返回"尺码名称不能重复"的提示
7. THE Product_Admin_Service SHALL 允许管理员在编辑商品时增加、修改或删除尺码选项

### 需求 4：尺码选择前端交互

**用户故事：** 作为用户，我希望在兑换有尺码选项的商品时选择合适的尺码，以便获得正确规格的商品。

#### 验收标准

1. WHEN 商品设置了尺码选项，THE Product_Detail_Page SHALL 在兑换按钮上方展示尺码选择器，以标签按钮形式展示所有可选尺码
2. WHEN 用户选择某个尺码，THE Product_Detail_Page SHALL 显示该尺码对应的库存数量
3. IF 某尺码库存为零，THEN THE Product_Detail_Page SHALL 将该尺码标签显示为不可选状态并标注"已售罄"
4. IF 商品设置了尺码选项且用户未选择尺码，THEN THE Points_Mall SHALL 禁用"立即兑换"和"加入购物车"按钮并提示"请选择尺码"
5. THE Order_Service SHALL 在订单记录中保存用户选择的尺码信息
6. THE Cart_Service SHALL 在购物车项中保存用户选择的尺码信息，购物车页面展示所选尺码
7. WHEN 用户下单包含尺码商品时，THE Order_Service SHALL 扣减对应尺码的库存而非商品总库存
8. IF 商品未设置尺码选项，THEN THE Product_Detail_Page SHALL 按现有流程处理，不展示尺码选择器

### 需求 5：限购数量设置

**用户故事：** 作为管理员，我希望为商品设置每人限购数量，以便防止单个用户大量囤积热门商品。

#### 验收标准

1. THE Admin_Products_Page SHALL 在商品表单中提供"启用限购"开关
2. WHEN 管理员启用限购，THE Admin_Products_Page SHALL 展示限购数量输入框，管理员可设置每人最多购买件数
3. THE Product_Admin_Service SHALL 将限购信息存储在商品记录中，包含是否启用限购（purchaseLimitEnabled）和限购数量（purchaseLimitCount）
4. IF 管理员启用限购但未设置限购数量或设置为零，THEN THE Product_Admin_Service SHALL 拒绝保存并返回"请设置有效的限购数量（至少为 1）"的提示
5. IF 管理员设置的限购数量不是正整数，THEN THE Product_Admin_Service SHALL 拒绝保存并返回"限购数量必须为正整数"的提示

### 需求 6：限购校验与前端提示

**用户故事：** 作为用户，我希望在兑换限购商品时得到清晰的限购提示，以便了解购买限制。

#### 验收标准

1. WHEN 商品启用限购，THE Product_Detail_Page SHALL 在商品信息区域显示"每人限购 N 件"的提示
2. WHEN 用户对启用限购的商品下单，THE Order_Service SHALL 查询该用户对该商品的历史购买总数量（包含所有已完成订单中的该商品数量）
3. IF 用户本次购买数量加上历史购买数量超过限购数量，THEN THE Order_Service SHALL 拒绝下单并返回"超出限购数量，您已购买 X 件，最多还可购买 Y 件"的提示
4. IF 商品未启用限购，THEN THE Order_Service SHALL 按现有流程处理，不进行限购校验
5. WHEN 用户将限购商品加入购物车，THE Cart_Service SHALL 校验购物车中该商品数量加上历史购买数量是否超过限购数量
6. IF 购物车中该商品数量加上历史购买数量将超过限购数量，THEN THE Cart_Service SHALL 拒绝添加并返回"超出限购数量"的提示
7. THE Product_Detail_Page SHALL 在数量选择器中将最大可选数量限制为限购剩余可购买数量
