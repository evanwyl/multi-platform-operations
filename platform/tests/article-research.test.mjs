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
  assert.match(route, /'zhihu','article_search'/);
  assert.match(route, /INSERT INTO topic_insights/);
  assert.match(route, /article:\$\{sampleId\}/);
  assert.match(creation, /feedId\.startsWith\("article:"\)/);
  assert.match(creation, /FROM article_research_samples/);
  assert.match(ui, /SEO选题搜索/);
  assert.match(ui, /文章搜索服务已连接/);
  assert.match(ui, /不限网站（全网搜索）/);
  assert.match(ui, /type="checkbox" checked=\{includeDomains\.includes\(domain\)\}/);
  assert.doesNotMatch(ui, /排除网站/);
  assert.doesNotMatch(ui, /excludeDomains/);
  assert.match(route, /const defaultExcludedDomains/);
  assert.match(route, /const searchQuery = searchDomain \? `\$\{keyword\} site:\$\{searchDomain\}` : keyword/);
  assert.match(ui, /分别定向搜索各网站/);
  assert.match(ui, /转入选题后继续复用现有认领、AI创作、审核与发布流程/);
});

test("does not allow failed article bodies to enter the writing pipeline", async () => {
  const route = await source("app/api/article-research/route.ts");
  assert.match(route, /processing_status='success' AND detail_text!=''/);
  assert.match(route, /if \(processing === "success" && detail\) discovered \+= 1/);
  assert.match(route, /sample\.processing_status !== "success" \|\| !sample\.detail_text/);
  assert.match(route, /来源正文尚未抓取成功，暂时不能转入选题/);
  assert.match(route, /地址不是公开网页/);
});
