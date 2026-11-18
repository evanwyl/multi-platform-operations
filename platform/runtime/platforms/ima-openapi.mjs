import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = "https://ima.qq.com/openapi";

function configPath(configRoot) {
  return join(configRoot, "ima.json");
}

function readConfig(configRoot) {
  try {
    return JSON.parse(readFileSync(configPath(configRoot), "utf8"));
  } catch {
    return {};
  }
}

function publicConfig(configRoot) {
  const value = readConfig(configRoot);
  return {
    configured: Boolean(value.clientId && value.apiKey && value.knowledgeBaseId),
    clientId: value.clientId ? `${String(value.clientId).slice(0, 6)}••••` : "",
    knowledgeBaseId: String(value.knowledgeBaseId || ""),
    knowledgeBaseName: String(value.knowledgeBaseName || ""),
    syncTopics: value.syncTopics !== false,
    syncPublished: value.syncPublished !== false,
  };
}

async function callIma(credentials, path, payload) {
  const response = await fetch(`${API_ROOT}/${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "ima-openapi-clientid": credentials.clientId,
      "ima-openapi-apikey": credentials.apiKey,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || (result.code !== undefined && Number(result.code) !== 0)) {
    throw Object.assign(new Error(String(result.message || result.msg || `IMA 请求失败（${response.status}）`)), { status: 502 });
  }
  return result.data ?? result;
}

export function imaSettings(configRoot) {
  return publicConfig(configRoot);
}

export async function testImaSettings(configRoot, payload) {
  const current = readConfig(configRoot);
  const credentials = {
    clientId: String(payload.clientId || "").trim() || current.clientId,
    apiKey: String(payload.apiKey || "").trim() || current.apiKey,
  };
  if (!credentials.clientId || !credentials.apiKey)
    throw Object.assign(new Error("请填写 IMA Client ID 和 API Key"), { status: 400 });
  const data = await callIma(credentials, "wiki/v1/get_addable_knowledge_base_list", { cursor: "", limit: 50 });
  const list = data.addable_knowledge_base_list || data.knowledge_base_list || data.list || data.knowledge_bases || [];
  return { ok: true, knowledgeBases: list.map((item) => ({ id: String(item.knowledge_base_id || item.id || ""), name: String(item.name || item.title || "未命名知识库") })).filter((item) => item.id) };
}

export function saveImaSettings(configRoot, payload) {
  const current = readConfig(configRoot);
  const next = {
    clientId: String(payload.clientId || "").trim() || current.clientId,
    apiKey: String(payload.apiKey || "").trim() || current.apiKey,
    knowledgeBaseId: String(payload.knowledgeBaseId || "").trim(),
    knowledgeBaseName: String(payload.knowledgeBaseName || "").trim(),
    syncTopics: payload.syncTopics !== false,
    syncPublished: payload.syncPublished !== false,
  };
  if (!next.clientId || !next.apiKey || !next.knowledgeBaseId)
    throw Object.assign(new Error("请完成 IMA 凭证测试并选择知识库"), { status: 400 });
  mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  const target = configPath(configRoot);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
  return publicConfig(configRoot);
}

export async function syncImaRecord(configRoot, payload) {
  const config = readConfig(configRoot);
  if (!config.clientId || !config.apiKey || !config.knowledgeBaseId)
    throw Object.assign(new Error("IMA 尚未配置"), { status: 409 });
  if (payload.entityType === "topic" && config.syncTopics === false) return { skipped: true };
  if (payload.entityType === "published" && config.syncPublished === false) return { skipped: true };
  const credentials = { clientId: config.clientId, apiKey: config.apiKey };
  if (payload.noteId) {
    await callIma(credentials, "note/v1/append_doc", { note_id: payload.noteId, content_format: 1, content: String(payload.markdown || "") });
    return { noteId: payload.noteId, mediaId: payload.mediaId || "" };
  }
  const imported = await callIma(credentials, "note/v1/import_doc", { content_format: 1, content: String(payload.markdown || "") });
  const noteId = String(imported.note_id || imported.content_id || "");
  if (!noteId) throw Object.assign(new Error("IMA 未返回笔记标识"), { status: 502 });
  const added = await callIma(credentials, "wiki/v1/add_knowledge", {
    media_type: 11,
    title: String(payload.title || "平台内容记录").slice(0, 120),
    knowledge_base_id: config.knowledgeBaseId,
    note_info: { content_id: noteId },
  });
  return { noteId, mediaId: String(added.media_id || added.knowledge_id || "") };
}
