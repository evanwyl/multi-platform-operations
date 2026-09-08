import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path) {
  return readFile(resolve(projectRoot, path), "utf8");
}

test("enforces server-side role boundaries for mutations", async () => {
  const permissions = await source("lib/permissions.ts");
  const creation = await source("app/api/creation/route.ts");
  const trends = await source("app/api/trends/route.ts");
  const app = await source("app/api/app/route.ts");
  assert.match(permissions, /operate: \["admin", "operator"\]/);
  assert.match(permissions, /review: \["admin", "reviewer"\]/);
  assert.match(permissions, /publish: \["admin", "publisher"\]/);
  assert.match(creation, /can\(user, roleGroups\.operate\)/);
  assert.match(trends, /action !== "save_settings" && !can\(user, roleGroups\.operate\)/);
  for (const action of ["create_topic", "archive_topics_bulk", "claim_topic", "save_draft", "submit_review"]) {
    const block = app.slice(app.indexOf(`action === "${action}"`));
    assert.match(block.slice(0, 300), /can\(user, roleGroups\.operate\)/, `${action} must require operator permissions`);
  }
});

test("claims a publish job atomically before calling the browser", async () => {
  const publish = await source("app/api/publish/route.ts");
  const claimIndex = publish.indexOf("WHERE id=? AND status IN ('approved','queued','failed')");
  const callIndex = publish.indexOf('callMcpTool(port, "publish_content"');
  assert.ok(claimIndex > 0 && callIndex > claimIndex);
  assert.match(publish, /if \(!claimResult\.meta\.changes\)/);
  assert.match(publish, /status: 409/);
  assert.match(publish, /resolve_interrupted/);
  assert.match(publish, /超过8分钟仍处于发布中/);
  assert.match(publish, /status='publishing' AND updated_at=\?/);
});

test("protects the local manager and repairs cookie permissions", async (context) => {
  const work = await mkdtemp(resolve(tmpdir(), "hongshutai-manager-test-"));
  const accountRoot = resolve(work, "runtime/accounts/test-account");
  await mkdir(accountRoot, { recursive: true });
  const cookies = resolve(accountRoot, "cookies.json");
  await writeFile(cookies, "{}\n");
  await chmod(cookies, 0o644);
  const port = 22000 + (process.pid % 1000);
  const token = "test-token-".padEnd(64, "x");
  const child = spawn(process.execPath, [resolve(projectRoot, "runtime/manager.mjs")], {
    cwd: work,
    env: {
      ...process.env,
      MANAGER_PORT: String(port),
      RUNTIME_MANAGER_TOKEN: token,
      XHS_MCP_BINARY: "/usr/bin/true",
      HONGSHUTAI_APP_ROOT: projectRoot,
      HONGSHUTAI_DATA_ROOT: work,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(work, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) { ready = true; break; }
    } catch { void 0; }
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.equal(ready, true, "manager did not become ready");
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(unauthorized.status, 401);
  const authorized = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(authorized.status, 200);
  assert.equal((await stat(cookies)).mode & 0o777, 0o600);
  assert.equal((await stat(resolve(work, "runtime/accounts"))).mode & 0o777, 0o700);
  const coverName = "testfeed123.jpg";
  const coverPath = resolve(work, "runtime/trend-covers", coverName);
  await writeFile(coverPath, "image-bytes");
  const key = createHmac("sha256", token).update(`trend-cover:${coverName}`).digest("hex");
  const cover = await fetch(`http://127.0.0.1:${port}/trend-covers/${coverName}?key=${key}`);
  assert.equal(cover.status, 200);
  assert.equal(await cover.text(), "image-bytes");
  const rejectedCover = await fetch(`http://127.0.0.1:${port}/trend-covers/${coverName}?key=wrong`);
  assert.equal(rejectedCover.status, 404);
});

test("backs up and restores local customer data without unsafe archive paths", async (context) => {
  const work = await mkdtemp(resolve(tmpdir(), "hongshutai-backup-test-"));
  context.after(() => rm(work, { recursive: true, force: true }));
  const database = resolve(work, ".wrangler/state/v3/d1/data.sqlite");
  const account = resolve(work, "runtime/accounts/account-1/cookies.json");
  await mkdir(dirname(database), { recursive: true });
  await mkdir(dirname(account), { recursive: true });
  await writeFile(resolve(work, "package.json"), '{"version":"0.1.0"}\n');
  await writeFile(database, "database-v1");
  await writeFile(account, "cookie-v1");
  const archive = resolve(work, "safe-backup.tar.gz");
  const environment = { ...process.env, HONGSHUTAI_APP_ROOT: work, HONGSHUTAI_DATA_ROOT: work };
  const backup = spawnSync(process.execPath, [resolve(projectRoot, "scripts/backup-local.mjs"), archive], { env: environment, encoding: "utf8" });
  assert.equal(backup.status, 0, backup.stderr);
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0);
  assert.equal(listing.stdout.split("\n").filter(Boolean).some((entry) => entry.startsWith("/") || entry.split("/").includes("..")), false);
  await writeFile(database, "database-v2");
  await writeFile(account, "cookie-v2");
  const restore = spawnSync(process.execPath, [resolve(projectRoot, "scripts/restore-local.mjs"), archive, "--confirm"], { env: environment, encoding: "utf8" });
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal(await readFile(database, "utf8"), "database-v1");
  assert.equal(await readFile(account, "utf8"), "cookie-v1");
});

test("packages a self-contained unsigned macOS app without customer data", async () => {
  const service = await source("scripts/app-service.mjs");
  const packager = await source("scripts/build-unsigned-macos.mjs");
  const launcher = await source("packaging/HongShuTaiLauncher.m");
  const infoPlist = await source("packaging/Info.plist");
  const auth = await source("lib/auth.ts");
  const authRoute = await source("app/api/auth/route.ts");
  assert.match(service, /runtime-cache/);
  assert.match(service, /process\.execPath/);
  assert.match(service, /HONGSHUTAI_DATA_ROOT/);
  assert.match(packager, /privateAsset of \["generated", "trend-covers"\]/);
  assert.match(packager, /旧版本已归档/);
  assert.match(packager, /renameSync\(resolve\(outputRoot, entry\), safeDestination\)/);
  assert.match(packager, /verbatimSymlinks: true/);
  assert.match(packager, /assertPortableSymlinks\(mountedApp\)/);
  assert.match(packager, /assertNoCustomerData\(mountedApp\)/);
  for (const forbidden of ["team-config.json", "cookies.json", "ai.json", "runtime/accounts", "runtime/publish-assets"]) {
    assert.match(packager, new RegExp(forbidden.replace("/", "\\/")));
  }
  assert.match(packager, /codesign.*--verify.*--deep.*--strict/s);
  assert.match(service, /verbatimSymlinks: true/);
  assert.match(packager, /runtime\/node/);
  assert.match(packager, /macOS-arm64-unsigned\.dmg/);
  assert.match(launcher, /ApplicationSupportDirectory/);
  assert.match(launcher, /WKWebView/);
  assert.match(launcher, /NSApplicationActivationPolicyRegular/);
  assert.match(launcher, /loadRequest:\[NSURLRequest requestWithURL:platformURL\]/);
  assert.match(launcher, /applicationShouldHandleReopen/);
  assert.match(launcher, /局域网团队设置/);
  assert.match(launcher, /configureTeamMode:\) keyEquivalent:@","/);
  assert.match(launcher, /team-config\.json/);
  assert.match(launcher, /teamMode isEqualToString:@"member"/);
  assert.match(launcher, /runFirstLaunchSetup/);
  assert.match(launcher, /作出选择前不会启动任何本地后台服务/);
  assert.match(launcher, /独立使用/);
  assert.match(launcher, /创建团队主机/);
  assert.match(launcher, /加入已有团队/);
  assert.match(launcher, /这台 Mac 不会启动数据库、运行管理器或小红书 MCP/);
  assert.ok(launcher.indexOf("runFirstLaunchSetup") < launcher.indexOf("seedDeviceCookieWithCompletion"));
  assert.match(infoPlist, /NSLocalNetworkUsageDescription/);
  assert.match(infoPlist, /_hongshutai\._tcp/);
  assert.match(infoPlist, /NSAllowsLocalNetworking/);
  assert.match(launcher, /showLocalNetworkPrimerIfNeeded/);
  assert.match(launcher, /如果 macOS 询问是否允许访问本地网络，请选择“允许”/);
  assert.match(launcher, /打开本地网络权限设置/);
  assert.match(launcher, /Privacy_LocalNetwork/);
  assert.match(launcher, /action:@selector\(copy:\) keyEquivalent:@"c"/);
  assert.match(launcher, /action:@selector\(paste:\) keyEquivalent:@"v"/);
  assert.match(launcher, /teamHostURL/);
  assert.match(launcher, /复制连接信息/);
  assert.match(service, /teamMode === "host" \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  assert.match(auth, /TEAM_ACCESS_TOKEN/);
  assert.match(authRoute, /pairingRequired: true/);
  assert.match(launcher, /退出红薯台/);
});
