import { managerFetch } from "./runtime-client";

type Row = Record<string, string | number | null>;

function platformName(value: unknown) {
  return ({ xiaohongshu: "小红书", zhihu: "知乎", wechat: "微信公众号", douyin: "抖音", wechat_channels: "视频号" } as Record<string, string>)[String(value)] || String(value || "未知平台");
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function send(db: D1Database, entityType: "topic" | "published", entityId: string, title: string, markdown: string, deleted = false) {
  const link = await db.prepare("SELECT * FROM knowledge_sync_links WHERE provider='ima' AND entity_type=? AND entity_id=?").bind(entityType, entityId).first<Row>();
  const contentHash = await digest(markdown);
  if (!deleted && link?.content_hash === contentHash && link?.sync_status === "synced") return { skipped: true };
  const now = new Date().toISOString();
  try {
    const response = await managerFetch("/ima/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityType, entityId, title, markdown, noteId: link?.note_id || "", mediaId: link?.media_id || "" }) });
    const payload = await response.json() as { noteId?: string; mediaId?: string; skipped?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error || "IMA 同步失败");
    await db.prepare(`INSERT INTO knowledge_sync_links (provider,entity_type,entity_id,note_id,media_id,content_hash,sync_status,last_error,deleted_at,synced_at,updated_at)
      VALUES ('ima',?,?,?,?,?,'synced','',?,?,?) ON CONFLICT(provider,entity_type,entity_id) DO UPDATE SET note_id=excluded.note_id,media_id=excluded.media_id,content_hash=excluded.content_hash,sync_status='synced',last_error='',deleted_at=excluded.deleted_at,synced_at=excluded.synced_at,updated_at=excluded.updated_at`)
      .bind(entityType, entityId, payload.noteId || link?.note_id || "", payload.mediaId || link?.media_id || "", contentHash, deleted ? now : null, now, now).run();
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 800) : "IMA 同步失败";
    await db.prepare(`INSERT INTO knowledge_sync_links (provider,entity_type,entity_id,sync_status,last_error,updated_at) VALUES ('ima',?,?,'failed',?,?)
      ON CONFLICT(provider,entity_type,entity_id) DO UPDATE SET sync_status='failed',last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(entityType, entityId, message, now).run();
    return { error: message };
  }
}

export async function syncTopicToIma(db: D1Database, topicId: string, event: "created" | "deleted" = "created") {
  const topic = await db.prepare(`SELECT t.*,i.brief,i.pain_point,i.hook_points,i.content_structure,
    COALESCE(ts.detail_text,ars.detail_text,'') AS source_body
    FROM topics t LEFT JOIN topic_insights i ON i.topic_id=t.id
    LEFT JOIN trend_samples ts ON ts.feed_id=json_extract(i.source_feed_ids,'$[0]')
    LEFT JOIN article_research_samples ars ON ars.id=t.source_external_id WHERE t.id=?`).bind(topicId).first<Row>();
  if (!topic) return { skipped: true };
  const deleted = event === "deleted";
  const markdown = deleted
    ? `\n\n---\n## 已从平台删除\n\n删除时间：${new Date().toLocaleString("zh-CN")}\n\n> 此记录仅作为历史审计保留，平台已停止后续同步。\n`
    : `# ${topic.title}\n\n- 平台：${platformName(topic.platform)}\n- 状态：选题库\n- 来源：${topic.source_url || "平台手动创建"}\n- 创建时间：${topic.created_at}\n\n## 选题摘要\n\n${topic.brief || "暂无摘要"}\n\n## 原始正文\n\n${topic.source_body || "该选题没有可验证的来源正文。"}\n`;
  return send(db, "topic", topicId, `[选题] ${topic.title}`, markdown, deleted);
}

export async function syncPublishedToIma(db: D1Database, claimId: string) {
  const claim = await db.prepare(`SELECT c.*,t.title AS topic_title,t.source_url,t.platform,a.name AS account_name,u.name AS owner_name
    FROM claims c JOIN topics t ON t.id=c.topic_id JOIN accounts a ON a.id=c.account_id JOIN users u ON u.id=c.owner_id WHERE c.id=?`).bind(claimId).first<Row>();
  if (!claim || !["published", "drafted", "scheduled"].includes(String(claim.status))) return { skipped: true };
  const title = String(claim.title || claim.topic_title || "已发布内容");
  const markdown = `# ${title}\n\n- 平台：${platformName(claim.platform)}\n- 账号：${claim.account_name}\n- 负责人：${claim.owner_name}\n- 状态：${claim.status}\n- 发布时间：${claim.published_at || claim.updated_at}\n- 发布地址：${claim.published_url || "暂无"}\n- 来源选题：${claim.topic_title}\n- 原文地址：${claim.source_url || "暂无"}\n\n## 最终发布正文\n\n${claim.body || ""}\n`;
  return send(db, "published", claimId, `[发布] ${title}`, markdown);
}
