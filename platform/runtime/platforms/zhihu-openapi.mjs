import { createHmac, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function validAccountId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}

function credentialPath(root, accountId) {
  if (!validAccountId(accountId)) throw Object.assign(new Error("知乎账号标识不合法"), { status: 400 });
  const accountRoot = resolve(root, accountId);
  if (!accountRoot.startsWith(`${resolve(root)}/`)) throw Object.assign(new Error("知乎账号路径不合法"), { status: 400 });
  return { accountRoot, path: join(accountRoot, "openapi.json") };
}

function readCredentials(root, accountId) {
  const { path } = credentialPath(root, accountId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed.appKey !== "string" || typeof parsed.appSecret !== "string" || !parsed.appKey.trim() || !parsed.appSecret.trim()) return null;
    return { appKey: parsed.appKey.trim(), appSecret: parsed.appSecret.trim() };
  } catch { return null; }
}

export function zhihuAuthStatus(root, accountId) {
  const credentials = readCredentials(root, accountId);
  return { configured: Boolean(credentials), auth_method: credentials ? "openapi" : "" };
}

export function saveZhihuCredentials(root, accountId, appKey, appSecret) {
  if (typeof appKey !== "string" || !/^[a-zA-Z0-9_-]{2,128}$/.test(appKey.trim())) throw Object.assign(new Error("知乎用户 Token 格式不合法"), { status: 400 });
  if (typeof appSecret !== "string" || appSecret.trim().length < 16 || appSecret.length > 512) throw Object.assign(new Error("知乎开放平台访问密钥格式不合法"), { status: 400 });
  const { accountRoot, path } = credentialPath(root, accountId);
  mkdirSync(accountRoot, { recursive: true, mode: 0o700 });
  chmodSync(accountRoot, 0o700);
  writeFileSync(path, `${JSON.stringify({ appKey: appKey.trim(), appSecret: appSecret.trim(), savedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { configured: true, auth_method: "openapi" };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function plainTextToArticleHtml(value) {
  return String(value).trim().split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("\n");
}

export async function publishZhihuArticle(root, payload) {
  const credentials = readCredentials(root, payload.accountId);
  if (!credentials) throw Object.assign(new Error("该知乎账号尚未配置开放平台访问密钥"), { status: 409 });
  const title = String(payload.title || "").trim();
  const html = String(payload.html || plainTextToArticleHtml(payload.body || "")).trim();
  if (!title || !html) throw Object.assign(new Error("知乎专栏缺少标题或正文"), { status: 400 });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const logId = `hongshutai-${randomUUID()}`;
  const extraInfo = "";
  const signInput = `app_key:${credentials.appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`;
  const signature = createHmac("sha256", credentials.appSecret).update(signInput).digest("base64");
  const content = {
    title,
    html,
    comment_permission: payload.commentPermission || "all",
    table_of_contents_enabled: payload.tableOfContentsEnabled === true,
  };
  if (payload.creationStatement) content.creation_statement = payload.creationStatement;
  if (Array.isArray(payload.topics) && payload.topics.length) content.topics = payload.topics.slice(0, 3);
  let response;
  try {
    response = await fetch("https://openapi.zhihu.com/openapi/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-key": credentials.appKey,
        "x-timestamp": timestamp,
        "x-log-id": logId,
        "x-extra-info": extraInfo,
        "x-sign": signature,
      },
      body: JSON.stringify({ type: "article", confirmed: true, confirm_note: "confirmed by user in HongShuTai", content }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw Object.assign(new Error(`知乎发布请求未完成：${error instanceof Error ? error.message : "网络异常"}`), { uncertain: true });
  }
  let result;
  try { result = await response.json(); } catch { throw Object.assign(new Error(`知乎返回了无法解析的响应（HTTP ${response.status}）`), { uncertain: true }); }
  if (!response.ok || Number(result?.status) !== 0) {
    const message = String(result?.msg || `知乎发布失败（HTTP ${response.status}）`).slice(0, 500);
    throw Object.assign(new Error(message), { status: response.status, uncertain: response.status >= 500 });
  }
  return { contentToken: String(result.data?.content_token || ""), url: String(result.data?.url || ""), detail: `知乎专栏已发布${result.data?.url ? `：${result.data.url}` : ""}` };
}
