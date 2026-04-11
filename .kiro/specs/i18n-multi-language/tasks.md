# 实现计划：多语言（i18n）支持

## 概述

为积分商城前端添加自定义国际化方案，支持中文、英文、日文、韩文四种语言。涉及 i18n 模块创建（类型定义、翻译字典、useTranslation Hook）、Zustand store 扩展、全部页面硬编码字符串替换、语言切换 UI 组件。

## 任务

- [x] 1. 核心 i18n 基础设施
  - [x] 1.1 创建翻译字典类型定义
    - 新建 `packages/frontend/src/i18n/types.ts`
    - 定义 `Locale` 类型：`'zh' | 'en' | 'ja' | 'ko'`
    - 定义 `TranslationDict` 接口，包含所有模块的嵌套键结构：
      - `common`：通用文本（loading、confirm、cancel、delete、edit、save、back、submit、points 等约 30 个键）
      - `tabBar`：底部导航（mall、cart、orders、profile）
      - `login`：登录页所有文本
      - `register`：注册页所有文本
      - `forgotPassword`：忘记密码页所有文本
      - `resetPassword`：重置密码页所有文本
      - `mall`：商城首页所有文本
      - `product`：商品详情页所有文本
      - `redeem`：兑换页所有文本
      - `cart`：购物车页所有文本
      - `orderConfirm`：订单确认页所有文本
      - `orders`：订单列表页所有文本
      - `orderDetail`：订单详情页所有文本
      - `profile`：个人中心页所有文本
      - `settings`：设置页所有文本
      - `address`：收货地址页所有文本
      - `claims`：积分申请页所有文本
      - `admin`：管理后台所有文本（dashboard、products、codes、users、orders、invites、claims 子模块）
    - 导出 `Locale` 和 `TranslationDict` 类型
    - _需求: 1.1, 1.2, 5.3_

  - [x] 1.2 创建 useTranslation Hook 和辅助函数
    - 新建 `packages/frontend/src/i18n/index.ts`
    - 实现 `getNestedValue(obj, path)` 函数：根据点分隔键路径从嵌套对象取值
    - 实现 `interpolate(text, params?)` 函数：替换 `{paramName}` 占位符为参数值，缺失参数时保留原始占位符
    - 实现 `useTranslation()` Hook：
      - 从 store 读取当前 `locale`
      - 返回 `{ t, locale }`，其中 `t(key, params?)` 按优先级查找：当前 locale 字典 → zh 字典 → 返回键名本身
    - 导入并注册所有语言字典（zh、en、ja、ko）到 `dictionaries` 映射
    - _需求: 1.4, 1.5, 7.1, 7.2, 7.3, 7.4_

  - [x] 1.3 扩展 Zustand Store 添加 locale 状态
    - 在 `packages/frontend/src/store/index.ts` 中：
      - 导入 `Locale` 类型
      - 在 `AppState` 接口中新增 `locale: Locale` 和 `setLocale: (locale: Locale) => void`
      - 在 `create()` 中添加 `locale` 初始化：从 `Taro.getStorageSync('app_locale')` 读取，有效值（zh/en/ja/ko）则使用，否则默认 `'zh'`
      - 添加 `setLocale` 方法：写入 `Taro.setStorageSync('app_locale', locale)` 并 `set({ locale })`
    - 模式与现有 `theme` / `setTheme` 完全一致
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.4 编写 i18n 核心属性测试
    - 新建 `packages/frontend/src/i18n/i18n.property.test.ts`
    - **Property 1: 翻译字典键集完整性**
      - 使用 fast-check 从 ['en', 'ja', 'ko'] 中随机选取 locale
      - 递归提取该 locale 字典的所有叶节点键路径
      - 验证与 zh 字典的键路径集合完全相同
      - 标签：`Feature: i18n-multi-language, Property 1: 翻译字典键集完整性`
    - **Property 4: 参数插值正确性**
      - 使用 fast-check 生成随机模板字符串（包含 `{key}` 占位符）和随机 params 对象
      - 验证 `interpolate` 函数正确替换所有匹配占位符，不改变非占位符部分
      - 标签：`Feature: i18n-multi-language, Property 4: 参数插值正确性`
    - **Property 5: 翻译字典 JSON 往返一致性**
      - 对所有 4 个字典执行 `JSON.parse(JSON.stringify(dict))`
      - 验证结果与原始字典深度相等
      - 标签：`Feature: i18n-multi-language, Property 5: 翻译字典 JSON 往返一致性`
    - 每个属性测试至少 100 次迭代
    - _验证: 需求 1.1, 1.6, 5.1, 7.1, 7.3_

- [x] 2. 翻译字典
  - [x] 2.1 创建中文翻译字典（zh.ts）
    - 新建 `packages/frontend/src/i18n/zh.ts`
    - 导出 `zh: TranslationDict` 对象
    - 遍历所有页面源码，提取所有硬编码中文字符串，按模块分组填入字典
    - 包含所有 `common`、`tabBar`、`login`、`register`、`forgotPassword`、`resetPassword`、`mall`、`product`、`redeem`、`cart`、`orderConfirm`、`orders`、`orderDetail`、`profile`、`settings`、`address`、`claims`、`admin` 模块的完整键值
    - 中文字典作为基准，所有其他语言字典必须包含相同的键集合
    - _需求: 1.1, 1.3_

  - [x] 2.2 创建英文翻译字典（en.ts）
    - 新建 `packages/frontend/src/i18n/en.ts`
    - 导出 `en: TranslationDict` 对象
    - 翻译 zh.ts 中所有键值为英文
    - TypeScript 类型检查确保键集完整
    - _需求: 1.1, 1.3, 5.1_

  - [x] 2.3 创建日文翻译字典（ja.ts）
    - 新建 `packages/frontend/src/i18n/ja.ts`
    - 导出 `ja: TranslationDict` 对象
    - 翻译 zh.ts 中所有键值为日文
    - TypeScript 类型检查确保键集完整
    - _需求: 1.1, 1.3, 5.1_

  - [x] 2.4 创建韩文翻译字典（ko.ts）
    - 新建 `packages/frontend/src/i18n/ko.ts`
    - 导出 `ko: TranslationDict` 对象
    - 翻译 zh.ts 中所有键值为韩文
    - TypeScript 类型检查确保键集完整
    - _需求: 1.1, 1.3, 5.1_

- [ ] 3. 页面字符串替换
  - [x] 3.1 认证相关页面国际化（登录、注册、忘记密码、重置密码）
    - 在 `packages/frontend/src/pages/login/index.tsx` 中：
      - 导入 `useTranslation`，在组件顶部调用 `const { t } = useTranslation()`
      - 替换所有硬编码中文：标题、标签、占位符、按钮文字、错误提示、表单验证消息
      - 包括 `Taro.showToast` / `Taro.showModal` 中的文本
    - 在 `packages/frontend/src/pages/register/index.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/forgot-password/index.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/reset-password/index.tsx` 中同样处理
    - 保持动态内容（用户昵称、角色名等）不翻译
    - _需求: 4.1, 4.2, 4.5, 6.1_

  - [x] 3.2 商城首页与商品详情页国际化
    - 在 `packages/frontend/src/pages/index/index.tsx` 中：
      - 导入 `useTranslation`，替换所有硬编码中文
      - 包括：问候语模板（使用参数插值 `{nickname}`）、筛选标签、空状态提示、商品类型标签等
      - 保持商品名称、描述、角色标签等动态内容不翻译
    - 在 `packages/frontend/src/pages/product/index.tsx` 中同样处理
    - _需求: 4.1, 4.2, 4.3, 6.1, 6.2_

  - [x] 3.3 兑换页与购物车页国际化
    - 在 `packages/frontend/src/pages/redeem/index.tsx` 中：
      - 导入 `useTranslation`，替换所有硬编码中文
      - 包括：页面标题、错误消息映射（ERROR_MESSAGES）、确认兑换区域、成功提示、积分码兑换区域
      - 使用参数插值处理动态文本（如 `{count}` 积分、商品名 `{name}`）
    - 在 `packages/frontend/src/pages/cart/index.tsx` 中同样处理
    - _需求: 4.1, 4.2, 4.4, 7.1_

  - [x] 3.4 订单相关页面国际化（订单确认、订单列表、订单详情）
    - 在 `packages/frontend/src/pages/order-confirm/index.tsx` 中：
      - 导入 `useTranslation`，替换所有硬编码中文
      - 包括：页面标题、地址区域、商品清单、积分总计、提交按钮、地址表单、Toast 消息
    - 在 `packages/frontend/src/pages/orders/index.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/order-detail/index.tsx` 中同样处理
    - 保持订单号、商品名称、地址信息等动态内容不翻译
    - _需求: 4.1, 4.2, 4.3, 4.4, 6.1, 6.2_

  - [x] 3.5 用户相关页面国际化（个人中心、设置、收货地址、积分申请）
    - 在 `packages/frontend/src/pages/profile/index.tsx` 中：
      - 导入 `useTranslation`，替换所有硬编码中文
      - 包括：快捷操作标签、主题切换标签、积分记录/兑换记录标签、空状态提示、加载更多、状态标签
      - 保持用户昵称、积分数值、记录来源等动态内容不翻译
    - 在 `packages/frontend/src/pages/settings/index.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/address/index.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/claims/index.tsx` 中同样处理
    - _需求: 4.1, 4.2, 4.4, 4.5, 6.1_

  - [x] 3.6 管理后台页面国际化
    - 在 `packages/frontend/src/pages/admin/index.tsx` 中：
      - 导入 `useTranslation`，替换 ADMIN_LINKS 中的 title、desc 等硬编码中文
      - 替换页面标题、欢迎语、导航按钮文本
    - 在 `packages/frontend/src/pages/admin/products.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/admin/codes.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/admin/users.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/admin/orders.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/admin/invites.tsx` 中同样处理
    - 在 `packages/frontend/src/pages/admin/claims.tsx` 中同样处理
    - _需求: 4.1, 4.2, 4.4_

  - [x] 3.7 TabBar 组件国际化
    - 在 `packages/frontend/src/components/TabBar/index.tsx` 中：
      - 导入 `useTranslation`
      - 将 `TABS` 数组中的 `label` 从硬编码中文改为翻译键引用
      - 在渲染时通过 `t()` 获取当前语言的标签文本
    - _需求: 4.6_

- [x] 4. 语言切换 UI
  - [x] 4.1 在设置页面添加语言切换组件
    - 在 `packages/frontend/src/pages/settings/index.tsx` 中：
      - 从 store 读取 `locale` 和 `setLocale`
      - 在主题切换区域（如果存在）或修改密码区域下方添加语言切换区域
      - 定义 `LOCALE_OPTIONS` 数组：`[{ key: 'zh', label: '中文' }, { key: 'en', label: 'English' }, { key: 'ja', label: '日本語' }, { key: 'ko', label: '한국어' }]`
      - 渲染 4 个可选项，点击调用 `setLocale(key)`
      - 当前选中项添加激活样式（复用主题切换的 `--active` 类名模式）
    - 在 `packages/frontend/src/pages/settings/index.scss` 中添加语言切换样式（如需要）
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.2 在个人中心页面添加语言切换（可选）
    - 如果设计决定在个人中心页面也展示语言切换（与主题切换并列），在 `packages/frontend/src/pages/profile/index.tsx` 中添加
    - 样式与主题切换一致
    - _需求: 3.1_

- [x] 5. 验证检查点
  - [x] 5.1 运行属性测试验证正确性
    - 运行 `packages/frontend/src/i18n/i18n.property.test.ts` 中的所有属性测试
    - 确认 Property 1（键集完整性）、Property 4（参数插值）、Property 5（JSON 往返）全部通过
    - _验证: 需求 1.1, 1.6, 5.1, 7.1, 7.3_

  - [x] 5.2 TypeScript 编译检查
    - 运行 TypeScript 编译确认无类型错误
    - 确认所有翻译字典文件满足 `TranslationDict` 类型约束
    - 确认所有页面组件中 `useTranslation` 调用无类型错误
    - _验证: 需求 5.1, 5.2, 5.3_

  - [x] 5.3 手动验证语言切换功能
    - 在设置页面切换到每种语言，确认：
      - 所有 UI 文本正确更新
      - 动态内容（商品名称、用户昵称等）保持原始语言
      - 刷新页面后语言设置保留
      - TabBar 标签文本正确切换
    - _验证: 需求 2.3, 2.4, 3.5, 4.1, 4.3, 4.6, 6.1_
