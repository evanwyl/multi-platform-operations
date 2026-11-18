import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { browserExecutables } from "../runtime/platforms/social-video-browser.mjs";
import { inspect } from "../runtime/platforms/operations-browser.mjs";

test("reads actual creator DOM fixtures without visiting live accounts", async (t) => {
  const installed = chromium.executablePath();
  const executablePath = existsSync(installed) ? installed : browserExecutables(new URL("..", import.meta.url).pathname)[0];
  if (!executablePath) { t.skip("No Chromium installed in this source-check environment"); return; }
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    let html = `<div class="note-card"><h3 class="note-card__title">测试作品</h3><a href="https://www.xiaohongshu.com/explore/1234567890abcdef12345678">作品</a><span class="note-card__stat">1.2万</span><span class="note-card__stat">12</span><span class="note-card__stat">56</span><span class="note-card__stat">30</span><span class="note-card__stat">4</span></div>`;
    await page.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    const account = { platform: "xiaohongshu" }, claim = { title: "测试作品", external_content_id: "1234567890abcdef12345678" };
    const result = await inspect(page, account, claim);
    assert.deepEqual(result.metric, { views: 12000, comments: 12, likes: 56, favorites: 30, shares: 4 });
    assert.equal(result.contentId, claim.external_content_id);
    html += html;
    await assert.rejects(inspect(page, account, { title: "测试作品" }), /同名作品/);
    html = `<main>粉丝总数 5.3万</main>`;
    assert.equal((await inspect(page, account, null)).followers, 53000);
    assert.equal((await inspect(page, account, null, true)).healthy, true);
    html = `<main>请先登录</main>`;
    await assert.rejects(inspect(page, account, claim), /重新登录/);
  } finally { await browser.close(); }
});
