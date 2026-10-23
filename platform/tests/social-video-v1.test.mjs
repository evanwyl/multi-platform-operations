import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("registers Douyin and WeChat Channels as isolated video platforms", async () => {
  const platforms = await source("lib/platforms.ts");
  const database = await source("lib/database.ts");
  assert.match(platforms, /douyin_video/);
  assert.match(platforms, /wechat_channels_video/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS media_assets/);
  assert.match(database, /sha256 TEXT NOT NULL/);
});

test("freezes uploaded video assets before browser publishing", async () => {
  const appApi = await source("app/api/app/route.ts");
  const mediaApi = await source("app/api/media/route.ts");
  const publishApi = await source("app/api/publish/route.ts");
  assert.match(mediaApi, /canAccessAccount/);
  assert.match(mediaApi, /\["writing", "revision"\]/);
  assert.match(mediaApi, /DELETE FROM media_assets WHERE claim_id=\? AND kind=\?/);
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
  assert.match(manager, /url\.pathname === "\/social\/publish"/);
  assert.match(manager, /url\.pathname === "\/media-assets"/);
});

test("packages social browser adapters on macOS and Windows", async () => {
  const mac = await source("scripts/build-unsigned-macos.mjs");
  const windows = await source("scripts/build-windows.mjs");
  assert.match(mac, /runtime\/platforms/);
  assert.match(windows, /runtime\/platforms/);
});
