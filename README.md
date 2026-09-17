# 多平台内容运营

本机部署、面向团队协作的 AI 内容运营平台。小红书、知乎和微信公众号使用独立账号与发布适配器，共享选题研究、内容创作、审核和发布流程。

## 当前能力

- 小红书：爆款搜索、账号隔离、AI 图文创作、审核和人工触发发布
- 知乎：外部文章选题研究、专栏长文创作、文本审核和浏览器发布
- 微信公众号：外部文章选题研究、长文创作、Markdown 主题排版、预览、审核和官方 OpenAPI 草稿箱
- 团队：管理员、内容运营、审核员、发布员和只读成员权限
- 本地优先：数据库、账号 Cookie、AI Key 和发布素材保存在团队主机
- 桌面分发：macOS Apple Silicon App/DMG，以及 Windows 10/11 x64 便携包

## 快速开始

要求 Node.js 22.13 或更高版本：

```bash
cd platform
npm ci
npm run prepare:runtime
npm run dev
```

浏览器访问 `http://127.0.0.1:3000`。完整架构、安装包、数据目录、备份和平台边界见 [platform/README.md](./platform/README.md)。

## 质量与安全

```bash
cd platform
npm run verify
npm audit --audit-level=high
```

请勿提交或公开 Cookie、二维码、API Key、公众号 AppSecret、数据库、备份、浏览器资料或真实用户内容。安全漏洞请通过 GitHub Private Vulnerability Reporting 私下报告，详情见 [SECURITY.md](./SECURITY.md)。

贡献代码前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。第三方组件及许可证见 [platform/THIRD_PARTY_NOTICES.md](./platform/THIRD_PARTY_NOTICES.md)。

## 许可证状态

仓库目前公开可见，但项目许可证仍待维护者最终选择。在根目录正式加入 `LICENSE` 之前，不应将“可查看源代码”等同于已获得复制、修改或再分发授权。

## 重要边界

- 平台发布仍由有权限的用户人工触发，不应作为无人值守群控工具。
- 小红书和知乎的浏览器自动化会受页面变化、平台风控和账号状态影响。
- 使用者必须遵守各内容平台规则，并对账号、内容、图片版权和发布行为负责。
- macOS 与 Windows 公开安装包在完成对应系统的干净机器验收和代码签名前，都应标记为测试构建。
