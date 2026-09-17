import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  assert.match(
    trends,
    /action !== "save_settings" && !can\(user, roleGroups\.operate\)/,
  );
  for (const action of [
    "create_topic",
    "archive_topics_bulk",
    "claim_topic",
    "save_draft",
    "upload_review_images",
    "submit_review",
  ]) {
    const block = app.slice(app.indexOf(`action === "${action}"`));
    assert.match(
      block.slice(0, 300),
      /can\(user, roleGroups\.operate\)/,
      `${action} must require operator permissions`,
    );
  }
});

test("freezes final images with copy before review and prevents publish-time replacement", async () => {
  const app = await source("app/api/app/route.ts");
  const publish = await source("app/api/publish/route.ts");
  const manager = await source("runtime/manager.mjs");
  assert.match(app, /action === "upload_review_images"/);
  assert.match(app, /status IN \('writing','revision'\)/);
  assert.match(app, /请先上传至少一张最终图片，再提交图文审核/);
  assert.match(app, /images: reviewImages/);
  assert.match(app, /缺少最终图片，不能通过图文审核/);
  assert.doesNotMatch(publish, /action === "upload_images"/);
  assert.match(publish, /Array\.isArray\(frozen\?\.images\)/);
  assert.match(publish, /审核快照中没有图片/);
  assert.match(manager, /url\.pathname === "\/publish-asset"/);
});

test("claims a publish job atomically before calling the browser", async () => {
  const publish = await source("app/api/publish/route.ts");
  const claimIndex = publish.indexOf(
    "WHERE id=? AND status IN ('approved','queued','failed')",
  );
  const callIndex = publish.indexOf("const result = await callMcpTool(");
  assert.ok(claimIndex > 0 && callIndex > claimIndex);
  assert.match(publish, /if \(!claimResult\.meta\.changes\)/);
  assert.match(publish, /status: 409/);
  assert.match(publish, /resolve_interrupted/);
  assert.match(publish, /超过8分钟仍处于发布中/);
  assert.match(publish, /status='publishing' AND updated_at=\?/);
});

test("records publish jobs, attempts, and uncertain delivery outcomes", async () => {
  const database = await source("lib/database.ts");
  const publish = await source("app/api/publish/route.ts");
  assert.match(database, /CREATE TABLE IF NOT EXISTS publish_jobs/);
  assert.match(database, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS publish_attempts/);
  assert.match(database, /idx_publish_attempts_job_number/);
  assert.match(publish, /INSERT INTO publish_jobs/);
  assert.match(publish, /INSERT INTO publish_attempts/);
  assert.match(
    publish,
    /publishDispatched && isUncertainPublishError\(message\)/,
  );
  assert.match(publish, /uncertain \? "publishing" : "failed"/);
  assert.match(publish, /发布结果待核验/);
  assert.match(
    publish,
    /UPDATE publish_jobs SET status=\?,last_error=\?,updated_at=\?,completed_at=\?/,
  );
  assert.match(
    publish,
    /UPDATE publish_attempts SET status=\?,error=\?,completed_at=\?/,
  );
});

test("enforces one active claim per topic and account at the database boundary", async () => {
  const database = await source("lib/database.ts");
  const app = await source("app/api/app/route.ts");
  assert.match(
    database,
    /ROW_NUMBER\(\) OVER \(\s*PARTITION BY topic_id,account_id/s,
  );
  assert.match(database, /WHERE duplicate_rank>1/);
  assert.match(
    database,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_active_topic_account\s+ON claims\(topic_id,account_id\) WHERE status NOT IN \('published','drafted','archived'\)/s,
  );
  const claimBlock = app.slice(
    app.indexOf('action === "claim_topic"'),
    app.indexOf('action === "save_draft"'),
  );
  assert.match(claimBlock, /try \{\s*await db\.batch/s);
  assert.match(claimBlock, /const competingClaim = await db\s*\.prepare/);
  assert.match(claimBlock, /刚刚已被这个账号认领，请刷新列表/);
  assert.match(claimBlock, /status: 409/);
});

test("isolates team members by account and checks stable Xiaohongshu identity before publishing", async () => {
  const database = await source("lib/database.ts");
  const app = await source("app/api/app/route.ts");
  const creation = await source("app/api/creation/route.ts");
  const publish = await source("app/api/publish/route.ts");
  assert.match(database, /CREATE TABLE IF NOT EXISTS user_account_access/);
  assert.match(app, /set_user_accounts/);
  assert.match(app, /canAccessAccount\(db, user, account\.id\)/);
  assert.match(creation, /canAccessAccount\(database\(\), user, claim\.account_id\)/);
  assert.match(publish, /canAccessAccount\(db, user, claim\.account_id\)/);
  assert.match(publish, /const identity = await readMcpIdentity\(port\)/);
  assert.match(publish, /identity\.userId !== claim\.xhs_user_id/);
});

test("distinguishes a WeChat draft from a real publication", async () => {
  const app = await source("app/api/app/route.ts");
  const publish = await source("app/api/publish/route.ts");
  assert.match(app, /drafted: "已入公众号草稿箱"/);
  assert.match(publish, /const completedStatus = isWechatArticle \? "drafted" : "published"/);
  assert.match(publish, /const recordedPublishedAt = isWechatArticle \? null : publishedAt/);
});

test("hardens article fetching and login throttling against untrusted network input", async () => {
  const article = await source("app/api/article-research/route.ts");
  const auth = await source("app/api/auth/route.ts");
  const vite = await source("vite.config.ts");
  assert.match(article, /redirect: "manual"/);
  assert.match(article, /host\.includes\(":"\)/);
  assert.match(article, /url\.username \|\| url\.password/);
  assert.match(vite, /global_fetch_strictly_public/);
  assert.match(auth, /HONGSHUTAI_TRUST_PROXY_HEADERS === "1"/);
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
  const child = spawn(
    process.execPath,
    [resolve(projectRoot, "runtime/manager.mjs")],
    {
      cwd: work,
      env: {
        ...process.env,
        MANAGER_PORT: String(port),
        RUNTIME_MANAGER_TOKEN: token,
        XHS_MCP_BINARY: process.execPath,
        HONGSHUTAI_APP_ROOT: projectRoot,
        HONGSHUTAI_DATA_ROOT: work,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(work, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      void 0;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.equal(ready, true, "manager did not become ready");
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(unauthorized.status, 401);
  const authorized = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authorized.status, 200);
  if (process.platform !== "win32") {
    assert.equal((await stat(cookies)).mode & 0o777, 0o600);
    assert.equal(
      (await stat(resolve(work, "runtime/accounts"))).mode & 0o777,
      0o700,
    );
  }
  const coverName = "testfeed123.jpg";
  const coverPath = resolve(work, "runtime/trend-covers", coverName);
  await writeFile(coverPath, "image-bytes");
  const key = createHmac("sha256", token)
    .update(`trend-cover:${coverName}`)
    .digest("hex");
  const cover = await fetch(
    `http://127.0.0.1:${port}/trend-covers/${coverName}?key=${key}`,
  );
  assert.equal(cover.status, 200);
  assert.equal(await cover.text(), "image-bytes");
  const rejectedCover = await fetch(
    `http://127.0.0.1:${port}/trend-covers/${coverName}?key=wrong`,
  );
  assert.equal(rejectedCover.status, 404);
  const zhihuSave = await fetch(`http://127.0.0.1:${port}/zhihu/credentials`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      accountId: "zhihu-account-123",
      appKey: "example-token",
      appSecret: "s".repeat(32),
    }),
  });
  assert.equal(zhihuSave.status, 200);
  const zhihuStatus = await fetch(
    `http://127.0.0.1:${port}/zhihu/auth-status?accountId=zhihu-account-123`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.deepEqual(await zhihuStatus.json(), {
    configured: true,
    auth_method: "openapi",
  });
  if (process.platform !== "win32") {
    assert.equal(
      (
        await stat(
          resolve(
            work,
            "runtime/platform-accounts/zhihu-account-123/openapi.json",
          ),
        )
      ).mode & 0o777,
      0o600,
    );
  }
});

test("implements the native macOS file chooser for review image uploads", async () => {
  const launcher = await source("packaging/HongShuTaiLauncher.m");
  assert.match(launcher, /runOpenPanelWithParameters/);
  assert.match(launcher, /NSOpenPanel \*panel/);
  assert.match(launcher, /parameters\.allowsMultipleSelection/);
  assert.match(launcher, /@"jpg", @"jpeg", @"png", @"webp"/);
  assert.match(
    launcher,
    /completionHandler\(result == NSModalResponseOK \? panel\.URLs : nil\)/,
  );
});

test("implements native JavaScript dialogs required by publish and recovery actions", async () => {
  const launcher = await source("packaging/HongShuTaiLauncher.m");
  assert.match(launcher, /runJavaScriptAlertPanelWithMessage/);
  assert.match(launcher, /runJavaScriptConfirmPanelWithMessage/);
  assert.match(
    launcher,
    /completionHandler\(result == NSAlertFirstButtonReturn\)/,
  );
  assert.match(launcher, /runJavaScriptTextInputPanelWithPrompt/);
  assert.match(launcher, /field\.stringValue = defaultText/);
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
  const environment = {
    ...process.env,
    HONGSHUTAI_APP_ROOT: work,
    HONGSHUTAI_DATA_ROOT: work,
    HONGSHUTAI_BACKUP_MANAGER_PORT: "29181",
    HONGSHUTAI_BACKUP_WORKER_PORT: "29300",
  };
  const backup = spawnSync(
    process.execPath,
    [resolve(projectRoot, "scripts/backup-local.mjs"), archive],
    { env: environment, encoding: "utf8" },
  );
  assert.equal(backup.status, 0, backup.stderr);
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0);
  assert.equal(
    listing.stdout
      .split("\n")
      .filter(Boolean)
      .some(
        (entry) => {
          const normalized = entry.replaceAll("\\", "/");
          return (
            normalized.startsWith("/") ||
            /^[a-zA-Z]:\//.test(normalized) ||
            normalized.split("/").includes("..")
          );
        },
      ),
    false,
  );
  await writeFile(database, "database-v2");
  await writeFile(account, "cookie-v2");
  const restore = spawnSync(
    process.execPath,
    [resolve(projectRoot, "scripts/restore-local.mjs"), archive, "--confirm"],
    { env: environment, encoding: "utf8" },
  );
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
  assert.match(packager, /CFBundleShortVersionString/);
  assert.match(packager, /bundleBuildVersion/);
  assert.match(
    packager,
    /renameSync\(resolve\(outputRoot, entry\), safeDestination\)/,
  );
  assert.match(packager, /verbatimSymlinks: true/);
  assert.match(packager, /assertPortableSymlinks\(mountedApp\)/);
  assert.match(packager, /assertNoCustomerData\(mountedApp\)/);
  for (const forbidden of [
    "team-config.json",
    "cookies.json",
    "ai.json",
    "runtime/accounts",
    "runtime/platform-accounts",
    "runtime/publish-assets",
  ]) {
    assert.match(packager, new RegExp(forbidden.replace("/", "\\/")));
  }
  assert.match(packager, /codesign.*--verify.*--deep.*--strict/s);
  assert.match(service, /verbatimSymlinks: true/);
  assert.match(packager, /runtime\/node/);
  assert.match(packager, /macOS-arm64-unsigned\.dmg/);
  assert.match(packager, /多平台内容运营\.app/);
  assert.match(infoPlist, /<string>多平台内容运营<\/string>/);
  assert.match(launcher, /ApplicationSupportDirectory/);
  assert.match(launcher, /WKWebView/);
  assert.match(launcher, /NSApplicationActivationPolicyRegular/);
  assert.match(
    launcher,
    /loadRequest:\[NSURLRequest requestWithURL:platformURL\]/,
  );
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
  assert.ok(
    launcher.indexOf("runFirstLaunchSetup") <
      launcher.indexOf("seedDeviceCookieWithCompletion"),
  );
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
  assert.match(launcher, /退出多平台内容运营/);
  assert.match(launcher, /URLByAppendingPathComponent:@"红薯台"/);
});

test("packages a self-contained Windows x64 app without customer data", async () => {
  const service = await source("scripts/app-service.mjs");
  const fetcher = await source("scripts/fetch-xhs-mcp.mjs");
  const packager = await source("scripts/build-windows.mjs");
  const launcher = await source("packaging/windows/Program.cs");
  const project = await source("packaging/windows/Launcher.csproj");
  const workflow = await source("../.github/workflows/ci.yml");

  assert.match(fetcher, /win32-x64/);
  assert.match(
    fetcher,
    /3578c9fcf3e7be0b79564aeceef8c4f38e0072d9357ca1f911ee14cd37bd454c/,
  );
  assert.match(service, /xiaohongshu-mcp-windows-amd64\.exe/);
  assert.match(packager, /process\.platform !== "win32"/);
  assert.match(packager, /windows-x64-portable/);
  assert.match(packager, /assertNoCustomerData\(packageRoot\)/);
  assert.match(packager, /--self-contained/);
  assert.match(packager, /node\.exe/);
  assert.match(packager, /runtime\/bin\/chromium/);
  assert.match(packager, /WebView2-\$\{filename\}/);
  for (const forbidden of [
    "team-config.json",
    "cookies.json",
    "ai.json",
    "runtime/accounts",
    "runtime/platform-accounts",
    "runtime/publish-assets",
  ]) {
    assert.match(packager, new RegExp(forbidden.replace("/", "\\/")));
  }
  assert.match(project, /net8\.0-windows/);
  assert.match(project, /Microsoft\.Web\.WebView2/);
  assert.match(launcher, /CoreWebView2Environment/);
  assert.match(launcher, /hongshutai_device/);
  assert.match(launcher, /SpecialFolder\.LocalApplicationData/);
  assert.match(launcher, /service\.Kill\(true\)/);
  assert.match(launcher, /独立使用/);
  assert.match(launcher, /创建团队主机/);
  assert.match(launcher, /加入已有团队/);
  assert.match(launcher, /仅允许专用网络/);
  assert.match(workflow, /windows-package:/);
  assert.match(workflow, /npm run package:windows/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
});
