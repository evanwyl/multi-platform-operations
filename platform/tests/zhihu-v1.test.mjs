import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(resolve(projectRoot, path), "utf8");

test("adds Zhihu through platform fields without changing Xiaohongshu trend tables", async () => {
  const database = await source("lib/database.ts");
  const app = await source("app/api/app/route.ts");
  assert.match(database, /platform TEXT NOT NULL DEFAULT 'xiaohongshu'/);
  assert.match(database, /external_user_id TEXT/);
  assert.match(
    database,
    /content_type TEXT NOT NULL DEFAULT 'xiaohongshu_note'/,
  );
  assert.match(database, /source_type TEXT NOT NULL DEFAULT 'manual'/);
  const migrationColumns = database.indexOf("const accountPlatformColumns");
  const platformIndex = database.indexOf(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_platform_external_user",
  );
  assert.ok(
    migrationColumns >= 0 && platformIndex > migrationColumns,
    "platform index must be created after old databases receive platform columns",
  );
  assert.match(database, /CREATE TABLE IF NOT EXISTS trend_samples/);
  assert.match(app, /source\.platform !== account\.platform/);
  assert.match(app, /contentTypeForPlatform/);
});

test("keeps Zhihu credentials out of the database and persists them with owner-only permissions", async (context) => {
  const work = await mkdtemp(resolve(tmpdir(), "hongshutai-zhihu-test-"));
  context.after(() => rm(work, { recursive: true, force: true }));
  const adapter = await import(
    new URL("../runtime/platforms/zhihu-openapi.mjs", import.meta.url).href
  );
  const accountId = "zhihu-account-123";
  const saved = adapter.saveZhihuCredentials(
    work,
    accountId,
    "example-token",
    "s".repeat(32),
  );
  assert.equal(saved.configured, true);
  assert.equal(adapter.zhihuAuthStatus(work, accountId).configured, true);
  const credentialFile = resolve(work, accountId, "openapi.json");
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
  assert.equal(
    adapter.plainTextToArticleHtml("第一段\n换行\n\n第二段"),
    "<p>第一段<br />换行</p>\n<p>第二段</p>",
  );
});

test("uses an isolated persistent Chromium profile for default Zhihu login", async () => {
  const browser = await source("runtime/platforms/zhihu-browser.mjs");
  const manager = await source("runtime/manager.mjs");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(browser, /launchPersistentContext/);
  assert.match(browser, /zhihu-profile/);
  assert.match(browser, /z_c0/);
  assert.match(
    browser,
    /\[configured, \.\.\.browserCandidates, bundled, windowsBundled\]/,
  );
  assert.match(browser, /process\.platform === "win32" \? "Control\+A" : "Meta\+A"/);
  assert.match(browser, /for \(const executablePath of executables\)/);
  assert.match(browser, /catch \(error\) \{ lastError = error; \}/);
  assert.match(manager, /\/zhihu\/browser-login/);
  assert.match(manager, /\/zhihu\/browser-login-complete/);
  assert.match(ui, /登录知乎/);
  assert.match(ui, /我已登录，完成绑定/);
  assert.doesNotMatch(ui, /配置测试授权/);
});

test("keeps OpenAPI fallback while routing normal Zhihu publishing through the persistent browser", async () => {
  const adapter = await source("runtime/platforms/zhihu-openapi.mjs");
  const publish = await source("app/api/publish/route.ts");
  const manager = await source("runtime/manager.mjs");
  assert.match(adapter, /https:\/\/openapi\.zhihu\.com\/openapi\/publish/);
  assert.match(adapter, /app_key:\$\{credentials\.appKey\}\|ts:/);
  assert.match(adapter, /createHmac\("sha256", credentials\.appSecret\)/);
  assert.match(adapter, /Number\(result\?\.status\) !== 0/);
  assert.match(manager, /\/zhihu\/credentials/);
  assert.match(manager, /\/zhihu\/publish/);
  assert.match(publish, /通过知乎开放平台发布专栏/);
  assert.match(publish, /通过知乎浏览器发布专栏/);
  assert.doesNotMatch(publish, /ENABLE_ZHIHU_PUBLISH/);
  assert.match(manager, /publishZhihuArticleBrowser/);
  assert.match(publish, /发布按钮已触发/);
  assert.match(publish, /published_url/);
  assert.match(publish, /content_type === "zhihu_article"/);
});

test("allows text-only Zhihu review but retains Xiaohongshu image review", async () => {
  const app = await source("app/api/app/route.ts");
  const creation = await source("app/api/creation/route.ts");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(
    app,
    /requiresReviewImages\(claim\.content_type\) && !images\.length/,
  );
  assert.match(
    app,
    /requiresReviewImages\(claim\.content_type\)\s*&&\s*!reviewImages\.length/,
  );
  assert.match(creation, /zhihu-article-draft/);
  assert.match(creation, /知乎专栏创作/);
  assert.match(ui, /\{selectedPlatformName\}当前为文本审核/);
  assert.match(ui, /文章正文配图为可选项，可直接审核/);
  assert.match(
    ui,
    /isXiaohongshuClaim\(claim\)[\s\S]{0,120}!claim\.publish_images\?\.length/,
  );
  assert.match(ui, /通过文章并转入发布/);
  assert.match(ui, /确认并发布专栏/);
});

test("confirms a browser publish only from the final Zhihu article URL", async () => {
  const browser = await source("runtime/platforms/zhihu-browser.mjs");
  assert.match(browser, /zhuanlan\.zhihu\.com\/write/);
  assert.match(browser, /请输入标题（最多 100 个字）/);
  assert.match(
    browser,
    /async function firstVisible\(page, selectors, timeout = 15_000\)/,
  );
  assert.match(
    browser,
    /await page\.waitForTimeout\(Math\.min\(250, deadline - Date\.now\(\)\)\)/,
  );
  assert.match(browser, /public-DraftEditor-content/);
  assert.match(browser, /button:text-is\('发布'\)/);
  assert.match(browser, /publishedArticle/);
  assert.match(browser, /publish-failure\.png/);
  assert.match(browser, /发布按钮已触发，但30秒内无法确认文章地址/);
});

test("keeps WeChat accounts and publishing isolated from Xiaohongshu", async () => {
  const platforms = await source("lib/platforms.ts");
  const publish = await source("app/api/publish/route.ts");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(platforms, /wechat_article/);
  assert.match(publish, /isWechatArticle/);
  assert.match(publish, /\/wechat\/publish/);
  assert.match(ui, /fixed-platform-field/);
  assert.doesNotMatch(ui, /<select name="platform">/);
});
