# 第三方软件声明

多平台内容运营包含或调用以下第三方开源组件。安装包必须随附本文件以及对应的完整许可证文本。

## xiaohongshu-mcp

- 项目：https://github.com/xpzouying/xiaohongshu-mcp
- 固定版本：v2.5.0
- 固定提交：6583124dfda92312b6bc19a042a6acfae63fe498
- macOS arm64 二进制 SHA-256：`3e32e08c3403d22a5efef2f06aa52630b458819fc54474cba23e896c7092c38e`
- 许可证：Apache License 2.0
- Copyright 2025 xpzouying

`npm run prepare:runtime` 会从上游官方 Release 下载固定二进制、验证哈希，并把完整 Apache-2.0 许可证保存到 `runtime/bin/LICENSE.xiaohongshu-mcp-Apache-2.0.txt`。该目录应被放入最终安装包，但不会提交到 Git。

## Humanizer

- 项目：https://github.com/blader/humanizer
- 内嵌规则版本：2.11.2
- 许可证：MIT
- Copyright (c) 2025 Siqi Chen

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## JavaScript 依赖

直接运行依赖 Drizzle ORM（Apache-2.0）、React（MIT）、React DOM（MIT）、Playwright Core（Apache-2.0）、marked（MIT）和 sanitize-html（MIT）。构建及开发工具的许可证由锁文件对应的软件包提供。正式发布流程应生成并随安装包附带完整的软件物料清单（SBOM）与许可证汇总。

## doocs/md 排版参考

- 项目：https://github.com/doocs/md
- 许可证：WTFPL
- 用途：公众号 Markdown 排版的主题分层、内联样式和预览模式参考；本项目的渲染器为独立实现。

DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
Version 2, December 2004

Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

Everyone is permitted to copy and distribute verbatim or modified copies of this license document, and changing it is allowed as long as the name is changed.

DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

0. You just DO WHAT THE FUCK YOU WANT TO.

## Chromium

安装包内置 Playwright 使用的 Chromium，仅用于知乎账号的可见浏览器登录和后续发布适配。Chromium 采用 BSD 风格许可证，并包含各自使用不同开源许可证的第三方组件；完整许可证文件必须与浏览器运行时一同保留在 App 内。

## Node.js

未签名 macOS App 内置构建时使用的官方 Node.js arm64 运行时，买家无需另行安装 Node.js。完整 Node.js 许可证随 App 保存为 `Contents/Resources/runtime/LICENSE.Node.txt`；运行时版本记录在同目录的 `NODE_VERSION.txt`。
