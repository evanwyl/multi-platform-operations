import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("exposes a traceable three-stage remix workflow", async () => {
  const ui = await source("app/PlatformApp.tsx");
  assert.match(ui, /原始内容/);
  assert.match(ui, /AI 拆解/);
  assert.match(ui, /二创工作台/);
  assert.match(ui, /保真换话术/);
  assert.match(ui, /结构复用/);
  assert.match(ui, /主题再创作/);
  assert.match(ui, /没有抓取成功的正文/);
  assert.match(ui, /来源帖子数据/);
  assert.match(ui, /来源内容数据/);
  assert.match(ui, /抓取时间/);
});

test("persists source analysis and keeps facts constrained by the primary source", async () => {
  const creation = await source("app/api/creation/route.ts");
  const manager = await source("runtime/manager.mjs");
  const schema = await source("runtime/remix-analysis.schema.json");
  const macPackage = await source("scripts/build-unsigned-macos.mjs");
  const windowsPackage = await source("scripts/build-windows.mjs");
  assert.match(creation, /action === "analyze_remix"/);
  assert.match(creation, /AI拆解来源正文/);
  assert.match(creation, /事实锚点/);
  assert.match(creation, /liked_count,collected_count,comment_count,shared_count,heat_score/);
  assert.match(creation, /互动量、热度、排名和抓取时间只用于判断内容表现/);
  assert.match(creation, /不得虚构数据、案例、人物、效果、场景或亲身经历/);
  assert.match(manager, /"remix-analysis"/);
  assert.match(schema, /"fact_anchors"/);
  assert.match(schema, /"risks"/);
  assert.match(macPackage, /remix-analysis\.schema\.json/);
  assert.match(windowsPackage, /remix-analysis\.schema\.json/);
});
