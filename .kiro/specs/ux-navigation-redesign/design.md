# 设计文档 - UX 导航重构

## 概述

本设计文档描述积分商城前端导航体系的系统性重构方案。核心目标是将当前基于头部下拉菜单的深层导航模式，改造为底部 Tab Bar + 简化头部 + 重构个人中心的扁平化导航架构，同时引入骨架屏加载、下拉刷新和 SVG 图标系统提升整体用户体验。

### 关键技术约束

- **Taro 4.x H5 模式**不支持原生 `tabBar` 配置，必须使用自定义 React 组件实现底部导航
- 所有样式必须使用 `app.scss` 中定义的 CSS 变量（颜色、间距、圆角、过渡、字体）
- 状态管理使用 Zustand（`packages/frontend/src/store/index.ts`）
- 页面路由使用 Taro 的 `navigateTo` / `redirectTo` API
- H5 环境下的下拉刷新需要自定义 touch 事件实现

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Tab Bar 实现方式 | 每个 Tab 页面内渲染 `<TabBar />` 组件 | Taro H5 不支持全局 layout wrapper 包裹页面路由，每个页面是独立入口 |
| Tab 页面切换方式 | `Taro.redirectTo` | Tab 页面之间使用 redirect 而非 navigate，避免页面栈无限增长 |
| 购物车徽标数据源 | Zustand store 全局状态 | 避免每个 Tab 页面独立请求购物车数据，在 app 初始化时获取一次 |
| SVG 图标方案 | 内联 React 组件 | 支持 tree-shaking、CSS 变量颜色控制、无额外网络请求 |
| 下拉刷新实现 | 自定义 touch 事件 Hook | Taro H5 不支持原生下拉刷新，需要 `touchstart/touchmove/touchend` 实现 |
| 骨架屏动画 | 复用 `app.scss` 中已有的 `shimmer` 关键帧 | 保持动画一致性，无需新增关键帧定义 |

---

## 架构

### 组件层级结构

```
App (app.tsx)
├── TabBar 页面（4个主页面，每个内部渲染 TabBar）
│   ├── IndexPage (商城首页)
│   │   ├── SimplifiedHeader        ← 简化后的头部
│   │   ├── PullToRefresh           ← 下拉刷新容器
│   │   │   ├── ProductSkeleton     ← 骨架屏（加载态）
│   │   │   └── ProductGrid         ← 商品网格（已有）
│   │   └── TabBar                  ← 底部导航
│   │
│   ├── CartPage (购物车)
│   │   ├── CartHeader              ← 已有头部（移除返回按钮，改为标题）
│   │   ├── CartContent             ← 已有购物车内容
│   │   └── TabBar
│   │
│   ├── OrdersPage (订单列表)
│   │   ├── OrdersHeader            ← 已有头部（移除返回按钮，改为标题）
│   │   ├── OrdersContent           ← 已有订单列表
│   │   └── TabBar
│   │
│   └── ProfilePage (个人中心)
│       ├── PullToRefresh
│       │   ├── ProfileSkeleton     ← 骨架屏
│       │   ├── UserCard            ← 重构后的用户卡片
│       │   ├── QuickActionsGrid    ← 2×2 快捷操作网格
│       │   └── RecordTabs          ← 积分/兑换记录标签页（保留）
│       └── TabBar
│
├── 二级页面（无 TabBar）
│   ├── SettingsPage (新增)         ← 设置页面
│   ├── ProductDetailPage           ← 商品详情（已有）
│   ├── RedeemPage                  ← 兑换页面（已有）
│   ├── AddressPage                 ← 地址管理（已有）
│   ├── ClaimsPage                  ← 积分申请（已有）
│   └── Admin/*                     ← 管理后台（已有）
│
└── 共享组件
    ├── components/TabBar/          ← 底部导航栏
    ├── components/PullToRefresh/   ← 下拉刷新容器
    ├── components/Skeleton/        ← 骨架屏组件
    └── components/icons/           ← SVG 图标组件库
```

### 数据流：购物车徽标

```
┌─────────────┐     fetchCartCount()      ┌──────────────┐
│  App 初始化  │ ──────────────────────►  │ GET /api/cart │
└─────────────┘                           └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │ Zustand Store │
                                          │  cartCount: N │
                                          └──────┬───────┘
                                                  │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                        ┌──────────┐        ┌──────────┐        ┌──────────┐
                        │ IndexPage│        │ CartPage │        │ TabBar   │
                        │ TabBar   │        │ TabBar   │        │ (任意页) │
                        └──────────┘        └──────────┘        └──────────┘
```

购物车数量在以下时机更新：
1. App 初始化时（已认证用户）
2. 购物车页面操作后（添加/删除/修改数量）
3. 下单成功后

---

## 组件与接口

### 1. TabBar 组件

```typescript
// packages/frontend/src/components/TabBar/index.tsx

interface TabBarProps {
  /** 当前激活的 tab 路径，如 '/pages/index/index' */
  current: string;
}

// Tab 配置
interface TabConfig {
  key: string;
  label: string;
  path: string;
  icon: (props: IconProps) => JSX.Element;
  activeIcon: (props: IconProps) => JSX.Element;
  badge?: 'cart'; // 标记需要显示徽标的 tab
}

const TABS: TabConfig[] = [
  { key: 'home', label: '商城', path: '/pages/index/index', icon: HomeIcon, activeIcon: HomeActiveIcon },
  { key: 'cart', label: '购物车', path: '/pages/cart/index', icon: CartIcon, activeIcon: CartActiveIcon, badge: 'cart' },
  { key: 'orders', label: '订单', path: '/pages/orders/index', icon: OrderIcon, activeIcon: OrderActiveIcon },
  { key: 'profile', label: '我的', path: '/pages/profile/index', icon: ProfileIcon, activeIcon: ProfileActiveIcon },
];
```

**行为**：
- 点击非当前 tab 时调用 `Taro.redirectTo({ url: path })`
- 点击当前 tab 时无操作（防止重复导航）
- 购物车 tab 从 Zustand store 读取 `cartCount` 显示徽标
- 高度 56px，使用 `position: fixed; bottom: 0` 固定定位
- 底部安全区域使用 `env(safe-area-inset-bottom)` 适配

### 2. SVG 图标组件接口

```typescript
// packages/frontend/src/components/icons/types.ts

export interface IconProps {
  /** 图标尺寸，默认 24 */
  size?: number;
  /** 图标颜色，默认 currentColor */
  color?: string;
  /** 自定义 className */
  className?: string;
}
```

**图标清单**（线性描边风格，2px stroke，round linecap/linejoin）：

| 图标名 | 用途 | 替换的 Emoji |
|--------|------|-------------|
| HomeIcon / HomeActiveIcon | Tab Bar 商城 | 🏪 |
| CartIcon / CartActiveIcon | Tab Bar 购物车 | 🛒 |
| OrderIcon / OrderActiveIcon | Tab Bar 订单 | 📋 |
| ProfileIcon / ProfileActiveIcon | Tab Bar 我的 | 👤 |
| TicketIcon | 兑换积分码 | 🎟️ |
| LocationIcon | 收货地址 | 📍 |
| ClaimIcon | 积分申请 | 📝 |
| SettingsIcon | 设置 | ⚙️ |
| GiftIcon | 商品占位图 | 🎁 |
| LockIcon | 锁定商品 | 🔒 |
| PackageIcon | 空状态 | 📦 |
| RefreshIcon | 刷新/加载 | 🔄 |
| KeyIcon | 修改密码 | 🔑 |
| LogoutIcon | 退出登录 | — |
| AdminIcon | 管理后台 | ⚙️ |
| VoucherIcon | Code 兑换 | 🎫 |
| ShoppingBagIcon | 空兑换记录 | 🛍️ |
| ChevronRightIcon | 列表箭头 | → |
| ArrowLeftIcon | 返回 | ← |

### 3. PullToRefresh 组件

```typescript
// packages/frontend/src/components/PullToRefresh/index.tsx

interface PullToRefreshProps {
  /** 刷新回调，返回 Promise */
  onRefresh: () => Promise<void>;
  /** 子内容 */
  children: React.ReactNode;
}
```

**行为**：
- 监听 `touchstart` / `touchmove` / `touchend` 事件
- 仅在容器 `scrollTop === 0` 时激活下拉
- 下拉超过阈值（60px）后释放触发 `onRefresh`
- 刷新中显示旋转加载指示器（使用 SVG RefreshIcon + CSS rotate 动画）
- 刷新完成后自动收起

### 4. Skeleton 骨架屏组件

```typescript
// packages/frontend/src/components/Skeleton/index.tsx

/** 商品列表骨架屏 */
export function ProductSkeleton(): JSX.Element;

/** 个人中心骨架屏 */
export function ProfileSkeleton(): JSX.Element;
```

**行为**：
- `ProductSkeleton`：渲染 4 个商品卡片占位块（图片区 + 标题行 + 价格行），使用 2 列网格
- `ProfileSkeleton`：渲染用户卡片占位 + 2×2 快捷操作占位
- 所有占位块使用 `--bg-elevated` 背景 + `shimmer` 动画
- 数据加载完成后使用 `--transition-fast` 过渡到实际内容

### 5. SettingsPage 设置页面

```typescript
// packages/frontend/src/pages/settings/index.tsx

// 功能项列表：
// - 修改密码（点击展开内联表单或弹窗）
// - 退出登录（点击确认后执行 logout）
// - 管理后台（仅 Admin/SuperAdmin 可见，点击导航到 /pages/admin/index）
```

### 6. Zustand Store 扩展

```typescript
// 在现有 AppState 接口中新增：
interface AppState {
  // ... 现有字段 ...

  /** 购物车可用商品数量（用于 Tab Bar 徽标） */
  cartCount: number;
  /** 获取购物车数量 */
  fetchCartCount: () => Promise<void>;
  /** 更新购物车数量（本地更新，用于操作后即时反馈） */
  setCartCount: (count: number) => void;
}
```

---

## 数据模型

### 页面路由配置

Tab 页面（显示 TabBar）：

| 路径 | 页面 | Tab Key |
|------|------|---------|
| `/pages/index/index` | 商城首页 | home |
| `/pages/cart/index` | 购物车 | cart |
| `/pages/orders/index` | 订单列表 | orders |
| `/pages/profile/index` | 个人中心 | profile |

新增页面：

| 路径 | 页面 | 说明 |
|------|------|------|
| `/pages/settings/index` | 设置页面 | 从个人中心快捷操作进入，包含修改密码、退出登录、管理后台入口 |

### 文件结构（新增/修改）

```
packages/frontend/src/
├── components/                          ← 新增目录
│   ├── TabBar/
│   │   ├── index.tsx                    ← TabBar 组件
│   │   └── index.scss                   ← TabBar 样式
│   ├── PullToRefresh/
│   │   ├── index.tsx                    ← 下拉刷新组件
│   │   └── index.scss
│   ├── Skeleton/
│   │   ├── index.tsx                    ← 骨架屏组件
│   │   └── index.scss
│   └── icons/
│       ├── types.ts                     ← IconProps 接口
│       ├── HomeIcon.tsx
│       ├── CartIcon.tsx
│       ├── OrderIcon.tsx
│       ├── ProfileIcon.tsx
│       ├── TicketIcon.tsx
│       ├── LocationIcon.tsx
│       ├── ClaimIcon.tsx
│       ├── SettingsIcon.tsx
│       ├── GiftIcon.tsx
│       ├── LockIcon.tsx
│       ├── PackageIcon.tsx
│       ├── RefreshIcon.tsx
│       ├── KeyIcon.tsx
│       ├── LogoutIcon.tsx
│       ├── AdminIcon.tsx
│       ├── VoucherIcon.tsx
│       ├── ShoppingBagIcon.tsx
│       ├── ChevronRightIcon.tsx
│       ├── ArrowLeftIcon.tsx
│       └── index.ts                     ← 统一导出
├── pages/
│   ├── index/index.tsx                  ← 修改：简化头部 + 添加 TabBar + 骨架屏 + 下拉刷新
│   ├── index/index.scss                 ← 修改：简化头部样式
│   ├── cart/index.tsx                   ← 修改：移除返回按钮头部 + 添加 TabBar
│   ├── cart/index.scss                  ← 修改：调整头部样式
│   ├── orders/index.tsx                 ← 修改：移除返回按钮头部 + 添加 TabBar
│   ├── orders/index.scss                ← 修改：调整头部样式
│   ├── profile/index.tsx                ← 修改：重构为 UserCard + QuickActions + 保留 Tabs
│   ├── profile/index.scss               ← 修改：重构样式
│   └── settings/                        ← 新增
│       ├── index.tsx
│       └── index.scss
├── store/index.ts                       ← 修改：新增 cartCount / fetchCartCount / setCartCount
├── app.tsx                              ← 修改：初始化时 fetchCartCount
└── app.config.ts                        ← 修改：新增 settings 页面路由
```

### TabBar 样式规范

```scss
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-surface);
  border-top: 1px solid var(--card-border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 1000;
}

.tab-bar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
  position: relative;
}

.tab-bar__label {
  font-family: var(--font-body);
  font-size: var(--text-overline);
  color: var(--text-tertiary);

  &--active {
    color: var(--accent-primary);
  }
}

.tab-bar__badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--error);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
}
```

### 页面底部间距

所有 Tab 页面需要在内容底部添加占位间距，防止内容被 TabBar 遮挡：

```scss
// 每个 Tab 页面的根容器
padding-bottom: calc(56px + env(safe-area-inset-bottom));
```



---

## 正确性属性（Correctness Properties）

*正确性属性是指在系统所有合法执行中都应成立的特征或行为——本质上是对系统应做什么的形式化陈述。属性是人类可读规格说明与机器可验证正确性保证之间的桥梁。*

### Property 1: Tab Bar 结构完整性

*For any* Tab Bar 组件实例和任意当前路径（current），渲染结果应包含恰好 4 个 Tab 项，分别对应"商城"、"购物车"、"订单"、"我的"四个标签，且每个 Tab 项关联正确的页面路径。

**Validates: Requirements 1.1**

### Property 2: Tab 项选中状态颜色

*For any* Tab 配置项和任意当前路径（current），当 Tab 项的路径等于 current 时，其图标应使用 active 变体（accent-primary 颜色）；当路径不等于 current 时，应使用默认变体（text-tertiary 颜色）。

**Validates: Requirements 1.2, 1.3**

### Property 3: 购物车徽标显示逻辑

*For any* 非负整数 cartCount，购物车徽标的显示行为应满足：当 cartCount 为 0 时徽标隐藏；当 cartCount 大于 0 且不超过 99 时显示 cartCount 的字符串形式；当 cartCount 超过 99 时显示"99+"。

**Validates: Requirements 1.4, 1.5, 1.6**

### Property 4: 头部角色徽章截断

*For any* 用户角色数组 roles，头部组件应显示 min(roles.length, 2) 个角色徽章；当 roles.length 大于 2 时，应额外显示"+{roles.length - 2}"指示器；当 roles.length 不超过 2 时，不显示指示器。

**Validates: Requirements 2.2, 2.3**

### Property 5: 用户卡片信息渲染

*For any* 用户状态（包含 nickname 和 points），UserCard 组件应渲染 nickname 的首字符作为头像文字、完整的 nickname 文本、以及 points 数值。

**Validates: Requirements 3.1**

### Property 6: 设置页面管理后台入口可见性

*For any* 用户角色数组 roles，当 roles 包含 'Admin' 或 'SuperAdmin' 时，设置页面应显示"管理后台"入口；当 roles 不包含这两个角色时，不应显示该入口。

**Validates: Requirements 3.8**

### Property 7: 骨架屏与加载状态联动

*For any* 页面加载状态 loading（布尔值），当 loading 为 true 时应渲染骨架屏组件且不渲染实际内容；当 loading 为 false 时应渲染实际内容且不渲染骨架屏。

**Validates: Requirements 4.1, 4.2**

### Property 8: 下拉刷新状态机

*For any* PullToRefresh 组件实例，当 onRefresh 回调被触发后：在 Promise 未 resolve/reject 期间，refreshing 状态应为 true 且加载指示器可见；当 Promise resolve 或 reject 后，refreshing 状态应恢复为 false 且加载指示器隐藏。

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 9: SVG 图标属性一致性

*For any* SVG 图标组件和任意 size（正整数）及 color（字符串），渲染结果的 SVG 元素应具有 width=size、height=size（默认 24）、stroke 或 fill 为 color（默认 currentColor），且所有图标应具有 stroke-width="2"、stroke-linecap="round"、stroke-linejoin="round" 属性。

**Validates: Requirements 6.2, 6.5**

---

## 错误处理

### 网络请求失败

| 场景 | 处理方式 |
|------|----------|
| 购物车数量获取失败 | cartCount 保持为 0，Tab Bar 不显示徽标 |
| 下拉刷新请求失败 | 隐藏加载指示器，保留当前已展示的数据，不显示错误提示 |
| 页面初始加载失败 | 保留现有各页面的错误处理逻辑（显示错误文案 + 重试） |

### 边界情况

| 场景 | 处理方式 |
|------|----------|
| 用户未登录 | 保留现有重定向到登录页的逻辑，TabBar 不会渲染 |
| 用户无角色 | 头部不显示角色徽章区域 |
| 用户昵称为空 | UserCard 头像显示"?"，昵称显示"用户" |
| 购物车数量为负数（异常数据） | 视为 0，不显示徽标 |
| 下拉刷新过程中用户离开页面 | Promise 回调中检查组件是否已卸载，避免状态更新 |

---

## 测试策略

### 属性测试（Property-Based Testing）

使用 **fast-check** 库进行属性测试，每个属性测试至少运行 100 次迭代。

每个属性测试必须通过注释引用设计文档中的属性编号：
```
// Feature: ux-navigation-redesign, Property {N}: {property_text}
```

属性测试覆盖范围：

| Property | 测试内容 | 生成器 |
|----------|----------|--------|
| Property 1 | TabBar 渲染 4 个正确的 Tab 项 | 随机 current 路径 |
| Property 2 | Tab 项选中颜色逻辑 | 随机 Tab 配置 × 随机 current 路径 |
| Property 3 | 购物车徽标格式化 | 随机非负整数 (0 ~ 10000) |
| Property 4 | 角色徽章截断逻辑 | 随机长度的 UserRole 数组 |
| Property 5 | UserCard 信息渲染 | 随机 nickname + 随机 points |
| Property 6 | 管理后台入口可见性 | 随机 UserRole 数组 |
| Property 7 | 骨架屏与加载状态联动 | 随机布尔值 loading |
| Property 8 | 下拉刷新状态机 | 随机 resolve/reject Promise |
| Property 9 | SVG 图标属性一致性 | 随机 size (1~200) × 随机 color 字符串 × 所有图标组件 |

### 单元测试

单元测试聚焦于具体示例和边界情况：

- **TabBar**：验证点击 Tab 调用 `Taro.redirectTo` 且传入正确路径；验证点击当前 Tab 不触发导航
- **Header**：验证不渲染购物车图标和用户菜单（需求 2.1）；验证 0 个角色时不显示角色区域
- **ProfilePage**：验证不包含退出登录按钮和修改密码弹窗（需求 3.9）；验证 QuickActionsGrid 包含 4 个入口（需求 3.3）
- **SettingsPage**：验证包含修改密码和退出登录功能项（需求 3.7）；验证非管理员不显示管理后台入口
- **ProductSkeleton**：验证渲染至少 4 个占位块（需求 4.5）
- **PullToRefresh**：验证 scrollTop > 0 时不激活下拉；验证下拉距离不足阈值时不触发刷新

### 测试配置

- 属性测试库：`fast-check`（已在项目中使用）
- 测试框架：`vitest`（已在项目中配置）
- 每个属性测试最少 100 次迭代
- 单个属性对应单个属性测试函数（1:1 映射）
