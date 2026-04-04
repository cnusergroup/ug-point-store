---
inclusion: fileMatch
fileMatchPattern: "packages/frontend/**"
---

# 前端设计规范 Steering

当编辑或创建前端文件时，必须严格遵循以下设计规范。

## 核心规则

1. **所有颜色必须使用 CSS 变量**，不允许硬编码色值。变量定义在 `packages/frontend/src/app.scss` 的 `:root` 中。
2. **所有间距必须使用 `--space-*` 变量**（4px ~ 64px，8px 基准）。
3. **所有圆角必须使用 `--radius-*` 变量**（sm/md/lg/xl/full）。
4. **所有过渡必须使用 `--transition-*` 变量**（fast/base/slow/spring）。
5. **字体**：标题和数字用 `var(--font-display)`（Outfit），正文用 `var(--font-body)`（Noto Sans SC），兑换码用 `var(--font-mono)`。
6. **角色徽章**使用全局 `.role-badge` 类（定义在 app.scss），页面 SCSS 不要重复定义。
7. **按钮**使用全局 `.btn-primary`、`.btn-redeem`、`.btn-secondary`、`.btn-danger` 类。
8. **动画关键帧**（cardEnter、shimmer、lockPulse、successPop 等）定义在 app.scss，页面不要重复。

## 色彩变量速查

```
背景：--bg-void / --bg-base / --bg-surface / --bg-elevated / --bg-hover
文字：--text-primary / --text-secondary / --text-tertiary / --text-inverse
角色：--role-leader / --role-builder / --role-speaker / --role-volunteer
功能：--accent-primary / --accent-hover / --accent-active / --success / --warning / --error / --info
边框：--card-border / --card-border-hover / --glass-bg / --glass-border
```

## 完整设计规范

完整的设计系统文档（包含所有 CSS 变量定义、组件样式、页面布局、动效设计）请参考：
#[[file:.kiro/specs/points-mall/frontend-design.md]]
