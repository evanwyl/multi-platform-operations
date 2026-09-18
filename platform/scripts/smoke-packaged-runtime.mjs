import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const extractedRoot = resolve(process.argv[2] || "");
if (!existsSync(extractedRoot)) throw new Error("请提供已解压的 Windows 包目录");

function findFile(root, suffix) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (path.replaceAll("\\", "/").endsWith(suffix)) return path;
    }
  }
  return "";
}

const manager = findFile(extractedRoot, "/resources/app/runtime/manager.mjs");
const node = findFile(extractedRoot, "/resources/runtime/node.exe");
if (!manager || !node) throw new Error("安装包缺少内置 Node.js 或运行管理器");
const safePath = join(dirname(manager), "safe-path.mjs");
if (!existsSync(safePath)) throw new Error("安装包缺少 runtime/safe-path.mjs");

const port = 24000 + (process.pid % 1000);
const token = `package-smoke-${process.pid}`.padEnd(48, "x");
const dataRoot = mkdtempSync(join(tmpdir(), "multi-platform-package-smoke-"));
const appRoot = resolve(dirname(manager), "..");
const child = spawn(node, [manager], {
  cwd: appRoot,
  env: {
    ...process.env,
    MANAGER_PORT: String(port),
    RUNTIME_MANAGER_TOKEN: token,
    HONGSHUTAI_APP_ROOT: appRoot,
    HONGSHUTAI_DATA_ROOT: dataRoot,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  let payload;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`运行管理器提前退出：${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) { payload = await response.json(); break; }
    } catch { /* waiting for startup */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!payload?.ok) throw new Error(`安装包运行管理器 /health 未就绪：${stderr}`);
  process.stdout.write(`安装包烟测通过：${basename(dirname(dirname(manager)))} /health\n`);
} finally {
  if (child.exitCode === null) child.kill();
  rmSync(dataRoot, { recursive: true, force: true });
}
