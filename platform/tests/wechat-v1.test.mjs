import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveWechatCredentials,
  wechatAuthStatus,
} from "../runtime/platforms/wechat-openapi.mjs";
import { renderWechatMarkdown } from "../runtime/platforms/wechat-markdown.mjs";

test("公众号凭据按账号隔离并以私有权限保存", () => {
  const root = mkdtempSync(join(tmpdir(), "hongshutai-wechat-"));
  const accountId = "wechat_account_123";
  saveWechatCredentials(
    root,
    accountId,
    "wx1234567890abcdef",
    "0123456789abcdef0123456789abcdef",
  );
  const path = join(root, accountId, "wechat-openapi.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(wechatAuthStatus(root, accountId).configured, true);
  assert.doesNotMatch(
    JSON.stringify(wechatAuthStatus(root, accountId)),
    /0123456789abcdef/,
  );
  assert.match(readFileSync(path, "utf8"), /appSecret/);
});

test("公众号适配器使用官方草稿与素材接口", () => {
  const source = readFileSync(
    new URL("../runtime/platforms/wechat-openapi.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /cgi-bin\/stable_token/);
  assert.match(source, /material\/add_material/);
  assert.match(source, /media\/uploadimg/);
  assert.match(source, /draft\/add/);
  assert.match(source, /draft\/get/);
  assert.match(source, /publishingAccounts/);
  assert.match(source, /renderWechatMarkdown/);
});

test("公众号 Markdown 排版支持主题、标题和加粗并过滤 HTML", () => {
  const html = renderWechatMarkdown(
    "## 小标题\n\n这是**重点**。\n\n<script>alert(1)</script>",
    "grace",
  );
  assert.match(html, /<h2 style=/);
  assert.match(html, /<strong style=/);
  assert.match(html, /#7b5a9e/);
  assert.doesNotMatch(html, /<script/);
});

test("公众号创作使用独立长文提示词和平台化界面", () => {
  const creation = readFileSync(
    new URL("../app/api/creation/route.ts", import.meta.url),
    "utf8",
  );
  const manager = readFileSync(
    new URL("../runtime/manager.mjs", import.meta.url),
    "utf8",
  );
  const prompt = readFileSync(
    new URL("../runtime/prompts/wechat-content-system.md", import.meta.url),
    "utf8",
  );
  const ui = readFileSync(
    new URL("../app/PlatformApp.tsx", import.meta.url),
    "utf8",
  );
  const brand = readFileSync(
    new URL("../app/brand-system.css", import.meta.url),
    "utf8",
  );
  assert.match(creation, /wechat-article-draft/);
  assert.match(manager, /wechat-content-system\.md/);
  assert.match(prompt, /微信公众号资深编辑与排版策划/);
  assert.match(ui, /公众号长文稿/);
  assert.match(ui, /封面与正文配图提示词/);
  assert.match(ui, /选择排版后提交审核/);
  assert.match(ui, /确认此排版并提交审核/);
  assert.match(ui, /查看最终公众号排版/);
  assert.match(ui, /排版已在审核时冻结/);
  assert.match(ui, /未上传图片，不影响提交审核/);
  assert.match(ui, /isXiaohongshuClaim\(selected\)/);
  assert.doesNotMatch(creation, /公众号文章配图建议不完整/);
  assert.match(prompt, /image_prompts 可以返回空数组/);
  assert.match(ui, /官方草稿接口必须有一张封面/);
  assert.match(ui, /正文配图可选；当前缺少公众号接口必需的封面/);
  assert.match(ui, /生成封面提示词/);
  assert.match(ui, /generateWechatCoverPrompt/);
  assert.match(creation, /action === "generate_cover_prompt"/);
  assert.match(creation, /wechat-cover-prompt/);
  assert.match(manager, /wechat-cover-prompt\.schema\.json/);
  assert.match(manager, /\/wechat\/render/);
  assert.match(ui, /排版主题/);
  assert.match(ui, /选择排版并预览/);
  assert.match(ui, /wechat-phone-preview/);
  assert.match(ui, /商务蓝/);
  assert.match(ui, /墨香国风/);
  assert.match(ui, /高亮重点型/);
  assert.match(ui, /正文字号/);
  assert.match(ui, /行距/);
  assert.match(brand, /\.wechat-layout-modal \.modal-actions/);
  assert.match(brand, /flex:\s*1 1 auto/);
  assert.match(prompt, /Markdown/);
});
