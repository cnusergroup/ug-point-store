# Implementation Plan: UX 导航重构

## Overview

将积分商城从头部下拉菜单导航改造为底部 Tab Bar + 简化头部 + 重构个人中心的扁平化导航架构，同时引入 SVG 图标系统、骨架屏、下拉刷新等体验改进。所有实现基于 Taro 4.x (React) H5 模式，使用 TypeScript + SCSS + Zustand。

## Tasks

- [x] 1. SVG 图标系统
  - [x] 1.1 Create icon types and base infrastructure
    - Create `packages/frontend/src/components/icons/types.ts` with `IconProps` interface (size, color, className)
    - Create `packages/frontend/src/components/icons/index.ts` barrel export file
    - _Requirements: 6.2, 6.4, 6.5_

  - [x] 1.2 Create Tab Bar icon components
    - Create `HomeIcon` / `HomeActiveIcon` (商城 tab)
    - Create `CartIcon` / `CartActiveIcon` (购物车 tab)
    - Create `OrderIcon` / `OrderActiveIcon` (订单 tab)
    - Create `ProfileIcon` / `ProfileActiveIcon` (我的 tab)
    - All icons: stroke-based, 2px stroke-width, round linecap/linejoin, default size 24, default color currentColor
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 1.3 Create utility and page icon components
    - Create `TicketIcon` (兑换积分码), `LocationIcon` (收货地址), `ClaimIcon` (积分申请), `SettingsIcon` (设置)
    - Create `GiftIcon` (商品占位), `LockIcon` (锁定商品), `PackageIcon` (空状态), `RefreshIcon` (刷新)
    - Create `KeyIcon` (修改密码), `LogoutIcon` (退出登录), `AdminIcon` (管理后台), `VoucherIcon` (Code 兑换)
    - Create `ShoppingBagIcon` (空兑换记录), `ChevronRightIcon` (列表箭头), `ArrowLeftIcon` (返回)
    - Update `index.ts` barrel export with all icons
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 1.4 Write property test for SVG icon attribute consistency
    - **Property 9: SVG 图标属性一致性**
    - Test that for any icon component, random size (1~200) and random color string, the rendered SVG has width=size, height=size (default 24), stroke or fill = color (default currentColor), stroke-width="2", stroke-linecap="round", stroke-linejoin="round"
    - **Validates: Requirements 6.2, 6.5**

- [x] 2. Zustand store extension (cartCount)
  - [x] 2.1 Add cartCount state and actions to store
    - Add `cartCount: number` field (default 0) to `AppState` interface and initial state
    - Add `fetchCartCount` action: GET `/api/cart`, count available items, set cartCount (on error keep 0)
    - Add `setCartCount` action for local updates after cart operations
    - _Requirements: 1.4, 1.5_

- [x] 3. TabBar component
  - [x] 3.1 Create TabBar component and styles
    - Create `packages/frontend/src/components/TabBar/index.tsx` with `TabBarProps` ({ current: string })
    - Define TABS config array with 4 tabs: 商城, 购物车, 订单, 我的 (paths, icons, activeIcons, badge key)
    - Render 4 tab items; active tab uses `--accent-primary` color + active icon variant; inactive uses `--text-tertiary` + default icon
    - Cart tab reads `cartCount` from Zustand store; show badge when > 0; display "99+" when > 99; hide when 0 or negative
    - Click non-current tab → `Taro.redirectTo({ url: path })`; click current tab → no-op
    - Create `packages/frontend/src/components/TabBar/index.scss` with fixed bottom positioning (56px height), safe-area padding, `--bg-surface` background, `--card-border` top border, z-index 1000
    - Badge styling: absolute positioned, `--error` background, `--radius-full`, white text
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 3.2 Write property test for Tab Bar structural integrity
    - **Property 1: Tab Bar 结构完整性**
    - Test that for any random current path, TabBar renders exactly 4 tab items with correct labels (商城, 购物车, 订单, 我的) and correct paths
    - **Validates: Requirements 1.1**

  - [x] 3.3 Write property test for tab item selected state color
    - **Property 2: Tab 项选中状态颜色**
    - Test that for any tab config and random current path, when tab path equals current → active icon variant used; when not equal → default icon variant used
    - **Validates: Requirements 1.2, 1.3**

  - [x] 3.4 Write property test for cart badge display logic
    - **Property 3: 购物车徽标显示逻辑**
    - Test that for any non-negative integer cartCount: 0 → badge hidden; 1-99 → show cartCount string; >99 → show "99+"
    - **Validates: Requirements 1.4, 1.5, 1.6**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Header simplification and index page integration
  - [x] 5.1 Simplify the header in index page
    - Remove cart icon button (`mall-header__cart-btn`) and cart badge from header
    - Remove user avatar button (`mall-header__user-btn`) and dropdown menu (`mall-header__user-menu`)
    - Keep greeting ("你好，{昵称}") and points display (◆ {积分} 积分)
    - Limit role badges to max 2; show "+N" indicator when roles.length > 2
    - Use `--bg-void` background for header, `--font-display` for points, `--font-body` for greeting
    - Remove local `cartCount` state and cart fetch logic (now in Zustand store)
    - Remove `showUserMenu` state and related refs/effects
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Add TabBar to index page
    - Import and render `<TabBar current="/pages/index/index" />` at bottom of mall-page
    - Add `padding-bottom: calc(56px + env(safe-area-inset-bottom))` to `.mall-page`
    - _Requirements: 1.1, 1.8_

  - [x] 5.3 Call fetchCartCount on app initialization
    - In `app.tsx`, import `useAppStore` and call `fetchCartCount()` on mount when user is authenticated
    - _Requirements: 1.4_

  - [x] 5.4 Update index page SCSS for simplified header
    - Remove styles for `__cart-btn`, `__cart-badge`, `__user-wrap`, `__user-btn`, `__user-menu`, `__menu-item`, `__menu-divider`
    - Update `mall-header` background to `var(--bg-void)`
    - Add styles for role badge truncation (max 2 + "+N" indicator)
    - _Requirements: 2.1, 2.4_

  - [x] 5.5 Write property test for header role badge truncation
    - **Property 4: 头部角色徽章截断**
    - Test that for any roles array: display min(roles.length, 2) badges; show "+{roles.length - 2}" when > 2; no indicator when ≤ 2
    - **Validates: Requirements 2.2, 2.3**

- [x] 6. Profile page restructure
  - [x] 6.1 Restructure profile page layout
    - Refactor `UserCard` section: avatar (first char), nickname, points display with `--bg-surface` background and `--radius-lg` corners
    - Replace current 7-button quick actions with 2×2 `QuickActionsGrid`: 兑换积分码 (TicketIcon), 收货地址 (LocationIcon), 积分申请 (ClaimIcon), 设置 (SettingsIcon)
    - Remove logout button and change-password modal from profile page
    - Remove "商品列表" and "我的订单" quick action buttons (now accessible via TabBar)
    - Remove "刷新" button (replaced by pull-to-refresh)
    - Keep existing points/redemption record tabs and all their logic intact
    - Replace all Emoji icons with SVG icon components
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9_

  - [x] 6.2 Add TabBar to profile page
    - Import and render `<TabBar current="/pages/profile/index" />` at bottom
    - Add bottom padding for TabBar clearance
    - _Requirements: 1.1, 1.8_

  - [x] 6.3 Update profile page SCSS
    - Style UserCard with `--bg-surface`, `--radius-lg`, `--font-display` for points
    - Style QuickActionsGrid as 2×2 grid with SVG icons
    - Remove styles for logout button and password modal
    - _Requirements: 3.2_

  - [x] 6.4 Write property test for UserCard info rendering
    - **Property 5: 用户卡片信息渲染**
    - Test that for any user state (nickname, points), UserCard renders nickname first char as avatar text, full nickname, and points value
    - **Validates: Requirements 3.1**

- [x] 7. Settings page (new)
  - [x] 7.1 Create settings page
    - Create `packages/frontend/src/pages/settings/index.tsx`
    - Include "修改密码" item (KeyIcon) — click expands inline form or navigates to password change flow
    - Include "退出登录" item (LogoutIcon) — click shows confirmation then calls `logout()`
    - Conditionally show "管理后台" item (AdminIcon) only when user has Admin or SuperAdmin role
    - Use SVG icons and ChevronRightIcon for list arrows
    - _Requirements: 3.6, 3.7, 3.8, 3.9_

  - [x] 7.2 Create settings page SCSS
    - Style settings list items with `--bg-surface` background, `--card-border` dividers
    - Use CSS variables for all colors, spacing, and transitions
    - _Requirements: 3.7_

  - [x] 7.3 Register settings page route
    - Add `'pages/settings/index'` to `pages` array in `packages/frontend/src/app.config.ts`
    - _Requirements: 3.6_

  - [x] 7.4 Write property test for settings admin entry visibility
    - **Property 6: 设置页面管理后台入口可见性**
    - Test that for any roles array: when includes 'Admin' or 'SuperAdmin' → show admin entry; otherwise → hide
    - **Validates: Requirements 3.8**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Cart page and Orders page TabBar integration
  - [x] 9.1 Update cart page with TabBar
    - Remove back button from cart header, change to centered title "购物车"
    - Import and render `<TabBar current="/pages/cart/index" />` at bottom
    - Add bottom padding for TabBar clearance
    - After cart operations (add/delete/quantity change), call `setCartCount` to update Zustand store
    - Replace Emoji icons (🎁, 🛒) with SVG icon components (GiftIcon, CartIcon)
    - _Requirements: 1.1, 1.8, 1.9_

  - [x] 9.2 Update orders page with TabBar
    - Remove back button from orders header, change to centered title "我的订单"
    - Import and render `<TabBar current="/pages/orders/index" />` at bottom
    - Add bottom padding for TabBar clearance
    - Replace Emoji icons (⏳, 📦, 🚚, ✅, 📋) with SVG icon components
    - _Requirements: 1.1, 1.8, 1.9_

- [x] 10. Skeleton screens
  - [x] 10.1 Create skeleton components
    - Create `packages/frontend/src/components/Skeleton/index.tsx` with `ProductSkeleton` and `ProfileSkeleton` exports
    - `ProductSkeleton`: render 4 product card placeholders in 2-column grid (image area + title line + price line)
    - `ProfileSkeleton`: render user card placeholder + 2×2 quick actions placeholder
    - Create `packages/frontend/src/components/Skeleton/index.scss` using `--bg-elevated` background + `shimmer` animation
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 10.2 Integrate skeleton into index page
    - Replace "加载中..." text with `<ProductSkeleton />` when loading is true
    - Use `--transition-fast` for fade transition from skeleton to content
    - _Requirements: 4.1, 4.4_

  - [x] 10.3 Integrate skeleton into profile page
    - Show `<ProfileSkeleton />` while user data and records are loading
    - Use `--transition-fast` for fade transition
    - _Requirements: 4.2, 4.4_

  - [x] 10.4 Write property test for skeleton and loading state linkage
    - **Property 7: 骨架屏与加载状态联动**
    - Test that for any boolean loading: true → skeleton rendered, content hidden; false → content rendered, skeleton hidden
    - **Validates: Requirements 4.1, 4.2**

- [x] 11. Pull-to-refresh
  - [x] 11.1 Create PullToRefresh component
    - Create `packages/frontend/src/components/PullToRefresh/index.tsx` with `PullToRefreshProps` ({ onRefresh, children })
    - Implement touch event handling (touchstart/touchmove/touchend)
    - Only activate when container scrollTop === 0
    - Pull threshold: 60px; show rotating RefreshIcon as loading indicator
    - After onRefresh Promise resolves/rejects, hide indicator and reset state
    - Check component mounted state to avoid state updates after unmount
    - Create `packages/frontend/src/components/PullToRefresh/index.scss`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 11.2 Integrate PullToRefresh into index page
    - Wrap product grid area with `<PullToRefresh onRefresh={fetchProducts} />`
    - _Requirements: 5.1_

  - [x] 11.3 Integrate PullToRefresh into profile page
    - Wrap profile content with `<PullToRefresh>`, onRefresh reloads user info + points records + redemption records
    - _Requirements: 5.2_

  - [x] 11.4 Write property test for pull-to-refresh state machine
    - **Property 8: 下拉刷新状态机**
    - Test that after onRefresh triggered: while Promise pending → refreshing=true, indicator visible; after resolve/reject → refreshing=false, indicator hidden
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 9 correctness properties from the design document
- All styling must use CSS variables from the design system (`app.scss`)
- The `app.config.ts` must be updated to register the new settings page route (task 7.3)
- Tab pages use `Taro.redirectTo` for navigation to avoid page stack growth
