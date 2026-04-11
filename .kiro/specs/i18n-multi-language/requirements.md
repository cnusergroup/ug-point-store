# 需求文档：多语言（i18n）支持

## 简介

为积分商城前端（Taro React，支持微信小程序 + H5）添加多语言支持，覆盖中文（zh）、英文（en）、日文（ja）、韩文（ko）四种语言。仅翻译 UI 静态文本（按钮、标签、标题、错误提示、占位符等），数据库动态内容（商品名称、描述、用户生成内容）保持原始语言不变。语言选择通过 localStorage 持久化，复用现有主题切换模式（Zustand store + localStorage）。采用自定义翻译字典方案，不引入外部 i18n 库。

## 术语表

- **Locale**：语言标识符，取值为 `zh`、`en`、`ja`、`ko` 之一
- **Translation_Dictionary**：以 Locale 为键、翻译文本为值的 JSON 对象集合
- **Translation_Module**：提供 `useTranslation` Hook 和翻译字典的前端模块，位于 `packages/frontend/src/i18n/`
- **Store**：基于 Zustand 的全局状态管理，位于 `packages/frontend/src/store/index.ts`
- **Settings_Page**：设置页面，位于 `packages/frontend/src/pages/settings/index.tsx`
- **UI_Text**：前端页面中硬编码的静态文本，包括按钮文字、标签、标题、错误提示、占位符、Toast 消息等
- **Dynamic_Content**：来自后端 API 的动态数据，如商品名称、商品描述、用户昵称、订单信息等

## 需求

### 需求 1：翻译字典模块

**用户故事：** 作为开发者，我希望有一个集中管理的翻译字典模块，以便统一维护所有 UI 文本的多语言翻译。

#### 验收标准

1. THE Translation_Module SHALL 提供四种语言（zh、en、ja、ko）的翻译字典，每种语言包含相同的键集合
2. THE Translation_Module SHALL 使用嵌套的 JSON 对象结构组织翻译文本，按页面或功能模块分组（如 `common`、`login`、`profile`、`admin` 等）
3. THE Translation_Module SHALL 将每种语言的翻译字典存放在独立文件中（如 `zh.ts`、`en.ts`、`ja.ts`、`ko.ts`）
4. WHEN 某个翻译键在当前 Locale 的字典中不存在时，THE Translation_Module SHALL 回退到中文（zh）字典中对应的值
5. THE Translation_Module SHALL 导出一个 `useTranslation` Hook，返回一个根据当前 Locale 获取翻译文本的函数 `t(key)`
6. FOR ALL 翻译字典，将字典序列化为 JSON 再反序列化后 SHALL 产生与原始字典等价的对象（往返一致性）

### 需求 2：Locale 状态管理与持久化

**用户故事：** 作为用户，我希望切换语言后刷新页面或重新打开应用时，语言设置仍然保留。

#### 验收标准

1. THE Store SHALL 包含一个 `locale` 状态字段，类型为 `Locale`，默认值为 `zh`
2. THE Store SHALL 提供一个 `setLocale(locale: Locale)` 方法用于更新当前语言
3. WHEN `setLocale` 被调用时，THE Store SHALL 将新的 Locale 值写入 localStorage（键名 `app_locale`）
4. WHEN 应用初始化时，THE Store SHALL 从 localStorage 读取已保存的 Locale 值，若存在有效值则使用该值作为初始 Locale
5. IF localStorage 中不存在有效的 Locale 值，THEN THE Store SHALL 使用 `zh` 作为默认 Locale
6. THE Store 的 Locale 管理 SHALL 复用与现有 `theme` 状态相同的模式（状态字段 + setter 方法 + localStorage 持久化）

### 需求 3：语言切换 UI

**用户故事：** 作为用户，我希望在设置页面中方便地切换界面语言。

#### 验收标准

1. THE Settings_Page SHALL 在主题切换区域下方显示一个语言切换组件
2. THE Settings_Page 的语言切换组件 SHALL 展示四个可选项：中文、English、日本語、한국어
3. WHEN 用户点击某个语言选项时，THE Settings_Page SHALL 调用 Store 的 `setLocale` 方法更新当前语言
4. THE Settings_Page SHALL 高亮显示当前选中的语言选项，视觉样式与现有主题切换组件保持一致
5. WHEN 语言切换完成后，THE Settings_Page 上的所有 UI_Text SHALL 立即更新为新选择的语言

### 需求 4：页面 UI 文本国际化

**用户故事：** 作为用户，我希望界面上的所有静态文本都能根据我选择的语言显示对应的翻译。

#### 验收标准

1. THE Translation_Module SHALL 覆盖以下页面的所有 UI_Text：登录页、注册页、忘记密码页、重置密码页、商城首页、商品详情页、兑换页、购物车页、订单确认页、订单列表页、订单详情页、个人中心页、设置页、收货地址页、积分申请页、管理后台首页、商品管理页、Code 管理页、用户管理页、订单管理页、邀请管理页、积分审批页
2. WHEN 页面渲染时，THE 页面组件 SHALL 使用 `useTranslation` Hook 获取翻译函数，并用翻译函数替换所有硬编码的中文字符串
3. THE 页面组件 SHALL 保持 Dynamic_Content（商品名称、商品描述、用户昵称、订单数据等来自 API 的内容）以原始语言显示，不进行翻译
4. THE Translation_Module SHALL 覆盖所有 `Taro.showToast`、`Taro.showModal` 中的提示文本
5. THE Translation_Module SHALL 覆盖所有表单验证错误消息（如「请输入邮箱地址」「密码需至少 8 位」等）
6. THE Translation_Module SHALL 覆盖 TabBar 组件中的标签文本

### 需求 5：翻译键完整性保障

**用户故事：** 作为开发者，我希望确保每种语言的翻译字典都包含所有必需的键，避免遗漏导致界面显示异常。

#### 验收标准

1. FOR ALL 非中文 Locale（en、ja、ko），THE Translation_Dictionary SHALL 包含与中文字典完全相同的键集合
2. WHEN 新增翻译键到中文字典时，THE Translation_Dictionary 的 TypeScript 类型定义 SHALL 在编译时报错，提示其他语言字典缺少对应的键
3. THE Translation_Module SHALL 导出一个 TypeScript 类型，定义翻译字典的完整键结构，所有语言字典 SHALL 实现该类型

### 需求 6：动态内容隔离

**用户故事：** 作为用户，我希望商品名称、描述等数据库内容始终以原始语言显示，不会因为切换语言而出现乱翻译。

#### 验收标准

1. THE 页面组件 SHALL 仅对 UI_Text 使用翻译函数，Dynamic_Content 直接渲染 API 返回的原始值
2. WHEN 渲染商品列表、商品详情、订单信息、用户信息等 API 数据时，THE 页面组件 SHALL 不对这些数据字段调用翻译函数
3. THE Translation_Dictionary SHALL 不包含任何 Dynamic_Content 的翻译条目

### 需求 7：带参数的翻译文本

**用户故事：** 作为开发者，我希望翻译文本支持动态参数插值，以便处理包含变量的 UI 文本（如「已生成 {count} 个积分码」）。

#### 验收标准

1. THE Translation_Module SHALL 支持翻译文本中的参数占位符，格式为 `{paramName}`
2. THE `useTranslation` Hook 返回的翻译函数 SHALL 接受第二个可选参数，类型为 `Record<string, string | number>`，用于替换翻译文本中的占位符
3. WHEN 翻译文本包含 `{paramName}` 占位符且调用时提供了对应参数时，THE 翻译函数 SHALL 将占位符替换为参数值
4. IF 翻译文本包含占位符但调用时未提供对应参数，THEN THE 翻译函数 SHALL 保留原始占位符文本不做替换
