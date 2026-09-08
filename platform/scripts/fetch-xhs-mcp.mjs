import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = "v2.5.0";
const expectedSha256 = "3e32e08c3403d22a5efef2f06aa52630b458819fc54474cba23e896c7092c38e";
const projectRoot = resolve(import.meta.dirname, "..");
const binRoot = resolve(projectRoot, "runtime/bin");
const binaryPath = resolve(binRoot, "xiaohongshu-mcp-darwin-arm64");
const licensePath = resolve(binRoot, "LICENSE.xiaohongshu-mcp-Apache-2.0.txt");
const releaseRoot = `https://github.com/xpzouying/xiaohongshu-mcp/releases/download/${version}`;

function checksum(data) {
  return createHash("sha256").update(data).digest("hex");
}

mkdirSync(binRoot, { recursive: true, mode: 0o700 });
let binary = existsSync(binaryPath) ? readFileSync(binaryPath) : null;
if (binary && checksum(binary) !== expectedSha256) throw new Error("现有小红书 MCP 文件校验失败；请移走该文件后重新准备运行环境");

if (!binary) {
  process.stdout.write(`正在下载小红书 MCP ${version}（macOS Apple Silicon）…\n`);
  const response = await fetch(`${releaseRoot}/xiaohongshu-mcp-darwin-arm64`);
  if (!response.ok) throw new Error(`下载小红书 MCP 失败（${response.status}）`);
  binary = Buffer.from(await response.arrayBuffer());
  if (checksum(binary) !== expectedSha256) throw new Error("下载的小红书 MCP 校验失败，已拒绝写入");
  writeFileSync(binaryPath, binary, { mode: 0o755 });
}
chmodSync(binaryPath, 0o755);

if (!existsSync(licensePath)) {
  const response = await fetch("https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/main/LICENSE");
  if (!response.ok) throw new Error(`下载小红书 MCP 许可证失败（${response.status}）`);
  writeFileSync(licensePath, `${await response.text()}\n`, { mode: 0o644 });
}

process.stdout.write(`运行依赖已准备并通过 SHA-256 校验：${expectedSha256}\n`);
