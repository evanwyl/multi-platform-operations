import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("registers per-platform image and video content formats", async () => {
  const platforms = await source("lib/platforms.ts");
  const database = await source("lib/database.ts");
  assert.match(platforms, /xiaohongshu_video/);
  assert.match(platforms, /douyin_image/);
  assert.match(platforms, /douyin_video/);
  assert.match(platforms, /wechat_channels_video/);
  assert.match(platforms, /isContentTypeForPlatform/);
  assert.match(platforms, /isImageContentType/);
  assert.match(platforms, /isVideoContentType/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS media_assets/);
  assert.match(database, /sha256 TEXT NOT NULL/);
});

test("chooses content format when claiming Xiaohongshu or Douyin topics", async () => {
  const ui = await source("app/PlatformApp.tsx");
  const appApi = await source("app/api/app/route.ts");
  const creation = await source("app/api/creation/route.ts");
  const manager = await source("runtime/manager.mjs");
  assert.match(ui, /<legend>内容形式<\/legend>/);
  assert.match(ui, /value=.*xiaohongshu_note/s);
  assert.match(ui, /xiaohongshu_video/);
  assert.match(ui, /douyin_image/);
  assert.match(ui, /douyin_video/);
  assert.match(
    appApi,
    /isContentTypeForPlatform\(contentType, account\.platform\)/,
  );
  assert.match(appApi, /topic_id=\? AND account_id=\? AND content_type=\?/);
  assert.match(creation, /douyin-image-draft/);
  assert.match(manager, /douyin-image-system\.md/);
});

test("freezes uploaded video assets before browser publishing", async () => {
  const appApi = await source("app/api/app/route.ts");
  const mediaApi = await source("app/api/media/route.ts");
  const publishApi = await source("app/api/publish/route.ts");
  assert.match(mediaApi, /canAccessAccount/);
  assert.match(mediaApi, /\["writing", "revision"\]/);
  assert.match(
    mediaApi,
    /DELETE FROM media_assets WHERE claim_id=\? AND kind=\?/,
  );
  assert.match(appApi, /media_assets: media\.results/);
  assert.match(appApi, /缺少成品视频，不能通过审核/);
  assert.match(publishApi, /审核快照缺少成品视频/);
  assert.match(publishApi, /expectedIdentityKey: claim\.external_user_id/);
});

test("uses separate persistent browser profiles and uncertainty locking", async () => {
  const adapter = await source("runtime/platforms/social-video-browser.mjs");
  const manager = await source("runtime/manager.mjs");
  assert.match(adapter, /profileName: "douyin-profile"/);
  assert.match(adapter, /profileName: "wechat-channels-profile"/);
  assert.match(adapter, /当前登录身份与任务绑定账号不一致/);
  assert.match(adapter, /提交按钮已触发，但结果暂时无法确认/);
  assert.match(adapter, /uploadDouyinImages/);
  assert.match(adapter, /contentType === "douyin_image"/);
  assert.match(manager, /url\.pathname === "\/social\/publish"/);
  assert.match(manager, /url\.pathname === "\/media-assets"/);
});

test("keeps Xiaohongshu legacy identity repair away from Douyin and Channels", async () => {
  const database = await source("lib/database.ts");
  const socialApi = await source("app/api/social-video/route.ts");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(
    database,
    /status='login_expired' WHERE platform='xiaohongshu' AND is_demo=0 AND xhs_user_id IS NULL/,
  );
  assert.doesNotMatch(
    database,
    /status='login_expired' WHERE is_demo=0 AND xhs_user_id IS NULL/,
  );
  assert.match(socialApi, /data\.action === "auth_status"/);
  assert.match(socialApi, /\/social\/auth-status\?platform=/);
  assert.match(
    socialApi,
    /当前\$\{account\.platform === "douyin" \? "抖音" : "视频号"\}登录身份与已绑定账号不一致/,
  );
  assert.match(ui, /"检查登录"/);
});

test("publishes Xiaohongshu video through the existing MCP runtime", async () => {
  const publishApi = await source("app/api/publish/route.ts");
  assert.match(
    publishApi,
    /isXiaohongshuVideo \? "publish_video" : "publish_content"/,
  );
  assert.match(publishApi, /video: videoAsset\?\.path/);
});

test("packages social browser adapters on macOS and Windows", async () => {
  const mac = await source("scripts/build-unsigned-macos.mjs");
  const windows = await source("scripts/build-windows.mjs");
  assert.match(mac, /runtime\/platforms/);
  assert.match(windows, /runtime\/platforms/);
});
