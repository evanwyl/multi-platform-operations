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
  assert.match(source, /团队共享内容 · 选择账号/);
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

test("preserves requested media type and progressively enriches retained research samples", async () => {
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const planSchema = await readFile(new URL("../runtime/trend-plan.schema.json", import.meta.url), "utf8");
  assert.match(planSchema, /"content_type"/);
  assert.match(route, /noteType === "normal"/);
  assert.match(route, /sample\.note_type === "normal"/);
  assert.match(route, /\.slice\(0, 15\)/);
  assert.match(route, /action === "enrich_sample"/);
  assert.match(route, /const detail = await feedDetail/);
  assert.match(route, /parsed\.data\?\.note \?\? parsed\.note/);
  assert.match(route, /action === "resume_details"/);
  assert.match(route, /manual_backfill_button/);
  assert.match(route, /正文补抓必须由页面按钮确认后启动/);
  assert.match(route, /detail_sample_ids/);
  assert.match(route, /get_feed_detail[\s\S]*45_000/);
  assert.match(route, /search_feeds", args, 70_000/);
  assert.match(route, /已保留前面结果并继续下一个关键词/);
  assert.match(route, /平台排序筛选不可用，已保留时间范围并按真实互动数据本地排序/);
  assert.match(source, /messageHasWarning/);
  assert.match(source, /messageHasError \? "bad" : messageHasWarning \? "warn"/);
  assert.match(route, /completed_keywords=\?,error=CASE/);
  assert.doesNotMatch(route, /index < 2/);
  assert.match(route, /feed\.xsecToken \|\| "", "", card\?\.interactInfo/);
  assert.match(source, /正在搜索基础样本/);
  assert.match(source, /正在补充详情/);
  assert.match(source, /最后一步：采集与正文读取已完成，AI 正在聚类/);
  assert.match(source, /AI 正在生成垂直搜索计划/);
  assert.match(source, /确认并开始采集/);
  assert.match(source, /action: "enrich_sample"/);
  assert.match(source, /补抓正文/);
  assert.match(source, /切换到其他页面后仍会继续/);
  assert.match(source, /后台补抓任务/);
  assert.match(source, /stopTrendTask/);
  assert.match(source, /停止任务/);
  assert.match(source, /AbortController/);
  assert.match(route, /action === "cancel_scan"/);
  assert.match(route, /status='cancelled'/);
  assert.match(route, /codex\/cancel/);
  assert.match(source, /等待处理/);
  assert.match(source, /只保留标题、作者和真实互动数据/);
  assert.match(route, /metricValue\(sample\.liked_count\) \+ metricValue\(sample\.collected_count\) \* 1\.5 \+ metricValue\(sample\.comment_count\) \* 2/);
  assert.match(route, /selection_status='selected'/);
  assert.match(route, /titleSimilarity/);
  assert.match(route, />= 0\.72/);
  assert.match(route, /processing_status='detail_fetching'/);
  assert.match(source, /详情获取失败/);
  assert.match(source, /已存在\/重复/);
  assert.match(route, /processing_status='success' AND detail_text!=''/);
  assert.match(route, /status!='archived' AND selection_status='selected' AND processing_status='success'/);
  assert.match(route, /正文获取成功的爆款样本不足3条/);
  assert.match(route, /正文和爆点拆解尚未成功，不能转入选题中心/);
  assert.match(source, /正文成功后可转入/);
  assert.match(source, /旧AI推断已隐藏/);
  assert.match(source, /正文成功后才会拆解/);
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
  assert.match(source, /核心样本/);
  assert.match(source, /可转入 \{transferableCount\} 条/);
  assert.match(source, /已转入 \$\{alreadyTransferredCount\} 条/);
  assert.match(route, /action === "create_topics_bulk"/);
  assert.match(route, /sample\.status !== "new"/);
  assert.match(route, /UPDATE trend_samples SET status='used'/);
  assert.match(styles, /\.creation-strip\+\.data-panel>\.topic-cards\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.page-stack:has\(> \.creation-strip\)/);
});

test("uses account-aware layered keywords and quality gates before creating topics", async () => {
  const route = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const database = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  const planSchema = await readFile(new URL("../runtime/trend-plan.schema.json", import.meta.url), "utf8");
  const analysisSchema = await readFile(new URL("../runtime/topic-analysis.schema.json", import.meta.url), "utf8");
  const candidateSchema = await readFile(new URL("../runtime/candidate-screen.schema.json", import.meta.url), "utf8");
  assert.match(planSchema, /"primary_keyword"/);
  assert.match(planSchema, /"intent_phrase"/);
  assert.match(planSchema, /"scenario_terms"/);
  assert.match(candidateSchema, /"intent_match_score"/);
  assert.match(candidateSchema, /"account_fit_score"/);
  assert.match(route, /relevance \* \.55 \+ intent \* \.25 \+ heatScores\[index\] \* \.20/);
  assert.match(route, /information >= 60 && remix >= 60 && accountFit >= 55/);
  assert.match(route, /qualityTier === "core"/);
  assert.match(route, /sources\.length < 2/);
  assert.match(analysisSchema, /"visible_proof_score"/);
  assert.match(analysisSchema, /"reproducibility_score"/);
  assert.match(database, /content_pillars/);
  assert.match(database, /final_quality_score/);
  assert.match(source, /目标内容账号/);
  assert.match(source, /生成搜索计划/);
  assert.match(source, /趋势信号/);
  assert.match(source, /update_account_strategy/);
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
  assert.match(route, /FROM trend_samples WHERE status!='archived'/);
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

test("supports selecting and safely bulk deleting topics", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  const brand = await readFile(new URL("../app/brand-system.css", import.meta.url), "utf8");
  assert.match(source, /selectedTopics/);
  assert.match(source, /全选当前分类/);
  assert.match(source, /archive_topics_bulk/);
  assert.match(source, /已有的认领、创作、审核和发布记录会继续保留/);
  assert.match(route, /action === "archive_topics_bulk"/);
  assert.match(route, /UPDATE topics SET archived_at=\?/);
  assert.doesNotMatch(route, /DELETE FROM topics/i);
  assert.match(brand, /grid-template-columns: 26px 64px minmax\(0, 1fr\) auto/);
  assert.match(brand, /\.topic-claim-button \{[\s\S]*?grid-column: 4/);
  assert.match(brand, /\.view-topics \.topic-status-tabs button \{[\s\S]*?width: 84px/);
  assert.match(brand, /\.view-topics \.topic-batch-bar \{[\s\S]*?margin-inline: 0/);
});

test("blocks legacy AI topics whose source body was never verified", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  assert.match(route, /source_detail_verified/);
  assert.match(route, /来源正文尚未验证，暂时不能认领创作/);
  assert.match(source, /来源正文未验证/);
  assert.match(source, /等待正文验证/);
  assert.match(source, /旧逻辑在正文获取失败时生成/);
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

test("lets admins remove other members while preserving attributed history", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  assert.match(source, /remove_user/);
  assert.match(source, /删除成员/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /member\.id === data\.user\.id/);
  assert.match(route, /action === "remove_user"/);
  assert.match(route, /targetId === user\.id/);
  assert.match(route, /UPDATE users SET status='disabled'/);
  assert.match(route, /DELETE FROM sessions WHERE user_id/);
  assert.doesNotMatch(route, /DELETE FROM users/);
});

test("shares the content workspace with every signed-in team member", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const creationRoute = await readFile(new URL("../app/api/creation/route.ts", import.meta.url), "utf8");
  const appRoute = await readFile(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  assert.match(source, /const teamClaims = data\.claims/);
  assert.match(source, /团队共享内容/);
  assert.match(source, /所有成员看到同一批已认领内容/);
  assert.doesNotMatch(source, /const ownedClaims = data\.claims/);
  assert.match(creationRoute, /return Boolean\(user\.id && claim\.id\)/);
  assert.doesNotMatch(appRoute, /claim\.owner_id !== user\.id/);
  assert.doesNotMatch(creationRoute, /claim\.owner_id === user\.id/);
});

test("shows claim and publish staff identities and records the actual publisher", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const appRoute = await readFile(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  const publishRoute = await readFile(new URL("../app/api/publish/route.ts", import.meta.url), "utf8");
  const database = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  assert.match(source, /认领工作人员/);
  assert.match(source, /确认由我认领/);
  assert.match(source, /内容负责人/);
  assert.match(source, /发布操作人/);
  assert.match(source, /publisher_name/);
  assert.match(appRoute, /publisher\.name AS publisher_name/);
  assert.match(appRoute, /LEFT JOIN users publisher ON publisher\.id=c\.publisher_id/);
  assert.match(publishRoute, /publisher_id=\?/);
  assert.match(publishRoute, /发布人 \$\{user\.name\}/);
  assert.match(database, /\["publisher_id", "TEXT"\]/);
  assert.match(database, /publisher_id IS NULL AND status='published'/);
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
  assert.match(publishRoute, /const PUBLISH_TIMEOUT_MS = 6 \* 60 \* 1000/);
  assert.match(publishRoute, /publish_content", \{ title, content: body, images, tags: cleanTags \}, PUBLISH_TIMEOUT_MS/);
  assert.match(publishRoute, /content: body, images, tags: cleanTags/);
  assert.doesNotMatch(publishRoute, /tagText|`\$\{body\}\\n\\n\$\{tagText\}`/);
  assert.match(publishRoute, /UPDATE claims SET status='published'/);
  assert.match(manager, /url\.pathname === "\/publish-assets"/);
  assert.doesNotMatch(source, /<h2>审核与发布<\/h2>/);
});

test("allows unpublished content to return to revision before publishing", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const publishRoute = await readFile(new URL("../app/api/publish/route.ts", import.meta.url), "utf8");
  assert.match(source, /returnForRevision/);
  assert.match(source, /退回修改/);
  assert.match(source, /原文案、配图和历史审核记录均已保留/);
  assert.match(publishRoute, /action === "return_for_revision"/);
  assert.match(publishRoute, /\["approved", "queued", "failed"\]/);
  assert.match(publishRoute, /status='revision'/);
  assert.match(publishRoute, /退回修改时必须填写原因/);
});

test("builds trend research records around text, metrics, and per-sample analysis", async () => {
  const source = await readFile(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
  const trends = await readFile(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");
  const database = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../runtime/topic-analysis.schema.json", import.meta.url), "utf8");
  assert.match(source, /sample-research-list/);
  assert.match(source, /内容摘要/);
  assert.match(source, /爆点拆解/);
  assert.match(source, /原帖正文/);
  assert.doesNotMatch(source, /className="sample-cover"/);
  assert.match(trends, /\.slice\(0, 15\)/);
  assert.doesNotMatch(trends, /cacheFeedCovers/);
  assert.match(trends, /content_summary=\?/);
  assert.match(trends, /cover_url=CASE WHEN excluded\.cover_url!=''/);
  assert.match(database, /sample_hooks TEXT/);
  assert.match(database, /shared_count TEXT/);
  assert.match(database, /raw_heat_score REAL/);
  assert.match(database, /processing_status TEXT/);
  assert.match(database, /account_adaptation TEXT/);
  assert.match(database, /relevance_score INTEGER/);
  assert.match(database, /information_density_score INTEGER/);
  assert.match(database, /remix_value_score INTEGER/);
  assert.match(schema, /sample_analyses/);
  assert.match(schema, /title_hook/);
  assert.match(schema, /visual_highlight/);
  assert.match(schema, /practical_value/);
  assert.match(schema, /controversy_point/);
  assert.match(schema, /reusable_directions/);
  assert.match(schema, /account_adaptation/);
  assert.match(schema, /is_relevant/);
  assert.match(schema, /information_density_score/);
  assert.match(schema, /remix_value_score/);
});
