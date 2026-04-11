# 需求文档 - UX 导航重构

## 简介

本功能对积分商城（Points Mall）的整体用户体验和导航结构进行系统性重构。当前系统存在以下核心问题：所有导航依赖头部头像下拉菜单，用户到达核心功能需要 2-3 次点击；个人中心页面承载了 7 个快捷操作按钮、2 个标签页、退出登录和修改密码弹窗，认知负荷过重；头部区域在一行内同时展示问候语、所有角色徽章（最多 6 个）、积分余额、购物车图标和用户菜单，移动端非常拥挤；全站使用 Emoji 作为 UI 图标，跨设备渲染不一致且不够专业；所有页面使用纯文本"加载中..."而非骨架屏；商品列表和个人中心缺少下拉刷新能力。

本次重构分五个阶段实施：底部 Tab Bar 导航、头部简化、个人中心重构、骨架屏与交互改进、SVG 图标系统。

---

## 词汇表

- **积分商城（Points_Mall）**：本系统整体，基于 Taro H5 (React) 构建的前端应用
- **底部导航栏（Tab_Bar）**：固定在页面底部的导航组件，提供核心页面的一键直达入口
- **Tab 项（Tab_Item）**：底部导航栏中的单个导航入口，包含图标和文字标签
- **购物车徽标（Cart_Badge）**：显示在购物车 Tab 项图标上的数字气泡，表示购物车中可用商品数量
- **头部组件（Header）**：页面顶部的信息展示区域，包含问候语和积分余额
- **角色徽章（Role_Badge）**：显示用户身份角色的标签组件，使用全局 `.role-badge` 样式
- **用户卡片（User_Card）**：个人中心顶部的用户信息展示区域，包含头像、昵称和积分
- **快捷操作网格（Quick_Actions_Grid）**：个人中心中以 2×2 网格布局展示的常用功能入口
- **设置页面（Settings_Page）**：从个人中心进入的二级页面，包含修改密码、退出登录和管理后台入口
- **骨架屏（Skeleton_Screen）**：页面数据加载期间展示的占位动画，模拟内容布局结构
- **下拉刷新（Pull_To_Refresh）**：用户在页面顶部下拉触发数据重新加载的交互模式
- **SVG 图标组件（SVG_Icon）**：使用内联 SVG 实现的图标 React 组件，替代 Emoji 图标
- **设计系统（Design_System）**：定义在 `app.scss` 中的 CSS 变量体系，包含颜色、间距、圆角、过渡等
- **用户（User）**：已登录系统的任意身份用户
- **管理员（Admin）**：拥有 Admin 或 SuperAdmin 角色的用户

---

## 需求

### 需求 1：底部 Tab Bar 导航

**用户故事：** 作为用户，我希望通过固定在底部的导航栏一键到达商城、购物车、订单和个人中心，以便减少导航层级、提升操作效率。

#### 验收标准

1. THE Tab_Bar SHALL 固定显示在所有主页面（商城首页、购物车页、订单列表页、个人中心页）的底部，包含四个 Tab_Item：商城（/pages/index/index）、购物车（/pages/cart/index）、订单（/pages/orders/index）、我的（/pages/profile/index）
2. THE Tab_Bar SHALL 使用 SVG_Icon 作为每个 Tab_Item 的图标，未选中状态使用 `--text-tertiary` 颜色，选中状态使用 `--accent-primary` 颜色
3. WHEN 用户点击某个 Tab_Item，THE Tab_Bar SHALL 切换到对应页面，并将该 Tab_Item 高亮为选中状态
4. THE Tab_Bar SHALL 在购物车 Tab_Item 上显示 Cart_Badge，展示当前购物车中可用商品的数量
5. WHEN 购物车中可用商品数量为零，THE Tab_Bar SHALL 隐藏 Cart_Badge
6. WHEN 购物车中可用商品数量超过 99，THE Cart_Badge SHALL 显示"99+"
7. THE Tab_Bar SHALL 使用 `--bg-surface` 作为背景色，顶部使用 `--card-border` 作为分隔线
8. THE Tab_Bar SHALL 高度为 56px（含安全区域适配），为页面内容预留等高的底部间距，避免内容被遮挡
9. WHILE 用户处于非主页面（如商品详情页、地址管理页、管理后台页），THE Tab_Bar SHALL 隐藏不显示

---

### 需求 2：头部组件简化

**用户故事：** 作为用户，我希望头部区域只展示关键信息，以便在移动端获得更清爽的视觉体验。

#### 验收标准

1. THE Header SHALL 仅展示问候语（"你好，{昵称}"）和积分余额（◆ {积分数} 积分），移除购物车图标和用户头像下拉菜单
2. THE Header SHALL 在问候语右侧展示用户的角色徽章，最多显示 2 个 Role_Badge
3. WHEN 用户拥有超过 2 个角色，THE Header SHALL 在第 2 个 Role_Badge 后显示"+N"指示器，其中 N 为剩余角色数量
4. THE Header SHALL 使用 `--bg-void` 作为背景色，与页面主体形成层次区分
5. THE Header SHALL 使用 `--font-display` 字体展示积分数值，使用 `--font-body` 字体展示问候语和角色标签

---

### 需求 3：个人中心页面重构

**用户故事：** 作为用户，我希望个人中心页面结构清晰、操作简洁，以便快速找到常用功能而不被过多选项干扰。

#### 验收标准

1. THE Points_Mall SHALL 在个人中心顶部展示 User_Card，包含用户头像（首字母）、昵称和积分余额
2. THE User_Card SHALL 使用 `--bg-surface` 背景和 `--radius-lg` 圆角，积分数值使用 `--font-display` 字体
3. THE Points_Mall SHALL 在 User_Card 下方展示 Quick_Actions_Grid，以 2×2 网格布局包含四个入口：兑换积分码、收货地址、积分申请、设置
4. THE Quick_Actions_Grid SHALL 每个入口使用 SVG_Icon 和文字标签，点击后导航到对应功能页面
5. THE Points_Mall SHALL 保留个人中心的积分记录和兑换记录两个标签页，功能和交互逻辑与现有实现一致
6. WHEN 用户点击 Quick_Actions_Grid 中的"设置"入口，THE Points_Mall SHALL 导航到 Settings_Page
7. THE Settings_Page SHALL 包含以下功能项：修改密码、退出登录
8. WHEN 用户拥有 Admin 或 SuperAdmin 角色，THE Settings_Page SHALL 额外显示"管理后台"入口
9. THE Points_Mall SHALL 从个人中心主页面移除退出登录按钮和修改密码弹窗，将其迁移至 Settings_Page

---

### 需求 4：骨架屏加载

**用户故事：** 作为用户，我希望在页面数据加载时看到内容占位动画，以便感知页面结构并减少等待焦虑。

#### 验收标准

1. WHILE 商城首页商品列表数据正在加载，THE Points_Mall SHALL 展示商品卡片骨架屏，模拟商品网格的布局结构（图片区域、标题行、价格行）
2. WHILE 个人中心数据正在加载，THE Points_Mall SHALL 展示用户卡片和快捷操作区域的骨架屏
3. THE Skeleton_Screen SHALL 使用 `--bg-elevated` 作为骨架块背景色，配合 shimmer 动画（已定义在 app.scss）产生从左到右的光泽扫过效果
4. WHEN 数据加载完成，THE Skeleton_Screen SHALL 平滑过渡为实际内容，过渡时间使用 `--transition-fast`
5. THE Points_Mall SHALL 在骨架屏中展示至少 4 个商品卡片占位块，与实际商品网格布局一致

---

### 需求 5：下拉刷新

**用户故事：** 作为用户，我希望在商品列表和个人中心通过下拉手势刷新数据，以便获取最新内容。

#### 验收标准

1. WHEN 用户在商城首页顶部下拉，THE Points_Mall SHALL 触发商品列表数据重新加载
2. WHEN 用户在个人中心顶部下拉，THE Points_Mall SHALL 触发用户信息、积分记录和兑换记录数据重新加载
3. WHILE 下拉刷新正在执行，THE Points_Mall SHALL 在页面顶部展示加载指示器（旋转动画）
4. WHEN 下拉刷新完成，THE Points_Mall SHALL 隐藏加载指示器并展示更新后的数据
5. IF 下拉刷新请求失败，THEN THE Points_Mall SHALL 隐藏加载指示器并保留当前已展示的数据

---

### 需求 6：SVG 图标系统

**用户故事：** 作为用户，我希望看到风格统一、渲染一致的图标，以便获得专业且一致的视觉体验。

#### 验收标准

1. THE Points_Mall SHALL 使用内联 SVG React 组件替换所有页面中的 Emoji 图标（包括但不限于：🛒、🎟️、🏪、📍、📋、📝、🔄、🔑、🎫、🎁、🔒、📦、🛍️）
2. THE SVG_Icon SHALL 接受 `size`（默认 24px）和 `color`（默认 currentColor）属性，支持通过 CSS 变量控制颜色
3. THE SVG_Icon SHALL 在深色主题下正确显示，所有颜色通过 CSS 变量或 currentColor 继承
4. THE Points_Mall SHALL 将所有 SVG_Icon 组件集中存放在 `packages/frontend/src/components/icons/` 目录下
5. THE SVG_Icon SHALL 使用一致的视觉风格：线性描边（stroke-based）、2px 描边宽度、圆角端点（round linecap/linejoin）

