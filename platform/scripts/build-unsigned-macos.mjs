import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { chromium } from "playwright-core";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "outputs");
const archiveRoot = resolve(outputRoot, "archive");
const appBundle = resolve(outputRoot, "红薯台.app");
const contents = resolve(appBundle, "Contents");
const resources = resolve(contents, "Resources");
const packagedApp = resolve(resources, "app");
const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;
const dmgPath = resolve(outputRoot, `红薯台-${version}-macOS-arm64-unsigned.dmg`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status ?? "unknown"}）`);
}

function assertPortableSymlinks(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (isAbsolute(target)) throw new Error(`安装包包含绝对符号链接：${path} -> ${target}`);
      if (!existsSync(resolve(dirname(path), target))) throw new Error(`安装包包含失效符号链接：${path} -> ${target}`);
    } else if (entry.isDirectory()) {
      assertPortableSymlinks(path);
    }
  }
}

function makeCopiedSymlinksPortable(root, originalRoot, copiedRoot = root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (!isAbsolute(target)) continue;
      const originalRelativeTarget = relative(originalRoot, target);
      if (originalRelativeTarget.startsWith("..")) throw new Error(`Chromium 包含指向包外的绝对符号链接：${path} -> ${target}`);
      const copiedTarget = resolve(copiedRoot, originalRelativeTarget);
      const portableTarget = relative(dirname(path), copiedTarget);
      unlinkSync(path);
      symlinkSync(portableTarget, path);
    } else if (entry.isDirectory()) {
      makeCopiedSymlinksPortable(path, originalRoot, copiedRoot);
    }
  }
}

function assertNoCustomerData(root) {
  const forbiddenDirectories = [
    "Contents/Resources/app/.wrangler",
    "Contents/Resources/app/backups",
    "Contents/Resources/app/runtime/accounts",
    "Contents/Resources/app/runtime/platform-accounts",
    "Contents/Resources/app/runtime/analysis",
    "Contents/Resources/app/runtime/config",
    "Contents/Resources/app/runtime/generated",
    "Contents/Resources/app/runtime/publish-assets",
    "Contents/Resources/app/runtime/trend-covers",
    "Contents/Resources/app/runtime-cache",
  ];
  for (const path of forbiddenDirectories) {
    if (existsSync(resolve(root, path))) throw new Error(`安装包包含本地业务数据目录：${path}`);
  }
  const forbiddenNames = new Set([".env", "ai.json", "cookies.json", "team-config.json"]);
  const forbiddenDatabase = /\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const packagedPath = relative(root, path);
      if (entry.isDirectory()) {
        if (/^(?:backups|migration-rollback(?:-|$))/.test(entry.name)) throw new Error(`安装包包含备份或回滚数据：${packagedPath}`);
        walk(path);
      } else if (forbiddenNames.has(entry.name) || forbiddenDatabase.test(entry.name)) {
        throw new Error(`安装包包含本地业务数据文件：${packagedPath}`);
      }
    }
  };
  walk(root);
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("未签名安装包目前只能在 Apple Silicon Mac 上构建");
}

run("npm", ["run", "build"]);
run("npm", ["run", "prepare:runtime"]);

mkdirSync(outputRoot, { recursive: true });
mkdirSync(archiveRoot, { recursive: true });
const currentReleaseNames = new Set([basename(dmgPath), basename(`${dmgPath}.sha256`)]);
for (const entry of readdirSync(outputRoot)) {
  if (!/^红薯台-.+-macOS-arm64-unsigned\.dmg(?:\.sha256)?$/.test(entry) || currentReleaseNames.has(entry)) continue;
  const destination = resolve(archiveRoot, entry);
  const safeDestination = existsSync(destination) ? `${destination}.${Date.now()}` : destination;
  renameSync(resolve(outputRoot, entry), safeDestination);
  process.stdout.write(`旧版本已归档：${safeDestination}\n`);
}
for (const target of [appBundle, dmgPath, `${dmgPath}.sha256`]) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
mkdirSync(resolve(contents, "MacOS"), { recursive: true });
mkdirSync(packagedApp, { recursive: true });
mkdirSync(resolve(resources, "runtime"), { recursive: true });

cpSync(resolve(projectRoot, "dist"), resolve(packagedApp, "dist"), { recursive: true });
for (const privateAsset of ["generated", "trend-covers"]) {
  const target = resolve(packagedApp, "dist/client", privateAsset);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

mkdirSync(resolve(packagedApp, "runtime"), { recursive: true });
copyFileSync(resolve(projectRoot, "runtime/manager.mjs"), resolve(packagedApp, "runtime/manager.mjs"));
cpSync(resolve(projectRoot, "runtime/prompts"), resolve(packagedApp, "runtime/prompts"), { recursive: true });
cpSync(resolve(projectRoot, "runtime/platforms"), resolve(packagedApp, "runtime/platforms"), { recursive: true });
for (const schema of ["trend-plan.schema.json", "candidate-screen.schema.json", "topic-analysis.schema.json", "content-draft.schema.json", "zhihu-article-draft.schema.json"]) {
  copyFileSync(resolve(projectRoot, "runtime", schema), resolve(packagedApp, "runtime", schema));
}
cpSync(resolve(projectRoot, "runtime/bin"), resolve(packagedApp, "runtime/bin"), { recursive: true });
const chromiumExecutable = chromium.executablePath();
if (!existsSync(chromiumExecutable)) throw new Error("缺少 Playwright Chromium，请先运行 npx playwright-core install chromium");
const chromiumBundle = resolve(chromiumExecutable, "../../..");
const packagedChromium = resolve(packagedApp, "runtime/bin/chromium/Chromium.app");
cpSync(chromiumBundle, packagedChromium, { recursive: true });
makeCopiedSymlinksPortable(packagedChromium, chromiumBundle);
mkdirSync(resolve(packagedApp, "scripts"), { recursive: true });
for (const script of ["app-service.mjs", "backup-local.mjs", "restore-local.mjs"]) {
  copyFileSync(resolve(projectRoot, "scripts", script), resolve(packagedApp, "scripts", script));
}
for (const document of ["README.md", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(resolve(projectRoot, document), resolve(packagedApp, document));
}
cpSync(resolve(projectRoot, "docs"), resolve(packagedApp, "docs"), { recursive: true });

const runtimePackage = {
  name: "hongshutai-app-runtime",
  version,
  private: true,
  type: "module",
  dependencies: { wrangler: "4.92.0", "playwright-core": "1.55.0" },
};
writeFileSync(resolve(packagedApp, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: packagedApp });

const nodeBinary = process.execPath;
const nodeRoot = resolve(dirname(nodeBinary), "..");
copyFileSync(nodeBinary, resolve(resources, "runtime/node"));
chmodSync(resolve(resources, "runtime/node"), 0o755);
copyFileSync(resolve(nodeRoot, "LICENSE"), resolve(resources, "runtime/LICENSE.Node.txt"));
writeFileSync(resolve(resources, "runtime/NODE_VERSION.txt"), `${process.version} / ${process.arch}\n`);

const plistPath = resolve(contents, "Info.plist");
const bundleBuildVersion = String(Number(version.split(".").join("")));
const plist = readFileSync(resolve(projectRoot, "packaging/Info.plist"), "utf8")
  .replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+/, `$1${version}`)
  .replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]+/, `$1${bundleBuildVersion}`);
writeFileSync(plistPath, plist);
writeFileSync(resolve(contents, "PkgInfo"), "APPL????");
run("/usr/bin/clang", [
  "-O2", "-fobjc-arc", "-mmacosx-version-min=13.0",
  "-framework", "Cocoa", "-framework", "Foundation", "-framework", "WebKit",
  resolve(projectRoot, "packaging/HongShuTaiLauncher.m"),
  "-o", resolve(contents, "MacOS/HongShuTai"),
]);

const iconWork = mkdtempSync(resolve(tmpdir(), "hongshutai-icon-"));
try {
  const sourceSvg = readFileSync(resolve(projectRoot, "public/favicon.svg"), "utf8")
    .replace('width="24" height="24"', 'width="1024" height="1024"');
  const largeSvg = resolve(iconWork, "icon.svg");
  const largePng = resolve(iconWork, "icon.png");
  const iconset = resolve(iconWork, "AppIcon.iconset");
  writeFileSync(largeSvg, sourceSvg);
  mkdirSync(iconset);
  run("/usr/bin/sips", ["-s", "format", "png", largeSvg, "--out", largePng]);
  for (const [name, size] of [["icon_16x16.png", 16], ["icon_16x16@2x.png", 32], ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64], ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256], ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512], ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024]]) {
    run("/usr/bin/sips", ["-z", String(size), String(size), largePng, "--out", resolve(iconset, name)]);
  }
  run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", resolve(resources, "AppIcon.icns")]);
} finally {
  rmSync(iconWork, { recursive: true, force: true });
}

// Ad-hoc sealing does not use an Apple Developer identity. It binds the complete
// bundle so Gatekeeper does not misclassify a structurally invalid app as damaged.
assertPortableSymlinks(appBundle);
assertNoCustomerData(appBundle);
run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appBundle]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);

const dmgStage = mkdtempSync(resolve(tmpdir(), "hongshutai-dmg-"));
try {
  const stagedApp = resolve(dmgStage, basename(appBundle));
  cpSync(appBundle, stagedApp, { recursive: true, verbatimSymlinks: true });
  assertPortableSymlinks(stagedApp);
  assertNoCustomerData(stagedApp);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", stagedApp]);
  symlinkSync("/Applications", resolve(dmgStage, "Applications"));
  writeFileSync(resolve(dmgStage, "安装说明.txt"), [
    "红薯台 Local 未签名测试版",
    "",
    "1. 将“红薯台.app”拖入 Applications（应用程序）。",
    "2. 首次启动请右键“红薯台.app”并选择“打开”，再确认打开。",
    "3. 首次启动先选择“独立使用”“创建团队主机”或“加入已有团队”。",
    "4. 菜单栏的 🍠 图标可以重新打开平台、查看数据目录或退出平台。",
    "5. 多人协作请在菜单栏选择“局域网团队设置…”，由一台 Mac 作为主机，其他 Mac 填写主机地址和团队连接码。",
    "",
    "本应用未使用 Apple Developer ID 签名或公证。不要关闭 Gatekeeper，也不要执行陌生终端命令。",
    "买家的数据库、Cookie、AI Key 和素材保存在 ~/Library/Application Support/红薯台。",
  ].join("\n"));
  run("/usr/bin/hdiutil", ["create", "-volname", "红薯台", "-srcfolder", dmgStage, "-ov", "-format", "UDZO", dmgPath]);
} finally {
  rmSync(dmgStage, { recursive: true, force: true });
}

const verifyMount = mkdtempSync(resolve(tmpdir(), "hongshutai-dmg-verify-"));
let mounted = false;
try {
  run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", verifyMount, dmgPath]);
  mounted = true;
  const mountedApp = resolve(verifyMount, basename(appBundle));
  assertPortableSymlinks(mountedApp);
  assertNoCustomerData(mountedApp);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedApp]);
} finally {
  if (mounted) run("/usr/bin/hdiutil", ["detach", verifyMount]);
  rmSync(verifyMount, { recursive: true, force: true });
}

const hash = createHash("sha256").update(readFileSync(dmgPath)).digest("hex");
writeFileSync(`${dmgPath}.sha256`, `${hash}  ${basename(dmgPath)}\n`);
process.stdout.write(`未签名安装包已生成：\n${dmgPath}\nSHA-256：${hash}\n`);
