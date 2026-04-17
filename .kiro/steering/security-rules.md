---
inclusion: always
---

# 安全规则 — Git 提交前必须遵守

## 禁止提交的内容

1. **明文密码** — 任何包含真实密码的文件（测试密码、用户密码、数据库密码）
2. **API 密钥/密文** — AWS Access Key、Secret Key、JWT Secret、WeChat AppSecret 等
3. **私钥文件** — `.pem`、`.key`、`-----BEGIN PRIVATE KEY-----`
4. **.env 文件** — 任何环境变量文件
5. **docs/ 目录** — 包含 SOP 操作手册等内部文档（已加入 .gitignore）
6. **临时调试文件** — `*.json`（非配置文件）、`response.json`、`payload.json` 等

## 提交前检查清单

每次执行 `git add` 或 `git commit` 前：
- 检查 `git diff --cached` 中是否包含密码、密钥、token 等敏感信息
- 确认没有 `docs/` 目录下的文件被暂存
- 确认没有 `.env` 文件被暂存
- 如果修改了 CDK 文件（`packages/cdk/`），检查是否有硬编码的 secret 值

## 已知风险文件

- `packages/cdk/bin/app.ts` — 包含 AWS 账号 ID（通过 ACM 证书 ARN），可接受但需注意
- `docs/SOP-操作手册.md` — 包含测试账号密码，**绝对不能提交**（已在 .gitignore 中）

## 这个 repo 是公开的

GitHub repo `cnusergroup/ug-point-store` 是 **public** 的，任何人都能看到提交的内容。
