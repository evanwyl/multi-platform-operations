import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { chromium } from "playwright-core";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "outputs");
const archiveRoot = resolve(outputRoot, "archive");
const version = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
).version;
const packageName = `多平台内容运营-${version}-windows-x64-portable`;
const packageRoot = resolve(outputRoot, packageName);
const packagedApp = resolve(packageRoot, "resources/app");
const packagedRuntime = resolve(packageRoot, "resources/runtime");
const zipPath = resolve(outputRoot, `${packageName}.zip`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败（${result.status ?? "unknown"}）`);
  }
}

function assertNoCustomerData(root) {
  const forbiddenNames = new Set([
    ".env",
    "ai.json",
    "cookies.json",
    "team-config.json",
  ]);
  const forbiddenDatabase = /\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i;
  for (const directory of [
    "resources/app/.wrangler",
    "resources/app/backups",
    "resources/app/runtime/accounts",
    "resources/app/runtime/platform-accounts",
    "resources/app/runtime/analysis",
    "resources/app/runtime/config",
    "resources/app/runtime/generated",
    "resources/app/runtime/publish-assets",
    "resources/app/runtime/trend-covers",
    "resources/app/runtime-cache",
  ]) {
    if (existsSync(resolve(root, directory))) {
      throw new Error(`Windows 安装包包含本地业务数据目录：${directory}`);
    }
  }
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const packagedPath = relative(root, path);
      if (entry.isDirectory()) {
        if (/^(?:backups|migration-rollback(?:-|$))/.test(entry.name)) {
          throw new Error(`Windows 安装包包含备份或回滚数据：${packagedPath}`);
        }
        walk(path);
      } else if (
        forbiddenNames.has(entry.name) ||
        forbiddenDatabase.test(entry.name)
      ) {
        throw new Error(`Windows 安装包包含本地业务数据文件：${packagedPath}`);
      }
    }
  };
  walk(root);
}

function copyApplicationSources() {
  cpSync(resolve(projectRoot, "dist"), resolve(packagedApp, "dist"), {
    recursive: true,
  });
  for (const privateAsset of ["generated", "trend-covers"]) {
    const target = resolve(packagedApp, "dist/client", privateAsset);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(resolve(packagedApp, "runtime"), { recursive: true });
  copyFileSync(
    resolve(projectRoot, "runtime/manager.mjs"),
    resolve(packagedApp, "runtime/manager.mjs"),
  );
  cpSync(
    resolve(projectRoot, "runtime/prompts"),
    resolve(packagedApp, "runtime/prompts"),
    { recursive: true },
  );
  cpSync(
    resolve(projectRoot, "runtime/platforms"),
    resolve(packagedApp, "runtime/platforms"),
    { recursive: true },
  );
  for (const schema of [
    "trend-plan.schema.json",
    "candidate-screen.schema.json",
    "topic-analysis.schema.json",
    "content-draft.schema.json",
    "zhihu-article-draft.schema.json",
    "wechat-cover-prompt.schema.json",
  ]) {
    copyFileSync(
      resolve(projectRoot, "runtime", schema),
      resolve(packagedApp, "runtime", schema),
    );
  }
  mkdirSync(resolve(packagedApp, "runtime/bin"), { recursive: true });
  for (const filename of [
    "xiaohongshu-mcp-windows-amd64.exe",
    "LICENSE.xiaohongshu-mcp-Apache-2.0.txt",
  ]) {
    const source = resolve(projectRoot, "runtime/bin", filename);
    if (!existsSync(source)) throw new Error(`Windows 运行依赖缺失：${filename}`);
    copyFileSync(source, resolve(packagedApp, "runtime/bin", filename));
  }
  mkdirSync(resolve(packagedApp, "scripts"), { recursive: true });
  for (const script of [
    "app-service.mjs",
    "backup-local.mjs",
    "restore-local.mjs",
  ]) {
    copyFileSync(
      resolve(projectRoot, "scripts", script),
      resolve(packagedApp, "scripts", script),
    );
  }
  for (const document of ["README.md", "THIRD_PARTY_NOTICES.md"]) {
    copyFileSync(resolve(projectRoot, document), resolve(packagedApp, document));
  }
  cpSync(resolve(projectRoot, "docs"), resolve(packagedApp, "docs"), {
    recursive: true,
  });
}

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows 安装包必须在 Windows x64 环境构建");
}

run("npm.cmd", ["run", "build"]);
run("npm.cmd", ["run", "prepare:runtime"]);

mkdirSync(outputRoot, { recursive: true });
mkdirSync(archiveRoot, { recursive: true });
const currentReleaseNames = new Set([
  basename(zipPath),
  basename(`${zipPath}.sha256`),
]);
for (const entry of readdirSync(outputRoot)) {
  if (
    !/^多平台内容运营-.+-windows-x64-portable\.zip(?:\.sha256)?$/.test(entry) ||
    currentReleaseNames.has(entry)
  ) {
    continue;
  }
  const destination = resolve(archiveRoot, entry);
  renameSync(
    resolve(outputRoot, entry),
    existsSync(destination) ? `${destination}.${Date.now()}` : destination,
  );
}
for (const target of [packageRoot, zipPath, `${zipPath}.sha256`]) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
mkdirSync(packagedApp, { recursive: true });
mkdirSync(packagedRuntime, { recursive: true });
copyApplicationSources();

const chromiumExecutable = chromium.executablePath();
if (!existsSync(chromiumExecutable)) {
  throw new Error(
    "缺少 Playwright Chromium，请先运行 npx playwright-core install chromium",
  );
}
cpSync(
  dirname(chromiumExecutable),
  resolve(packagedApp, "runtime/bin/chromium"),
  { recursive: true },
);

const runtimePackage = {
  name: "multi-platform-operations-runtime",
  version,
  private: true,
  type: "module",
  dependencies: {
    wrangler: "4.132.0",
    "playwright-core": "1.55.0",
    marked: "18.0.13",
    "sanitize-html": "2.17.7",
  },
};
writeFileSync(
  resolve(packagedApp, "package.json"),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
);
run(
  "npm.cmd",
  ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: packagedApp },
);

copyFileSync(process.execPath, resolve(packagedRuntime, "node.exe"));
const nodeLicense = [
  resolve(dirname(process.execPath), "LICENSE"),
  resolve(dirname(process.execPath), "..", "LICENSE"),
].find(existsSync);
if (!nodeLicense) throw new Error("找不到 Node.js LICENSE，拒绝生成分发包");
copyFileSync(nodeLicense, resolve(packagedRuntime, "LICENSE.Node.txt"));
writeFileSync(
  resolve(packagedRuntime, "NODE_VERSION.txt"),
  `${process.version} / ${process.arch}\n`,
);

const launcherOutput = resolve(packageRoot, ".launcher");
run("dotnet", [
  "publish",
  resolve(projectRoot, "packaging/windows/Launcher.csproj"),
  "--configuration",
  "Release",
  "--runtime",
  "win-x64",
  "--self-contained",
  "true",
  "--output",
  launcherOutput,
  "-p:PublishSingleFile=false",
  "-p:DebugType=None",
  "-p:DebugSymbols=false",
]);
for (const entry of readdirSync(launcherOutput)) {
  cpSync(resolve(launcherOutput, entry), resolve(packageRoot, entry), {
    recursive: true,
  });
}
rmSync(launcherOutput, { recursive: true, force: true });

const nugetRoot = process.env.NUGET_PACKAGES ||
  resolve(process.env.USERPROFILE || "", ".nuget/packages");
const webViewLicenseRoot = resolve(
  nugetRoot,
  "microsoft.web.webview2/1.0.4191.47",
);
mkdirSync(resolve(packageRoot, "licenses"), { recursive: true });
for (const filename of ["LICENSE.txt", "NOTICE.txt"]) {
  const source = resolve(webViewLicenseRoot, filename);
  if (!existsSync(source)) {
    throw new Error(`找不到 WebView2 ${filename}，拒绝生成分发包`);
  }
  copyFileSync(
    source,
    resolve(packageRoot, "licenses", `WebView2-${filename}`),
  );
}

writeFileSync(
  resolve(packageRoot, "安装说明.txt"),
  [
    "多平台内容运营 Windows x64 便携版",
    "",
    "1. 请先完整解压 ZIP，不要直接在压缩包内运行。",
    "2. 双击“多平台内容运营.exe”。首次启动选择独立使用、创建团队主机或加入已有团队。",
    "3. 程序关闭窗口后仍会驻留系统托盘；请从托盘菜单选择“退出多平台内容运营”以完全停止。",
    "4. 创建团队主机时，如 Windows 防火墙询问，请仅允许专用网络，不要允许公共网络。",
    "5. 数据保存在 %LOCALAPPDATA%\\多平台内容运营，不会写入安装目录。",
    "",
    "此便携版尚未使用 Windows 代码签名。SmartScreen 可能显示“未知发布者”，请只从项目官方 GitHub Release 下载并核对 SHA-256。",
    "运行界面依赖 Microsoft Edge WebView2 Runtime；Windows 11 通常已预装。",
  ].join("\r\n"),
);

assertNoCustomerData(packageRoot);
run("powershell.exe", [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1] -CompressionLevel Optimal -Force",
  packageRoot,
  zipPath,
]);

const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
writeFileSync(`${zipPath}.sha256`, `${hash}  ${basename(zipPath)}\n`);
process.stdout.write(`Windows x64 便携版已生成：\n${zipPath}\nSHA-256：${hash}\n`);
