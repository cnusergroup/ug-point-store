# 积分商城前端设计规范（Points Mall Frontend Design System）

## 设计理念

### 美学方向：「数字勋章」（Digital Badge Aesthetic）

灵感来源于实体勋章、徽章收藏和成就系统。整体风格融合了：
- 深色基底 + 金属质感高光（传达"奖励"和"荣誉"感）
- 几何切割卡片（像勋章的棱角分明）
- 微妙的光泽渐变（暗示珍贵感）
- 社区温度的暖色点缀

这不是一个普通的电商页面，而是一个「成就展示厅」——每个商品都像一枚待解锁的勋章。

### 核心设计原则

1. **奖励感（Rewarding）**：每次兑换都应该有仪式感
2. **身份感（Identity）**：不同角色有独特的视觉标识
3. **清晰度（Clarity）**：权限状态一目了然，不让用户困惑
4. **响应式（Responsive）**：PC → 手机 → 小程序无缝适配

---

## 色彩系统（Color System）

### CSS 变量定义

```css
:root {
  /* === 基础色板 === */
  /* 深色背景层级（从深到浅） */
  --bg-void: #0a0b0f;          /* 最深层背景 */
  --bg-base: #12131a;          /* 主背景 */
  --bg-surface: #1a1b25;       /* 卡片/面板背景 */
  --bg-elevated: #222333;      /* 悬浮/弹窗背景 */
  --bg-hover: #2a2b3d;         /* 悬停状态 */

  /* 文字色阶 */
  --text-primary: #f0f0f5;     /* 主文字 */
  --text-secondary: #9a9bb0;   /* 次要文字 */
  --text-tertiary: #5d5e72;    /* 辅助/禁用文字 */
  --text-inverse: #0a0b0f;     /* 反色文字（用于亮色按钮上） */

  /* === 角色专属色 === */
  /* UserGroupLeader - 琥珀金（领导力、权威） */
  --role-leader: #f5a623;
  --role-leader-glow: rgba(245, 166, 35, 0.25);
  --role-leader-gradient: linear-gradient(135deg, #f5a623 0%, #e8891c 100%);

  /* CommunityBuilder - 翡翠绿（建设、成长） */
  --role-builder: #2dd4a8;
  --role-builder-glow: rgba(45, 212, 168, 0.25);
  --role-builder-gradient: linear-gradient(135deg, #2dd4a8 0%, #1fb88e 100%);

  /* Speaker - 宝石蓝（表达、智慧） */
  --role-speaker: #5b8def;
  --role-speaker-glow: rgba(91, 141, 239, 0.25);
  --role-speaker-gradient: linear-gradient(135deg, #5b8def 0%, #4a7de0 100%);

  /* Volunteer - 珊瑚粉（热情、奉献） */
  --role-volunteer: #f06292;
  --role-volunteer-glow: rgba(240, 98, 146, 0.25);
  --role-volunteer-gradient: linear-gradient(135deg, #f06292 0%, #e04578 100%);

  /* === 功能色 === */
  --accent-primary: #7c6df0;   /* 主强调色（薰衣草紫） */
  --accent-hover: #6b5ce0;
  --accent-active: #5a4bd0;
  --accent-glow: rgba(124, 109, 240, 0.3);

  --success: #2dd4a8;
  --warning: #f5a623;
  --error: #ef4444;
  --info: #5b8def;

  /* === 特殊效果色 === */
  --gold-shimmer: linear-gradient(135deg, #f5a623 0%, #ffd700 50%, #f5a623 100%);
  --card-border: rgba(255, 255, 255, 0.06);
  --card-border-hover: rgba(255, 255, 255, 0.12);
  --glass-bg: rgba(26, 27, 37, 0.85);
  --glass-border: rgba(255, 255, 255, 0.08);

  /* === 间距系统（8px 基准） === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* === 圆角 === */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* === 阴影 === */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px var(--accent-glow);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--card-border);
  --shadow-card-hover: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--card-border-hover);

  /* === 过渡 === */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-spring: 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## 字体系统（Typography）

### 字体选择

```css
/* 显示字体：Outfit — 几何感强，现代而有力量感，适合标题和数字 */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');

/* 正文字体：Noto Sans SC — 中文最佳可读性，与 Outfit 的几何感互补 */
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');

:root {
  --font-display: 'Outfit', sans-serif;     /* 标题、数字、积分显示 */
  --font-body: 'Noto Sans SC', sans-serif;  /* 正文、描述、按钮文字 */
  --font-mono: 'JetBrains Mono', monospace; /* 兑换码显示 */
}
```

### 字号层级

```css
:root {
  /* 标题（使用 Outfit） */
  --text-hero: 48px;      /* 首页大标题 */
  --text-h1: 32px;        /* 页面标题 */
  --text-h2: 24px;        /* 区块标题 */
  --text-h3: 20px;        /* 卡片标题 */
  --text-h4: 16px;        /* 小标题 */

  /* 正文（使用 Noto Sans SC） */
  --text-body-lg: 16px;   /* 大正文 */
  --text-body: 14px;      /* 标准正文 */
  --text-body-sm: 13px;   /* 小正文 */
  --text-caption: 12px;   /* 标注/辅助文字 */
  --text-overline: 11px;  /* 上标/标签 */

  /* 特殊（使用 Outfit） */
  --text-points: 36px;    /* 积分数字显示 */
  --text-price: 24px;     /* 商品积分价格 */
  --text-badge: 11px;     /* 角色徽章文字 */
}
```

### 字重规范

| 用途 | 字重 | 字体 |
|------|------|------|
| 页面大标题 | 800 (ExtraBold) | Outfit |
| 区块标题 | 700 (Bold) | Outfit |
| 卡片标题 | 600 (SemiBold) | Outfit |
| 积分数字 | 700 (Bold) | Outfit |
| 按钮文字 | 600 (SemiBold) | Noto Sans SC |
| 正文 | 400 (Regular) | Noto Sans SC |
| 辅助文字 | 300 (Light) | Noto Sans SC |

---

## 角色徽章系统（Role Badge System）

每种角色有独特的视觉标识，贯穿整个界面。

### 徽章样式

```css
/* 通用徽章基础样式 */
.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-body);
  font-size: var(--text-badge);
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

/* UserGroupLeader 徽章 */
.role-badge--leader {
  background: var(--role-leader-glow);
  color: var(--role-leader);
  border: 1px solid rgba(245, 166, 35, 0.3);
}

/* CommunityBuilder 徽章 */
.role-badge--builder {
  background: var(--role-builder-glow);
  color: var(--role-builder);
  border: 1px solid rgba(45, 212, 168, 0.3);
}

/* Speaker 徽章 */
.role-badge--speaker {
  background: var(--role-speaker-glow);
  color: var(--role-speaker);
  border: 1px solid rgba(91, 141, 239, 0.3);
}

/* Volunteer 徽章 */
.role-badge--volunteer {
  background: var(--role-volunteer-glow);
  color: var(--role-volunteer);
  border: 1px solid rgba(240, 98, 146, 0.3);
}

/* "所有人" 徽章 */
.role-badge--all {
  background: rgba(124, 109, 240, 0.15);
  color: var(--accent-primary);
  border: 1px solid rgba(124, 109, 240, 0.3);
}
```

### 角色图标

每种角色配有一个简洁的 SVG 图标（16x16）：
- UserGroupLeader: 皇冠图标 👑
- CommunityBuilder: 积木/建筑图标 🏗
- Speaker: 麦克风图标 🎤
- Volunteer: 爱心图标 ❤️

---

## 核心组件设计（Core Components）

### 1. 商品卡片（Product Card）

商品卡片是整个商城最核心的 UI 元素，需要同时传达：商品信息、积分价格、身份权限、商品类型。

```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │     商品图片区域       │  │
│  │     (16:10 比例)      │  │
│  │                       │  │
│  │  ┌──────┐             │  │
│  │  │ CODE │  ← 类型标签  │  │
│  └──┴──────┴─────────────┘  │
│                              │
│  商品名称                    │
│  商品简述（最多两行）...      │
│                              │
│  ┌────────┐ ┌────────┐      │
│  │Leader  │ │Speaker │ ← 角色│
│  └────────┘ └────────┘      │
│                              │
│  ◆ 1,200 积分    [立即兑换]  │
│                              │
└─────────────────────────────┘
```

#### 卡片状态

```css
/* 可兑换状态（默认） */
.product-card {
  background: var(--bg-surface);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all var(--transition-base);
  cursor: pointer;
}

.product-card:hover {
  border-color: var(--card-border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-4px);
}

/* 无权限/锁定状态 */
.product-card--locked {
  opacity: 0.55;
  filter: saturate(0.3);
  cursor: not-allowed;
}

.product-card--locked::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 8px,
    rgba(0, 0, 0, 0.03) 8px,
    rgba(0, 0, 0, 0.03) 16px
  );
  pointer-events: none;
}

.product-card--locked:hover {
  transform: none;
  box-shadow: var(--shadow-card);
}

/* Code 专属商品特殊样式 */
.product-card--code-exclusive {
  border-color: rgba(245, 166, 35, 0.15);
}

.product-card--code-exclusive .product-card__type-tag {
  background: var(--gold-shimmer);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
  color: var(--text-inverse);
  font-weight: 700;
}

@keyframes shimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
```

#### 积分价格显示

```css
.product-card__price {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: var(--text-price);
  font-weight: 700;
  color: var(--text-primary);
}

.product-card__price-icon {
  width: 20px;
  height: 20px;
  background: var(--accent-primary);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 菱形积分图标 */
  transform: rotate(45deg);
}

/* Code 专属商品不显示积分价格，显示 "需要兑换码" */
.product-card--code-exclusive .product-card__price {
  font-size: var(--text-body);
  color: var(--role-leader);
  font-family: var(--font-body);
  font-weight: 500;
}
```

### 2. 积分余额展示（Points Balance）

积分余额是用户最关注的数据，需要突出显示。

```css
.points-balance {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  position: relative;
  overflow: hidden;
}

/* 背景装饰光效 */
.points-balance::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  opacity: 0.4;
  pointer-events: none;
}

.points-balance__number {
  font-family: var(--font-display);
  font-size: var(--text-points);
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -1px;
  /* 数字变化时的动画 */
  transition: all var(--transition-base);
}

.points-balance__label {
  font-family: var(--font-body);
  font-size: var(--text-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

### 3. 兑换码输入框（Code Input）

兑换码输入是高频操作，需要特殊设计。

```css
.code-input {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-void);
  border: 2px solid var(--card-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}

.code-input:focus-within {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.code-input__field {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono);
  font-size: 18px;
  letter-spacing: 3px;
  color: var(--text-primary);
  text-transform: uppercase;
}

.code-input__field::placeholder {
  color: var(--text-tertiary);
  letter-spacing: 1px;
  font-family: var(--font-body);
  font-size: var(--text-body);
}

.code-input__submit {
  padding: var(--space-2) var(--space-5);
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.code-input__submit:hover {
  background: var(--accent-hover);
  transform: scale(1.02);
}
```

### 4. 按钮系统（Buttons）

```css
/* 主按钮 */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;
}

.btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.btn-primary:active {
  background: var(--accent-active);
  transform: translateY(0);
}

/* 兑换按钮（特殊强调） */
.btn-redeem {
  background: linear-gradient(135deg, var(--accent-primary) 0%, #9b8afb 100%);
  padding: var(--space-3) var(--space-8);
  border-radius: var(--radius-full);
  font-size: var(--text-body-lg);
}

/* 禁用状态 */
.btn-primary:disabled,
.btn-redeem:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* 次要按钮（幽灵样式） */
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--card-border-hover);
}

/* 危险按钮（管理端用） */
.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
}
```

---

## 页面布局设计（Page Layouts）

### 整体布局结构

```
PC 端（≥ 1024px）:
┌──────────────────────────────────────────┐
│  Logo   [商城] [我的] [兑换码]   积分:1200│  ← 顶部导航栏
├──────────────────────────────────────────┤
│                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ 商品 │ │ 商品 │ │ 商品 │ │ 商品 │   │  ← 4列网格
│  │ 卡片 │ │ 卡片 │ │ 卡片 │ │ 卡片 │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │      │ │      │ │      │ │      │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│                                          │
└──────────────────────────────────────────┘

手机端（< 768px）:
┌──────────────────┐
│  Logo    积分:1200│  ← 简化导航
├──────────────────┤
│ [全部][积分][Code]│  ← 筛选标签
├──────────────────┤
│ ┌──────┐┌──────┐ │
│ │ 商品 ││ 商品 │ │  ← 2列网格
│ └──────┘└──────┘ │
│ ┌──────┐┌──────┐ │
│ │      ││      │ │
│ └──────┘└──────┘ │
├──────────────────┤
│ [商城][兑换][我的]│  ← 底部 Tab 栏
└──────────────────┘
```

### 响应式网格

```css
.product-grid {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-6);
}

/* PC 端：4 列 */
@media (min-width: 1024px) {
  .product-grid {
    grid-template-columns: repeat(4, 1fr);
    max-width: 1280px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }
}

/* 平板：3 列 */
@media (min-width: 768px) and (max-width: 1023px) {
  .product-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* 手机：2 列 */
@media (max-width: 767px) {
  .product-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    padding: var(--space-3);
  }
}
```

### 导航栏

```css
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 64px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-bottom: 1px solid var(--glass-border);
}

.navbar__logo {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

/* Logo 中的 "积分" 二字用强调色 */
.navbar__logo-accent {
  background: linear-gradient(135deg, var(--accent-primary), #9b8afb);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 导航项 */
.navbar__item {
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.navbar__item:hover,
.navbar__item--active {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* 积分显示（导航栏内） */
.navbar__points {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(124, 109, 240, 0.1);
  border: 1px solid rgba(124, 109, 240, 0.2);
  border-radius: var(--radius-full);
}

.navbar__points-value {
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--accent-primary);
}
```

---

## 页面设计详情（Page Designs）

### 1. 登录页

```
┌──────────────────────────────────────────┐
│                                          │
│         ◆ 积分商城                       │
│         Points Mall                      │
│                                          │
│    ┌──────────────────────────┐          │
│    │                          │          │
│    │   ┌──────────────────┐   │          │
│    │   │  微信扫码登录     │   │          │
│    │   │                  │   │          │
│    │   │   [二维码区域]    │   │          │
│    │   │                  │   │          │
│    │   └──────────────────┘   │          │
│    │                          │          │
│    │   ─── 或使用邮箱 ───     │          │
│    │                          │          │
│    │   邮箱: [____________]   │          │
│    │   密码: [____________]   │          │
│    │                          │          │
│    │   [      登  录      ]   │          │
│    │   还没有账号？注册       │          │
│    │                          │          │
│    └──────────────────────────┘          │
│                                          │
│  背景：深色 + 微妙的几何网格纹理         │
└──────────────────────────────────────────┘
```

设计要点：
- 背景使用 `--bg-void` + 微妙的几何网格 SVG 纹理（低透明度）
- 登录卡片使用 `--bg-surface` + 毛玻璃效果
- 微信扫码和邮箱登录用分隔线区分
- Logo 使用 Outfit 字体 + 渐变色强调

### 2. 商品列表页（首页）

```
┌──────────────────────────────────────────┐
│  ◆积分商城   商城  兑换码  我的   ◆ 1,200│
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  你好，张三 👋                    │    │
│  │  UserGroupLeader · Speaker       │    │
│  │                                  │    │
│  │  ◆ 1,200 积分                    │    │
│  │  [输入兑换码获取积分...]  [兑换]  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [全部] [积分商品] [Code专属] | 筛选 ▾   │
│                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ 🔓   │ │      │ │ 🔒   │ │ ✨   │   │
│  │ 积分  │ │ 积分 │ │ 积分  │ │ CODE │   │
│  │ 商品  │ │ 商品 │ │ 商品  │ │ 专属 │   │
│  │      │ │      │ │(灰显) │ │      │   │
│  │Leader│ │ ALL  │ │Spkr  │ │      │   │
│  │800pt │ │200pt │ │500pt │ │需Code│   │
│  │[兑换]│ │[兑换]│ │[锁定]│ │[详情]│   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│                                          │
└──────────────────────────────────────────┘
```

设计要点：
- 顶部欢迎区域包含用户信息、角色徽章、积分余额和快捷兑换码输入
- 筛选栏使用 pill 形状的标签切换
- 锁定商品灰显 + 斜线纹理覆盖 + 锁图标
- Code 专属商品卡片有金色微光边框动画
- 商品卡片 hover 时上浮 4px + 边框高亮

### 3. 商品详情页

```
┌──────────────────────────────────────────┐
│  ← 返回                          ◆ 1,200│
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────┐  商品名称            │
│  │                │                      │
│  │   商品大图     │  ┌────────┐┌───────┐ │
│  │   (1:1 比例)   │  │Leader  ││Speaker│ │
│  │                │  └────────┘└───────┘ │
│  │                │                      │
│  └────────────────┘  ◆ 1,200 积分        │
│                                          │
│  ── 商品描述 ──                          │
│  这是一款限定商品，仅限 UserGroupLeader  │
│  和 Speaker 身份的用户兑换...            │
│                                          │
│  ── 身份限定说明 ──                      │
│  ⚠ 此商品仅限以下身份兑换：             │
│  • UserGroupLeader 👑                    │
│  • Speaker 🎤                            │
│                                          │
│  ── 或（Code 专属商品时显示）──          │
│  🎯 关联活动：2026 年春季技术峰会        │
│  此商品需要活动专属兑换码才能兑换        │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │         [  立即兑换  ]           │    │
│  │    当前余额: 1,200  需要: 800    │    │
│  └──────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

设计要点：
- PC 端左右分栏（图片 + 信息），手机端上下排列
- 身份限定说明使用带角色色彩的提示框
- Code 专属商品显示关联活动信息，用金色边框提示框
- 兑换按钮区域固定在底部（手机端）或右侧（PC 端）
- 兑换成功后播放粒子动画 + 勋章解锁效果

### 4. 个人中心页

```
┌──────────────────────────────────────────┐
│  ← 返回                                 │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  [头像]  张三                    │    │
│  │          user@example.com        │    │
│  │                                  │    │
│  │  ┌────────┐┌────────┐┌────────┐ │    │
│  │  │Leader  ││Speaker ││Builder │ │    │
│  │  └────────┘└────────┘└────────┘ │    │
│  │                                  │    │
│  │  ◆ 1,200 积分                    │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [积分记录]  [兑换记录]                  │
│  ─────────────────────                   │
│  + 500  兑换码 ABC123    2026-03-20      │
│  - 800  AWS 贴纸套装     2026-03-18      │
│  + 200  兑换码 XYZ789    2026-03-15      │
│  ...                                     │
│                                          │
└──────────────────────────────────────────┘
```

### 5. 管理端页面

管理端采用左侧导航 + 右侧内容区的经典布局，但保持与用户端一致的暗色主题。

```
┌────────┬─────────────────────────────────┐
│        │  商品管理                        │
│ 📦商品 │                                 │
│ 🔑Code │  [+ 创建积分商品] [+ 创建Code商品]│
│ 👥用户 │                                 │
│        │  ┌─────────────────────────────┐│
│        │  │ 名称    类型   库存  兑换  状态││
│        │  │ 贴纸    积分   50   12   上架 ││
│        │  │ T恤     Code   20    5   上架 ││
│        │  │ 杯子    积分    0   30   下架 ││
│        │  └─────────────────────────────┘│
│        │                                 │
└────────┴─────────────────────────────────┘
```

管理端设计要点：
- 左侧导航宽度 240px，可折叠
- 表格使用 `--bg-surface` 背景 + 行 hover 高亮
- 操作按钮使用图标 + 文字组合
- 状态标签使用对应颜色（上架=绿色，下架=灰色）

---

## 动效设计（Motion Design）

### 页面进入动画

```css
/* 商品卡片交错入场 */
.product-card {
  opacity: 0;
  transform: translateY(20px);
  animation: cardEnter 0.5s ease-out forwards;
}

.product-card:nth-child(1) { animation-delay: 0.05s; }
.product-card:nth-child(2) { animation-delay: 0.10s; }
.product-card:nth-child(3) { animation-delay: 0.15s; }
.product-card:nth-child(4) { animation-delay: 0.20s; }
.product-card:nth-child(5) { animation-delay: 0.25s; }
.product-card:nth-child(6) { animation-delay: 0.30s; }
.product-card:nth-child(7) { animation-delay: 0.35s; }
.product-card:nth-child(8) { animation-delay: 0.40s; }

@keyframes cardEnter {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 兑换成功动画

兑换成功时播放一个短暂的「勋章解锁」效果：

```css
/* 兑换成功弹窗 */
.redeem-success {
  animation: successPop 0.6s var(--transition-spring);
}

@keyframes successPop {
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  60% {
    transform: scale(1.05);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/* 积分数字变化动画 */
.points-counter-change {
  animation: pointsBounce 0.4s ease-out;
}

@keyframes pointsBounce {
  0% { transform: scale(1); }
  30% { transform: scale(1.2); color: var(--success); }
  100% { transform: scale(1); }
}

/* 积分减少时 */
.points-counter-decrease {
  animation: pointsDecrease 0.4s ease-out;
}

@keyframes pointsDecrease {
  0% { transform: scale(1); }
  30% { transform: scale(0.9); color: var(--error); }
  100% { transform: scale(1); }
}
```

### 微交互

```css
/* 角色徽章 hover 发光 */
.role-badge:hover {
  box-shadow: 0 0 12px currentColor;
  transform: scale(1.05);
  transition: all var(--transition-fast);
}

/* 兑换码输入框打字效果 */
.code-input__field {
  caret-color: var(--accent-primary);
}

/* 筛选标签切换 */
.filter-tab {
  position: relative;
  padding: var(--space-2) var(--space-5);
  color: var(--text-secondary);
  transition: color var(--transition-fast);
}

.filter-tab--active {
  color: var(--text-primary);
}

.filter-tab--active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 2px;
  background: var(--accent-primary);
  border-radius: 1px;
  animation: tabIndicator 0.3s ease-out;
}

@keyframes tabIndicator {
  from { width: 0; opacity: 0; }
  to { width: 60%; opacity: 1; }
}

/* 锁定商品的锁图标脉动 */
.product-card--locked .lock-icon {
  animation: lockPulse 2s ease-in-out infinite;
}

@keyframes lockPulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
}
```

---

## 背景与纹理（Backgrounds & Textures）

### 全局背景

```css
body {
  background-color: var(--bg-base);
  /* 微妙的噪点纹理增加质感 */
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.02'/%3E%3C/svg%3E");
}
```

### 登录页背景

```css
.login-page {
  background-color: var(--bg-void);
  background-image:
    /* 几何网格 */
    linear-gradient(rgba(124, 109, 240, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(124, 109, 240, 0.03) 1px, transparent 1px),
    /* 角落光晕 */
    radial-gradient(ellipse at 20% 50%, rgba(124, 109, 240, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(91, 141, 239, 0.06) 0%, transparent 50%);
  background-size: 40px 40px, 40px 40px, 100% 100%, 100% 100%;
}
```

### 欢迎区域背景

```css
.welcome-section {
  background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-xl);
  position: relative;
  overflow: hidden;
}

/* 装饰性光斑 */
.welcome-section::before {
  content: '';
  position: absolute;
  top: -30%;
  right: -10%;
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  opacity: 0.3;
  pointer-events: none;
}

.welcome-section::after {
  content: '';
  position: absolute;
  bottom: -20%;
  left: -5%;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, var(--role-leader-glow) 0%, transparent 70%);
  opacity: 0.2;
  pointer-events: none;
}
```

---

## 管理端特殊样式（Admin Specific）

管理端保持暗色主题一致性，但使用更紧凑的布局和更多数据展示组件。

```css
/* 管理端侧边栏 */
.admin-sidebar {
  width: 240px;
  background: var(--bg-void);
  border-right: 1px solid var(--card-border);
  padding: var(--space-4) 0;
}

.admin-sidebar__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: var(--text-body);
  transition: all var(--transition-fast);
}

.admin-sidebar__item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.admin-sidebar__item--active {
  background: rgba(124, 109, 240, 0.1);
  color: var(--accent-primary);
  border-right: 3px solid var(--accent-primary);
}

/* 数据表格 */
.admin-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.admin-table th {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font-family: var(--font-body);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--card-border);
}

.admin-table td {
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-body);
  font-size: var(--text-body);
  color: var(--text-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.admin-table tr:hover td {
  background: var(--bg-hover);
}

/* 状态标签 */
.status-tag--active {
  color: var(--success);
  background: rgba(45, 212, 168, 0.15);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-caption);
}

.status-tag--inactive {
  color: var(--text-tertiary);
  background: rgba(93, 94, 114, 0.15);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-caption);
}
```

---

## Taro / 微信小程序适配说明

### 样式适配策略

由于 Taro 编译到小程序时有一些 CSS 限制，需要注意：

1. 小程序不支持 `backdrop-filter`，导航栏改用半透明纯色背景
2. 小程序不支持 CSS 变量嵌套，所有变量在编译时展开
3. 小程序使用 `rpx` 单位，Taro 自动将 `px` 转换为 `rpx`
4. 小程序不支持 `::before` / `::after` 伪元素的部分用法，装饰性元素改用 `View` 组件

### 小程序特殊处理

```css
/* 小程序导航栏（无 backdrop-filter） */
.navbar--miniapp {
  background: rgba(18, 19, 26, 0.95);
  /* 移除 backdrop-filter */
}

/* 小程序底部安全区域 */
.bottom-bar--miniapp {
  padding-bottom: env(safe-area-inset-bottom);
}
```

---

## 设计 Token 汇总

| Token 类别 | 数量 | 说明 |
|-----------|------|------|
| 颜色变量 | 35+ | 背景、文字、角色色、功能色、特效色 |
| 间距 | 12 | 4px ~ 64px（8px 基准） |
| 圆角 | 5 | 6px ~ 9999px |
| 阴影 | 6 | 从微妙到发光 |
| 字号 | 12 | 11px ~ 48px |
| 过渡 | 4 | 150ms ~ 500ms |
| 动画 | 8 | 入场、成功、脉动、弹跳等 |

整套设计系统确保用户端和管理端视觉统一，同时通过角色专属色彩和勋章式卡片设计，让积分商城具有独特的社区归属感和成就感。