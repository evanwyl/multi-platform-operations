import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { renderWechatMarkdown } from "./wechat-markdown.mjs";

const tokenCache = new Map();
const publishingAccounts = new Set();

function fail(message, status = 400, uncertain = false) {
  return Object.assign(new Error(message), { status, uncertain });
}
function paths(root, accountId) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(accountId)))
    throw fail("公众号账号标识不合法");
  const accountRoot = resolve(root, accountId);
  if (!accountRoot.startsWith(`${resolve(root)}/`))
    throw fail("公众号账号路径不合法");
  return { accountRoot, file: join(accountRoot, "wechat-openapi.json") };
}
function credentials(root, accountId) {
  const { file } = paths(root, accountId);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value.appId && value.appSecret
      ? { appId: String(value.appId), appSecret: String(value.appSecret) }
      : null;
  } catch {
    return null;
  }
}
export function wechatAuthStatus(root, accountId) {
  const value = credentials(root, accountId);
  return {
    configured: Boolean(value),
    auth_method: value ? "wechat_openapi" : "",
    masked_app_id: value
      ? `${value.appId.slice(0, 5)}••••${value.appId.slice(-4)}`
      : "",
  };
}
export function saveWechatCredentials(root, accountId, appId, appSecret) {
  appId = String(appId || "").trim();
  appSecret = String(appSecret || "").trim();
  if (!/^wx[a-fA-F0-9]{16}$/.test(appId))
    throw fail("AppID 格式不正确，应为 wx 开头的 18 位标识");
  if (appSecret.length < 16 || appSecret.length > 256)
    throw fail("AppSecret 格式不正确");
  const { accountRoot, file } = paths(root, accountId);
  mkdirSync(accountRoot, { recursive: true, mode: 0o700 });
  chmodSync(accountRoot, 0o700);
  const temporary = `${file}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ appId, appSecret, savedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  chmodSync(file, 0o600);
  tokenCache.delete(accountId);
  return wechatAuthStatus(root, accountId);
}
async function jsonResponse(response, label) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw fail(
      `${label}返回了无法解析的响应（HTTP ${response.status}）`,
      502,
      true,
    );
  }
  if (!response.ok || Number(value.errcode || 0) !== 0)
    throw fail(
      `${label}失败：${String(value.errmsg || `HTTP ${response.status}`).slice(0, 300)}`,
      response.status >= 400 ? response.status : 502,
      response.status >= 500,
    );
  return value;
}
async function accessToken(root, accountId, temporaryCredentials) {
  const saved = temporaryCredentials || credentials(root, accountId);
  if (!saved) throw fail("该公众号尚未配置开发者接口", 409);
  const cached = !temporaryCredentials && tokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now() + 300_000) return cached.token;
  let response;
  try {
    response = await fetch("https://api.weixin.qq.com/cgi-bin/stable_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: saved.appId,
        secret: saved.appSecret,
        force_refresh: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw fail(
      `公众号接口连接失败：${error instanceof Error ? error.message : "网络异常"}`,
      502,
      true,
    );
  }
  const value = await jsonResponse(response, "获取公众号 access_token");
  if (!value.access_token) throw fail("公众号接口未返回 access_token", 502);
  if (!temporaryCredentials)
    tokenCache.set(accountId, {
      token: value.access_token,
      expiresAt: Date.now() + Number(value.expires_in || 7200) * 1000,
    });
  return value.access_token;
}
export async function testWechatCredentials(root, accountId, appId, appSecret) {
  await accessToken(
    root,
    accountId,
    appId
      ? { appId: String(appId).trim(), appSecret: String(appSecret).trim() }
      : undefined,
  );
  return {
    ok: true,
    detail: "开发者接口连接成功；发布权限将在首次写入草稿时校验",
  };
}
function mime(path) {
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
    }[extname(path).toLowerCase()] || "application/octet-stream"
  );
}
async function upload(root, token, path, permanent) {
  const full = resolve(String(path || ""));
  const assets = resolve(root, "../publish-assets");
  if (!full.startsWith(`${assets}/`) || !existsSync(full))
    throw fail("公众号发布图片不存在或不在安全目录中");
  const form = new FormData();
  form.append(
    "media",
    new Blob([readFileSync(full)], { type: mime(full) }),
    full.split("/").pop(),
  );
  const endpoint = permanent
    ? `material/add_material?type=image&access_token=${encodeURIComponent(token)}`
    : `media/uploadimg?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/${endpoint}`,
    { method: "POST", body: form, signal: AbortSignal.timeout(60_000) },
  );
  return jsonResponse(
    response,
    permanent ? "上传公众号封面" : "上传公众号正文图片",
  );
}
export async function publishWechatDraft(root, payload) {
  if (publishingAccounts.has(payload.accountId))
    throw fail("该公众号正在提交另一篇草稿，请稍后再试", 409);
  publishingAccounts.add(payload.accountId);
  try {
    const title = String(payload.title || "").trim(),
      body = String(payload.body || "").trim();
    const images = Array.isArray(payload.images) ? payload.images : [];
    if (!title || !body) throw fail("公众号草稿缺少标题或正文");
    if (!images.length) throw fail("公众号草稿必须包含一张封面图");
    const token = await accessToken(root, payload.accountId);
    const cover = await upload(root, token, images[0], true);
    const inline = [];
    for (const path of images.slice(1, 9)) {
      const result = await upload(root, token, path, false);
      if (result.url) inline.push(result.url);
    }
    const article = {
      title: title.slice(0, 64),
      author: String(payload.author || "").slice(0, 16),
      digest: String(payload.digest || body.replace(/\s+/g, " ")).slice(0, 120),
      content: renderWechatMarkdown(
        body,
        payload.theme || "default",
        inline,
        payload.style || {},
      ),
      content_source_url: String(payload.sourceUrl || "").slice(0, 1024),
      thumb_media_id: String(cover.media_id || ""),
      need_open_comment: payload.openComment === false ? 0 : 1,
      only_fans_can_comment: payload.onlyFansComment ? 1 : 0,
    };
    if (!article.thumb_media_id)
      throw fail("公众号封面上传成功但未返回 media_id", 502);
    let response;
    try {
      response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ articles: [article] }),
          signal: AbortSignal.timeout(90_000),
        },
      );
    } catch (error) {
      throw fail(
        `公众号草稿提交未完成：${error instanceof Error ? error.message : "网络异常"}`,
        502,
        true,
      );
    }
    const created = await jsonResponse(response, "写入公众号草稿箱");
    const mediaId = String(created.media_id || "");
    if (!mediaId) throw fail("公众号草稿接口未返回 media_id", 502, true);
    const verify = await fetch(
      `https://api.weixin.qq.com/cgi-bin/draft/get?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    await jsonResponse(verify, "核验公众号草稿");
    return { mediaId, detail: "已写入公众号草稿箱并完成回读核验" };
  } finally {
    publishingAccounts.delete(payload.accountId);
  }
}
