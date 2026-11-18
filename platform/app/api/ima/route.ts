import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { database, ensureDatabase } from "../../../lib/database";
import { managerFetch } from "../../../lib/runtime-client";
import { syncPublishedToIma, syncTopicToIma } from "../../../lib/ima-sync";

async function requireAdmin(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "content-type": "application/json" } });
  if (!user.roles.includes("admin")) throw new Response(JSON.stringify({ error: "只有管理员可以配置 IMA" }), { status: 403, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  try { await requireAdmin(request); } catch (response) { return response as Response; }
  const data = await request.json() as Record<string, unknown>;
  const action = String(data.action || "");
  if (action === "test" || action === "save") {
    const response = await managerFetch(action === "test" ? "/ima/test" : "/ima/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: data.client_id, apiKey: data.api_key, knowledgeBaseId: data.knowledge_base_id, knowledgeBaseName: data.knowledge_base_name, syncTopics: data.sync_topics, syncPublished: data.sync_published }) });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  }
  if (action === "sync_history") {
    const db = database();
    const topics = await db.prepare("SELECT id FROM topics WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 200").all<{ id: string }>();
    const claims = await db.prepare("SELECT id FROM claims WHERE status IN ('published','drafted','scheduled') ORDER BY updated_at DESC LIMIT 200").all<{ id: string }>();
    const deletedTopics = await db.prepare(`SELECT t.id FROM topics t JOIN knowledge_sync_links k ON k.entity_type='topic' AND k.entity_id=t.id AND k.sync_status='failed' WHERE t.archived_at IS NOT NULL LIMIT 100`).all<{ id: string }>();
    const results: Array<Record<string, unknown>> = [];
    for (const topic of topics.results) results.push(await syncTopicToIma(db, topic.id));
    for (const claim of claims.results) results.push(await syncPublishedToIma(db, claim.id));
    for (const topic of deletedTopics.results) results.push(await syncTopicToIma(db, topic.id, "deleted"));
    return Response.json({ ok: true, synced: results.filter((item) => !item.error).length, failed: results.filter((item) => item.error).length });
  }
  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
