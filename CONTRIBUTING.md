# Contributing

感谢你参与多平台内容运营项目。

## 开始之前

- 不要在 Issue、PR、日志或截图中提交 Cookie、二维码、API Key、公众号密钥、账号资料、数据库或真实用户内容。
- 功能变更请先说明目标平台、使用场景、风险和验证方式。
- 平台自动化必须保留人工确认、失败状态和审计记录，不得伪造发布成功。
- 安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告，不要公开披露利用细节。

## 本地开发

```bash
cd platform
npm ci
npm run prepare:runtime
npm run dev
```

提交前运行：

```bash
npm run verify
npm audit --audit-level=high
```

## Pull Request

PR 应保持单一目标，并说明：

- 行为变化及涉及的平台；
- 数据库或本地数据是否需要迁移；
- 权限、凭据、发布和隐私影响；
- 已执行的自动化测试和人工验证；
- 新增第三方依赖的来源与许可证。

不要提交 `outputs/`、`.wrangler/`、`runtime/accounts/`、浏览器资料、备份或本地规划文件。
