import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(resolve(projectRoot, path), "utf8");

test("adds a Zhihu article discovery source without changing Xiaohongshu MCP research", async () => {
  const route = await source("app/api/article-research/route.ts");
  const xhs = await source("app/api/trends/route.ts");
  const database = await source("lib/database.ts");
  assert.match(route, /SEARXNG_URL/);
  assert.match(route, /format", "json"/);
  assert.match(route, /article_research_samples/);
  assert.match(route, /matched_keywords/);
  assert.match(route, /fetchArticle/);
  assert.match(route, /safePublicUrl/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS article_research_samples/);
  assert.match(xhs, /callMcpTool\(port, "search_feeds"/);
  assert.doesNotMatch(xhs, /SEARXNG_URL/);
});

test("routes article research into the existing Zhihu topic and content workflow", async () => {
  const route = await source("app/api/article-research/route.ts");
  const creation = await source("app/api/creation/route.ts");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(route, /\?,'article_search'/);
  assert.match(route, /INSERT INTO topic_insights/);
  assert.match(route, /article:\$\{sampleId\}/);
  assert.match(creation, /feedId\.startsWith\("article:"\)/);
  assert.match(creation, /FROM article_research_samples/);
  assert.match(ui, /SEO选题搜索/);
  assert.match(ui, /文章搜索服务已连接/);
  assert.match(ui, /不限网站（全网搜索）/);
  assert.match(ui, /type="checkbox"[\s\S]{0,80}checked=\{includeDomains\.includes\(domain\)\}/);
  assert.doesNotMatch(ui, /排除网站/);
  assert.doesNotMatch(ui, /excludeDomains/);
  assert.match(route, /const defaultExcludedDomains/);
  assert.match(route, /`\$\{keyword\} site:\$\{searchDomain\}` : keyword/);
  assert.match(ui, /分别定向搜索各网站/);
  assert.match(ui, /共用搜索与正文抓取能力/);
});

test("does not allow failed article bodies to enter the writing pipeline", async () => {
  const route = await source("app/api/article-research/route.ts");
  assert.match(route, /s\.processing_status='success' AND s\.detail_text!=''/);
  assert.match(route, /if \(processing === "success" && detail\) discovered \+= 1/);
  assert.match(route, /sample\.processing_status !== "success" \|\| !sample\.detail_text/);
  assert.match(route, /来源正文尚未抓取成功，暂时不能转入选题/);
  assert.match(route, /地址不是公开网页/);
});

test("strictly filters article pages and the selected publication time", async () => {
  const route = await readFile(new URL("../app/api/article-research/route.ts", import.meta.url), "utf8");
  assert.match(route, /function looksLikeArticle/);
  assert.match(route, /host === "mp\.weixin\.qq\.com"/);
  assert.match(route, /function withinTimeRange/);
  assert.match(route, /rejected_by_time/);
  assert.match(route, /url\.searchParams\.set\("pageno", String\(page\)\)/);
  assert.match(route, /async function searchWechat/);
  assert.match(route, /sogou weixin/);
});

test("supports selecting and bulk archiving Zhihu and WeChat article samples", async () => {
  const route = await source("app/api/article-research/route.ts"); const ui = await source("app/PlatformApp.tsx");
  assert.match(route, /action === "archive_bulk"/); assert.match(route, /status='archived'/); assert.match(route, /共享正文保留/);
  assert.match(ui, /selectedArticles/); assert.match(ui, /全选当前列表/); assert.match(ui, /确认批量删除/);
});

test("shares article bodies while isolating Zhihu and WeChat research workflows", async () => {
  const route = await source("app/api/article-research/route.ts");
  const database = await source("lib/database.ts");
  const ui = await source("app/PlatformApp.tsx");
  assert.match(database, /CREATE TABLE IF NOT EXISTS article_research_entries/);
  assert.match(database, /UNIQUE\(sample_id, platform\)/);
  assert.match(route, /JOIN article_research_samples s ON s\.id=e\.sample_id/);
  assert.match(route, /e\.platform=\?/);
  assert.match(route, /data\.platform === "wechat" \? "wechat" : "zhihu"/);
  assert.match(route, /UPDATE article_research_entries SET status='used'/);
  assert.match(route, /elementBodyById\(html, "js_content"\)/);
  assert.match(ui, /\["mp\.weixin\.qq\.com", "微信公众号"\]/);
  assert.match(ui, /<ArticleResearch[\s\S]{0,100}key=\{scopePlatform\}[\s\S]{0,100}platform=\{scopePlatform\}/);
  assert.match(ui, /platform === "wechat"[\s\S]{0,80}\?[\s\S]{0,40}"文章选题搜索"/);
});
