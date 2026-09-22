# 多平台内容运营 Local

多平台内容运营是本机部署、以团队协作为核心的 AI 内容运营平台。小红书、知乎和微信公众号使用独立账号与发布适配器，共享选题、创作、审核和发布工作流。项目不是 SaaS：业务数据库、账号 Cookie、AI Key 和发布素材都保存在团队主机本地。

> 项目采用 [Apache License 2.0](../LICENSE) 开源。第三方组件继续适用各自的许可证，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 支持范围

- macOS：Apple Silicon（M1/M2/M3/M4 系列），原生 WKWebView 应用壳
- Windows：Windows 10/11 x64 便携版，WinForms + WebView2 应用壳
- 使用者提供自己的平台账号、AI API Key 和网络环境
- 支持选题、认领、AI 创作、Humanizer 去 AI 味、审核、排队和人工触发发布
- 小红书：保留既有 MCP 爆款搜索、扫码身份绑定、图文审核与人工发布链路
- 知乎 V1：支持人工创建知乎选题、知乎专栏 AI 创作和文本审核；正式发布、问题池与回答发布尚未交付
- 默认只监听 `127.0.0.1`，不向局域网或公网开放
- 小红书发布依赖非官方浏览器自动化，平台页面变化、风控或账号状态都可能导致失败；不得承诺“永久可用”“绝不封号”或“官方接口”

## 未签名安装包

### macOS Apple Silicon

```bash
npm run package:unsigned
```

产物位于 `outputs/`，包括未签名 DMG 和对应 SHA-256。App 只使用不含开发者身份的本地 ad-hoc 封装签名，用于保证应用结构完整；这不属于 Apple Developer 签名或公证。买家将“多平台内容运营.app”拖入“应用程序”后，首次启动需右键应用选择“打开”，再确认打开；如果系统仍阻止，可前往“系统设置 → 隐私与安全性”选择“仍要打开”。不要要求买家关闭 Gatekeeper 或执行陌生终端命令。

App 内置 Apple Silicon Node.js、小红书 MCP 和本地 Worker 运行环境。启动后平台显示在独立的原生应用窗口中，不再跳转到系统浏览器；菜单栏会显示应用图标，可用于重新打开窗口、打开数据文件夹和彻底退出平台。买家不需要安装 Node.js，也不需要使用终端。

全新安装第一次打开时必须先选择“独立使用”“创建团队主机”或“加入已有团队”，选择前不会启动后台服务。独立模式的数据只在本机；团队主机开放局域网业务服务并生成团队连接码；团队成员填写主机地址与连接码，只连接主机，不启动本地 Worker、数据库、运行管理器或 MCP。主机模式会直接显示局域网地址和连接码，可用“复制连接信息”发给可信成员。运行管理器、小红书 MCP、Cookie 与 AI Key 始终只保存在团队主机，不向局域网直接开放。当前局域网连接使用明文 HTTP，只适用于可信家庭或办公室专用网络，不应在公共 Wi-Fi 使用，也不得通过路由器端口映射暴露到公网。跨网络协作请先使用 Tailscale、WireGuard 等加密隧道；若经反向代理提供 HTTPS，只有在代理确实覆盖完整链路时才设置 `HONGSHUTAI_TRUST_PROXY_HEADERS=1`。

macOS 15 及以上会在成员首次连接时询问是否允许多平台内容运营访问本地网络，请选择“允许”。如果曾拒绝，可从应用菜单选择“打开本地网络权限设置…”，在“隐私与安全性 → 本地网络”中重新开启。未授权时成员无法访问局域网主机，但成员模式仍不会启动任何本地后台。

### Windows 10/11 x64

Windows 包必须在 Windows x64 环境构建：

```powershell
npm ci
npx playwright-core install chromium
npm run package:windows
```

产物位于 `outputs/`，包括 `windows-x64-portable.zip` 和对应 SHA-256。便携包内置 Node.js、Windows x64 小红书 MCP、Chromium、本地 Worker 和自包含 .NET 8 启动器，不要求用户安装 Node.js 或 .NET。必须完整解压后运行“多平台内容运营.exe”；关闭窗口后应用仍驻留系统托盘，从托盘菜单退出才会停止服务。

Windows 数据保存在 `%LOCALAPPDATA%\多平台内容运营`。团队主机模式首次触发 Windows 防火墙提示时，只应允许“专用网络”，不要允许公共网络。Windows 11 通常已经包含 WebView2 Runtime；缺失时启动器会明确提示安装。

当前 Windows ZIP 尚未使用 Authenticode 代码签名，SmartScreen 可能显示“未知发布者”。只应从项目官方 GitHub Release 下载并核对 SHA-256；对外正式发布前建议配置可信代码签名证书。

## 开发与本机启动

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run prepare:runtime
npm run dev
```

浏览器打开 `http://127.0.0.1:3000`。首次打开时创建管理员账号；随后可在“系统设置”中为每位工作人员创建独立账号。

生产模式需先构建，再启动：

```bash
npm run build
npm start
```

`npm start` 会同时启动网页 Worker 和受内部令牌保护的小红书运行管理器。账号平时休眠；扫码、检查或发布时才按需启动 MCP，空闲十分钟自动关闭。关闭终端中的进程即可完全退出。

## 角色权限

| 角色     | 可执行操作                         |
| -------- | ---------------------------------- |
| 管理员   | 所有操作、成员和账号管理、系统设置 |
| 内容运营 | 选题、认领、编辑草稿、提交审核；审核通过后发布自己负责的内容 |
| 审核员   | 最高业务权限：查看、审核，并可发布任意已通过内容 |
| 只读成员 | 仅查看，无写入权限                 |

角色限制同时在界面和服务端校验。内容负责人可发布自己负责的内容，审核员可发布任意已通过内容；发布任务通过数据库原子抢占，重复点击或并发请求不会同时启动两次浏览器发布。

## 本地数据与安全

- 开发源码运行时：保存在项目目录的 `.wrangler/` 和 `runtime/`
- macOS 安装版：为兼容旧版本，仍保存在 `~/Library/Application Support/红薯台/`
- Windows 安装版：保存在 `%LOCALAPPDATA%\多平台内容运营\`
- App 内的 `runtime-cache/` 只是可重新生成的运行缓存，买家数据仍在同级数据库及 runtime 数据目录

这些目录均已从 Git 和源码包排除。运行管理器会将敏感目录权限收紧为 `0700`、Cookie 文件收紧为 `0600`。不要把上述目录、备份文件或截图中的二维码发给他人。

知乎默认使用内置 Chromium 的可见浏览器登录，不要求用户申请 OpenAPI。每个账号使用独立的持久化目录 `runtime/platform-accounts/<账号 ID>/zhihu-profile/`，仅保存在团队主机，安装包和 Git 仓库不会包含登录数据。已获批的 OpenAPI 凭证仍可作为高级后备能力，但不再是普通用户的配置入口。

会话 Cookie 使用 `SameSite=Strict`；HTTPS 环境会自动增加 `Secure`。本地版默认只使用回环地址，不应通过端口转发、反向代理或路由器映射暴露到公网。

## 备份与恢复

执行前必须完全退出多平台内容运营。

```bash
npm run backup
npm run restore -- /绝对路径/multi-platform-content-日期.tar.gz --confirm
```

备份包含数据库、账号 Cookie、知乎开放平台凭证、AI 配置和发布素材，等同于敏感凭据，应由买家自行加密保管。恢复前会把当前数据复制到 `restore-rollback-日期/`，确认恢复正常后再手动删除该目录。

## 发布依赖与许可证

项目源码采用 [Apache License 2.0](../LICENSE)。`npm run prepare:runtime` 会根据构建系统下载 `xiaohongshu-mcp v2.5.0` 的官方 macOS arm64 或 Windows amd64 Release，并验证固定 SHA-256；哈希不一致时会拒绝写入。第三方组件及许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。最终安装包必须同时附带项目许可证、该文件和第三方完整许可证文本。

## 质量门禁

```bash
npm run verify
```

该命令依次执行 ESLint、TypeScript、生产构建和全部自动化测试。GitHub Actions 会执行相同质量门禁，并在 Windows runner 构建 x64 便携包作为工作流产物。两种系统的公开 Release 都必须在对应全新机器上完成安装、升级、卸载和发布链路测试。逐项要求见 [RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md)。

参与贡献前请阅读仓库根目录的 [CONTRIBUTING.md](../CONTRIBUTING.md) 和 [SECURITY.md](../SECURITY.md)。

## 当前边界

- 这是付费测试版，不应宣传为无人值守群控或官方授权工具。
- 发布仍由有权限的用户人工触发；成功与否以小红书页面和账号后台结果为准。
- 知乎专栏通过独立 Playwright 浏览器适配器发布，不复用小红书 MCP。只有取得最终文章地址才标记成功；点击发布后无法确认结果时会锁定为“待核验”，禁止直接重试。
- 买家需遵守小红书规则，并对账号、内容、图片版权及发布行为负责。
- 源码通过测试不等于安装包已完成签名、公证和跨机器验证。
