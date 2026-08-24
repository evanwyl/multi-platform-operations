import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

test("renders the local operations platform shell", async () => {
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>红薯台｜小红书内容运营中台<\/title>/);
  assert.match(html, /正在启动红薯台/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("keeps trend work mounted and starts only from the button", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  assert.match(source, /hidden=\{view !== "trends"\}/);
  assert.match(source, /onClick=\{startScan\}/);
  assert.doesNotMatch(source, /onKeyDown=\{[^\n]*startScan/);
});

test("keeps AI creation mounted and recommends whole-post image prompts without page cards or image generation", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const creationRoute = await readFile(new URL("../app/api/creation/route.ts", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../runtime/manager.mjs", import.meta.url), "utf8");
  assert.match(source, /hidden=\{view !== "content"\}/);
  assert.match(source, /action: "generate"/);
  assert.match(source, /整个帖子的图片提示词/);
  assert.match(source, /复制全部提示词/);
  assert.match(creationRoute, /image_prompts/);
  assert.match(creationRoute, /这是一次 Codex 调用和一次结构化返回/);
  assert.doesNotMatch(source, /saved\.pages|legacyPrompts/);
  assert.doesNotMatch(creationRoute, /draft\.pages|legacyPrompts/);
  assert.doesNotMatch(source, /3:4 页面预览|creative-gallery|downloadCreativeCard|单页重做/);
  assert.doesNotMatch(creationRoute, /regenerate_page|content-page/);
  assert.doesNotMatch(source, /action: "generate_image"|AI 生图中|下载 AI 原图/);
  assert.doesNotMatch(runtime, /\/codex\/image|runImageGen|imageGeneration|content-page/);
  assert.match(runtime, /imagegenSkill/);
  assert.match(runtime, /同一次 Codex 执行中同时完成文案和整篇配图提示词/);
  assert.match(source, /保存并提交审核/);
  assert.match(source, /第一步 · 选择账号/);
  assert.match(source, /请选择一个账号/);
  assert.match(source, /accountClaims/);
  assert.match(source, /contentStageLabel/);
});

test("starts Xiaohongshu collection in headed browser mode", async () => {
  const runtime = await readFile(new URL("../runtime/manager.mjs", import.meta.url), "utf8");
  assert.match(runtime, /const HEADED_BROWSER = true/);
  assert.match(runtime, /`-headless=\$\{!HEADED_BROWSER\}`/);
  assert.doesNotMatch(runtime, /slot\.purpose !== "verification"/);
});

test("preserves requested media type and bounds feed detail collection", async () => {
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  const planSchema = await readFile(new URL("../runtime/trend-plan.schema.json", import.meta.url), "utf8");
  assert.match(planSchema, /"content_type"/);
  assert.match(route, /noteType === "normal"/);
  assert.match(route, /sample\.note_type === "normal"/);
  assert.match(route, /index < 2 \? await feedDetail/);
  assert.match(route, /get_feed_detail[\s\S]*20_000/);
  assert.doesNotMatch(route, /detailBudget/);
});

test("allows adding a sample topic without entering a replacement title", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  assert.match(source, /选题标题（选填）/);
  assert.match(source, /不填写则使用样本标题/);
  assert.doesNotMatch(source, /onChange=\{\(event\) => setTopicTitle\(event\.target\.value\)\} required/);
  assert.match(route, /trim\(\) \|\| sample\.title/);
  assert.doesNotMatch(route, /请填写原创选题标题/);
});

test("supports bulk sample transfer and keeps the team topic library independently scrollable", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /create_topics_bulk/);
  assert.match(source, /全选当前列表/);
  assert.match(source, /批量转入选题中心/);
  assert.match(route, /action === "create_topics_bulk"/);
  assert.match(route, /sample\.status !== "new"/);
  assert.match(route, /UPDATE trend_samples SET status='used'/);
  assert.match(styles, /\.creation-strip\+\.data-panel>\.topic-cards\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.page-stack:has\(> \.creation-strip\)/);
});

test("supports confirmed bulk deletion without hard-deleting sample or topic records", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  assert.match(source, /archive_samples_bulk/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /批量删除/);
  assert.match(source, /正式选题不受影响/);
  assert.match(route, /action === "archive_samples_bulk"/);
  assert.match(route, /UPDATE trend_samples SET status='archived'/);
  assert.doesNotMatch(route, /DELETE FROM trend_samples/i);
  assert.doesNotMatch(route, /DELETE FROM topics/i);
});

test("groups the topic center by real workflow status", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /topicFilter/);
  assert.match(source, /待认领/);
  assert.match(source, /创作中/);
  assert.match(source, /待审核/);
  assert.match(source, /待发布/);
  assert.match(source, /已发布/);
  assert.match(source, /visibleTopics/);
  assert.match(styles, /\.topic-status-tabs/);
});

test("groups review records by pending, approved, and rejected status", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  assert.match(source, /reviewFilter/);
  assert.match(source, /review-status-tabs/);
  assert.match(source, /label: "待审核"/);
  assert.match(source, /label: "已通过"/);
  assert.match(source, /label: "已退回"/);
  assert.match(source, /passedStatuses/);
  assert.match(source, /claim\.status === "review" \?/);
});

test("shows complete content task labels and separates review from real publishing", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const publishRoute = await readFile(new URL("../app/api/publish/route.ts", import.meta.url), "utf8");
  const manager = await readFile(new URL("../runtime/manager.mjs", import.meta.url), "utf8");
  assert.match(source, /claim\.title \|\| claim\.topic_title/);
  assert.match(source, /\["review", "✓", "审核中心"\]/);
  assert.match(source, /\["publish", "↗", "发布列表"\]/);
  assert.match(source, /通过并转入发布/);
  assert.match(source, /确认并发布到小红书/);
  assert.match(source, /查看内容/);
  assert.match(source, /审核冻结内容/);
  assert.match(source, /publish_snapshot/);
  assert.match(source, /window\.confirm/);
  assert.match(publishRoute, /callMcpTool\(port, "publish_content"/);
  assert.match(publishRoute, /content: body, images, tags: cleanTags/);
  assert.doesNotMatch(publishRoute, /tagText|`\$\{body\}\\n\\n\$\{tagText\}`/);
  assert.match(publishRoute, /UPDATE claims SET status='published'/);
  assert.match(manager, /url\.pathname === "\/publish-assets"/);
  assert.doesNotMatch(source, /<h2>审核与发布<\/h2>/);
});
