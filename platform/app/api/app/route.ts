import { createPasswordHash, currentUser, publicUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";

const statusLabels: Record<string, string> = {
  writing: "创作中", review: "待审核", revision: "待修改", approved: "待发布",
  queued: "发布队列", publishing: "发布中", published: "已发布", failed: "发布失败",
};

async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "content-type": "application/json" } });
  return user;
}

function cleanTextList(value: unknown, max: number) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[，,\n]/);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].slice(0, max);
}

function parseTextList(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

type AISettings = { configured: boolean; baseUrl: string; model: string; keySource: string; busy?: boolean; unavailable?: boolean };
type DbRow = Record<string, string | number | null>;
type ReviewFile = { name?: string; type?: string; data?: string };

async function runtimeAI(path: "settings" | "test", options?: RequestInit) {
  let response: Response;
  try { response = await managerFetch(`/ai/${path}`, options); }
  catch { throw new Error("本机 AI 运行管理器未启动"); }
  const payload = await response.json() as AISettings & { error?: string };
  if (!response.ok) throw new Error(payload.error || "AI 配置操作失败");
  return payload;
}

export async function GET(request: Request) {
  await ensureDatabase();
  let user;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const db = database();
  const [accounts, topics, claims, logs, users, aiSettings] = await Promise.all([
    db.prepare("SELECT * FROM accounts WHERE is_demo=0 ORDER BY updated_at, rowid").all<DbRow>(),
    db.prepare(`SELECT t.*,u.name AS creator_name,i.brief,i.target_audience,i.pain_point,i.hook_points,i.content_structure,
      i.why_it_works,i.account_fit,i.source_feed_ids,i.score,
      COALESCE(s.source_url,t.source_url) AS source_url,s.author_name AS source_author,s.keyword AS source_keyword,
      s.liked_count,s.collected_count,s.comment_count,s.heat_score,s.first_seen_at AS captured_at,
      s.published_at AS note_published_at,s.feed_id AS note_id,s.processing_status AS source_processing_status,
      CASE WHEN s.processing_status='success' AND s.detail_text!='' THEN 1 ELSE 0 END AS source_detail_verified,
      latest_claim.status AS claim_status,claim_owner.name AS claim_owner_name
      FROM topics t
      JOIN users u ON u.id=t.created_by
      LEFT JOIN topic_insights i ON i.topic_id=t.id
      LEFT JOIN trend_samples s ON s.feed_id=json_extract(i.source_feed_ids,'$[0]') OR (i.topic_id IS NULL AND s.source_url=t.source_url)
      LEFT JOIN claims latest_claim ON latest_claim.id=(SELECT c.id FROM claims c WHERE c.topic_id=t.id ORDER BY c.updated_at DESC LIMIT 1)
      LEFT JOIN users claim_owner ON claim_owner.id=latest_claim.owner_id
      WHERE t.archived_at IS NULL ORDER BY t.created_at DESC`).all<DbRow>(),
    db.prepare(`SELECT c.*,t.title AS topic_title,a.name AS account_name,a.color AS account_color,u.name AS owner_name,
      publisher.name AS publisher_name
      FROM claims c JOIN topics t ON t.id=c.topic_id JOIN accounts a ON a.id=c.account_id JOIN users u ON u.id=c.owner_id
      LEFT JOIN users publisher ON publisher.id=c.publisher_id
      WHERE a.is_demo=0 ORDER BY c.updated_at DESC`).all<DbRow>(),
    db.prepare("SELECT l.*,u.name AS actor_name FROM audit_logs l JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 50").all<DbRow>(),
    db.prepare("SELECT id,name,username,roles,status,created_at FROM users WHERE status='active' ORDER BY created_at").all<DbRow>(),
    runtimeAI("settings").catch(() => ({ configured: false, baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", keySource: "none", unavailable: true })),
  ]);
  return Response.json({
    user: publicUser(user), accounts: accounts.results.map((account) => ({
      ...account,
      content_pillars: parseTextList(account.content_pillars),
      strategy_keywords: parseTextList(account.strategy_keywords),
      excluded_topics: parseTextList(account.excluded_topics),
    })), topics: topics.results.map((topic) => ({
      ...topic,
      hook_points: topic.hook_points ? JSON.parse(String(topic.hook_points)) : [],
      content_structure: topic.content_structure ? JSON.parse(String(topic.content_structure)) : [],
      source_feed_ids: topic.source_feed_ids ? JSON.parse(String(topic.source_feed_ids)) : [],
    })),
    claims: claims.results.map((claim) => ({
      ...claim,
      status_label: statusLabels[String(claim.status)] ?? claim.status,
      publish_recoverable: claim.status === "publishing" && Date.now() - Date.parse(String(claim.updated_at)) >= 8 * 60 * 1000,
      tags: JSON.parse(String(claim.tags || "[]")),
      creative: JSON.parse(String(claim.creative_json || "{}")),
      publish_images: JSON.parse(String(claim.publish_images || "[]")),
      publish_snapshot: claim.snapshot ? JSON.parse(String(claim.snapshot)) : null,
    })),
    logs: logs.results, users: users.results.map((row) => ({ ...row, roles: JSON.parse(String(row.roles)) })), ai_settings: aiSettings,
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  let user;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const db = database();
  const data = await request.json() as Record<string, unknown>;
  const action = String(data.action ?? "");
  const now = new Date().toISOString();

  if (action === "save_ai_settings" || action === "test_ai_settings") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.includes("admin")) return Response.json({ error: "只有管理员可以修改 AI 配置" }, { status: 403 });
    try {
      if (action === "test_ai_settings") return Response.json(await runtimeAI("test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: data.base_url, model: data.model, apiKey: data.api_key }),
      }));
      const payload = await runtimeAI("settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: data.base_url, model: data.model, apiKey: data.api_key }),
      });
      await audit(user.id, "更新AI配置", "settings", "ai", `${payload.baseUrl} / ${payload.model}`);
      return Response.json(payload);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "AI 配置操作失败" }, { status: 502 });
    }
  }

  if (action === "create_account") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.includes("admin")) return Response.json({ error: "只有管理员可以添加小红书账号" }, { status: 403 });
    const name = String(data.name ?? "").trim();
    if (!name) return Response.json({ error: "请填写账号备注名称" }, { status: 400 });
    const colors = ["#6846d6", "#178f78", "#d5723b", "#3d79c5", "#c9465d"];
    const id = crypto.randomUUID();
    const count = await db.prepare("SELECT COUNT(*) AS total FROM accounts WHERE is_demo=0").first<{ total: number }>();
    if ((count?.total ?? 0) >= 5) return Response.json({ error: "当前版本最多管理5个小红书账号" }, { status: 409 });
    await db.prepare("INSERT INTO accounts (id,name,status,color,is_demo,updated_at) VALUES (?,?,'login_expired',?,0,?)")
      .bind(id, name, colors[(count?.total ?? 0) % colors.length], now).run();
    await audit(user.id, "添加小红书账号", "account", id, name);
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "update_account_strategy") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.includes("admin")) return Response.json({ error: "只有管理员可以修改账号定位" }, { status: 403 });
    const accountId = String(data.account_id ?? "");
    const account = await db.prepare("SELECT id,name FROM accounts WHERE id=? AND is_demo=0").bind(accountId).first<{ id: string; name: string }>();
    if (!account) return Response.json({ error: "账号不存在" }, { status: 404 });
    const persona = String(data.persona ?? "").trim().slice(0, 500);
    const audience = String(data.audience ?? "").trim().slice(0, 500);
    const pillars = cleanTextList(data.content_pillars, 6);
    const keywords = cleanTextList(data.strategy_keywords, 15);
    const excludes = cleanTextList(data.excluded_topics, 20);
    if (!persona || !audience) return Response.json({ error: "请填写账号定位和目标受众" }, { status: 400 });
    if (pillars.length < 2) return Response.json({ error: "请至少填写2个内容支柱" }, { status: 400 });
    if (keywords.length < 3) return Response.json({ error: "请至少填写3个策略关键词" }, { status: 400 });
    await db.prepare("UPDATE accounts SET persona=?,audience=?,content_pillars=?,strategy_keywords=?,excluded_topics=?,updated_at=? WHERE id=?")
      .bind(persona, audience, JSON.stringify(pillars), JSON.stringify(keywords), JSON.stringify(excludes), now, account.id).run();
    await audit(user.id, "更新账号内容定位", "account", account.id, `${account.name} / ${pillars.join("、")} / ${keywords.join("、")}`);
    return Response.json({ ok: true });
  }

  if (action === "create_user") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.includes("admin")) return Response.json({ error: "只有管理员可以添加成员" }, { status: 403 });
    const username = String(data.username ?? "").trim().toLowerCase();
    const password = String(data.password ?? "");
    const name = String(data.name ?? "").trim();
    if (!name || !/^[a-z0-9_-]{3,24}$/.test(username) || password.length < 8) return Response.json({ error: "请填写姓名、合法用户名和至少8位密码" }, { status: 400 });
    const role = ["operator", "reviewer", "publisher", "readonly"].includes(String(data.role)) ? String(data.role) : "operator";
    const id = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO users (id,name,username,password_hash,roles,status,created_at) VALUES (?,?,?,?,?,'active',?)")
        .bind(id, name, username, await createPasswordHash(password), JSON.stringify([role]), now).run();
    } catch { return Response.json({ error: "用户名已经存在" }, { status: 409 }); }
    await audit(user.id, "添加团队成员", "user", id, `${name} / ${role}`);
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "remove_user") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.includes("admin")) return Response.json({ error: "只有管理员可以删除成员" }, { status: 403 });
    const targetId = String(data.user_id ?? "");
    if (!targetId) return Response.json({ error: "请选择要删除的成员" }, { status: 400 });
    if (targetId === user.id) return Response.json({ error: "管理员不能删除自己的当前账号" }, { status: 409 });
    const target = await db.prepare("SELECT id,name,status FROM users WHERE id=?").bind(targetId).first<{ id: string; name: string; status: string }>();
    if (!target || target.status !== "active") return Response.json({ error: "成员不存在或已经删除" }, { status: 404 });
    await db.batch([
      db.prepare("UPDATE users SET status='disabled' WHERE id=?").bind(target.id),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id),
    ]);
    await audit(user.id, "删除团队成员", "user", target.id, `${target.name}（已撤销登录，历史记录保留）`);
    return Response.json({ ok: true });
  }

  if (action === "create_topic") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以创建选题");
    const title = String(data.title ?? "").trim();
    if (!title) return Response.json({ error: "请输入选题标题" }, { status: 400 });
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO topics (id,title,source_url,relevance,status,created_by,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, title, String(data.source_url ?? ""), String(data.relevance ?? "中"), "unclaimed", user.id, now).run();
    await audit(user.id, "创建选题", "topic", id, title);
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "archive_topics_bulk") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以删除选题");
    const topicIds = [...new Set((Array.isArray(data.topic_ids) ? data.topic_ids : []).map(String).filter(Boolean))].slice(0, 200);
    if (!topicIds.length) return Response.json({ error: "请选择要删除的选题" }, { status: 400 });
    const placeholders = topicIds.map(() => "?").join(",");
    const activeTopics = await db.prepare(`SELECT id FROM topics WHERE archived_at IS NULL AND id IN (${placeholders})`)
      .bind(...topicIds).all<{ id: string }>();
    if (!activeTopics.results.length) return Response.json({ error: "所选选题不存在或已经删除" }, { status: 404 });
    await db.batch(activeTopics.results.map((topic) => db.prepare("UPDATE topics SET archived_at=? WHERE id=? AND archived_at IS NULL").bind(now, topic.id)));
    await audit(user.id, "批量删除选题", "topic", "bulk", `${activeTopics.results.length} 个选题（历史内容任务保留）`);
    return Response.json({ ok: true, archived: activeTopics.results.length });
  }

  if (action === "claim_topic") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以认领选题");
    const topicId = String(data.topic_id ?? "");
    const accountId = String(data.account_id ?? "");
    if (!topicId || !accountId) return Response.json({ error: "请选择选题和账号" }, { status: 400 });
    const source = await db.prepare(`SELECT s.feed_id,s.processing_status,s.detail_text FROM topics t
      LEFT JOIN topic_insights i ON i.topic_id=t.id LEFT JOIN trend_samples s ON s.feed_id=json_extract(i.source_feed_ids,'$[0]')
      WHERE t.id=?`).bind(topicId).first<{ feed_id: string | null; processing_status: string | null; detail_text: string | null }>();
    if (source?.feed_id && (source.processing_status !== "success" || !source.detail_text)) {
      return Response.json({ error: "这个自动选题的来源正文尚未验证，暂时不能认领创作" }, { status: 409 });
    }
    const existing = await db.prepare("SELECT id FROM claims WHERE topic_id=? AND account_id=? AND status NOT IN ('published','archived')").bind(topicId, accountId).first();
    if (existing) return Response.json({ error: "该选题已被这个账号认领" }, { status: 409 });
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare("INSERT INTO claims (id,topic_id,account_id,owner_id,angle,status,created_at,updated_at) VALUES (?,?,?,?,?,'writing',?,?)")
          .bind(id, topicId, accountId, user.id, String(data.angle ?? ""), now, now),
        db.prepare("UPDATE topics SET status='claimed' WHERE id=?").bind(topicId),
      ]);
    } catch (error) {
      const competingClaim = await db.prepare("SELECT id FROM claims WHERE topic_id=? AND account_id=? AND status NOT IN ('published','archived')")
        .bind(topicId, accountId).first();
      if (competingClaim) return Response.json({ error: "该选题刚刚已被这个账号认领，请刷新列表" }, { status: 409 });
      throw error;
    }
    await audit(user.id, "认领选题", "claim", id, String(data.angle ?? ""));
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "save_draft") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以保存草稿");
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT owner_id,status FROM claims WHERE id=?").bind(id).first<{ owner_id: string; status: string }>();
    if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
    const tags = Array.isArray(data.tags) ? data.tags : String(data.tags ?? "").split(/[，,\s]+/).filter(Boolean);
    await db.prepare("UPDATE claims SET title=?,body=?,tags=?,status=CASE WHEN status='revision' THEN 'writing' ELSE status END,updated_at=? WHERE id=?")
      .bind(String(data.title ?? "").trim(), String(data.body ?? "").trim(), JSON.stringify(tags), now, id).run();
    await audit(user.id, "保存草稿", "claim", id);
    return Response.json({ ok: true });
  }

  if (action === "upload_review_images") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以上传审核图片");
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT id,status FROM claims WHERE id=?").bind(id).first<{ id: string; status: string }>();
    if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
    if (!["writing", "revision"].includes(claim.status)) return Response.json({ error: "只有创作中或待修改的内容可以更换图片" }, { status: 409 });
    const files = (Array.isArray(data.files) ? data.files : []).slice(0, 9) as ReviewFile[];
    if (!files.length || files.some((file) => !file.data || !file.type)) return Response.json({ error: "请选择1-9张有效图片" }, { status: 400 });
    const response = await managerFetch("/publish-assets", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: id, files }),
    }).catch(() => null);
    if (!response) return Response.json({ error: "本机图片保存服务未启动" }, { status: 503 });
    const payload = await response.json() as { paths?: string[]; error?: string };
    if (!response.ok || !payload.paths?.length) return Response.json({ error: payload.error || "图片保存失败" }, { status: 502 });
    const result = await db.prepare("UPDATE claims SET publish_images=?,updated_at=? WHERE id=? AND status IN ('writing','revision')")
      .bind(JSON.stringify(payload.paths), now, id).run();
    if (!result.meta.changes) return Response.json({ error: "内容状态已变化，无法更换图片" }, { status: 409 });
    await audit(user.id, "上传内容审核图片", "claim", id, `${payload.paths.length} 张图片`);
    return Response.json({ ok: true, count: payload.paths.length });
  }

  if (action === "submit_review") {
    if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以提交审核");
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT owner_id,title,body,publish_images,status FROM claims WHERE id=?").bind(id).first<{ owner_id: string; title: string; body: string; publish_images: string; status: string }>();
    if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
    if (!["writing", "revision"].includes(claim.status)) return Response.json({ error: "只有创作中或待修改的内容可以提交审核" }, { status: 409 });
    if (!claim.title.trim() || !claim.body.trim()) return Response.json({ error: "标题和正文填写完整后才能提交" }, { status: 400 });
    const images = JSON.parse(claim.publish_images || "[]") as string[];
    if (!images.length) return Response.json({ error: "请先上传至少一张最终图片，再提交图文审核" }, { status: 400 });
    await db.prepare("UPDATE claims SET status='review',review_comment='',updated_at=? WHERE id=? AND status IN ('writing','revision')").bind(now, id).run();
    await audit(user.id, "提交审核", "claim", id);
    return Response.json({ ok: true });
  }

  if (action === "review") {
    if (!can(user, roleGroups.review)) return forbidden("你没有审核权限");
    const id = String(data.id ?? "");
    const result = data.result === "approve" ? "approved" : "revision";
    const comment = String(data.comment ?? "").trim();
    if (result === "revision" && !comment) return Response.json({ error: "退回时必须填写原因" }, { status: 400 });
    const claim = await db.prepare("SELECT title,body,tags,creative_json,version_number,publish_images,status FROM claims WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!claim || claim.status !== "review") return Response.json({ error: "内容当前不在待审核状态" }, { status: 409 });
    const reviewImages = JSON.parse(String(claim.publish_images || "[]")) as string[];
    if (result === "approved" && !reviewImages.length) return Response.json({ error: "缺少最终图片，不能通过图文审核" }, { status: 400 });
    const snapshot = result === "approved" ? JSON.stringify({
      title: claim.title,
      body: claim.body,
      tags: JSON.parse(String(claim.tags)),
      creative: JSON.parse(String(claim.creative_json || "{}")),
      images: reviewImages,
      version: claim.version_number,
      approved_at: now,
    }) : null;
    await db.prepare("UPDATE claims SET status=?,review_comment=?,reviewer_id=?,snapshot=?,updated_at=? WHERE id=?")
      .bind(result, comment, user.id, snapshot, now, id).run();
    await audit(user.id, result === "approved" ? "审核通过" : "审核退回", "claim", id, comment);
    return Response.json({ ok: true });
  }

  if (action === "queue_publish") {
    if (!can(user, [...roleGroups.review, "publisher"])) return forbidden("你没有转入发布队列的权限");
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT status FROM claims WHERE id=?").bind(id).first<{ status: string }>();
    if (!claim || claim.status !== "approved") return Response.json({ error: "只有审核通过的内容才能排队" }, { status: 409 });
    await db.prepare("UPDATE claims SET status='queued',updated_at=? WHERE id=?").bind(now, id).run();
    await audit(user.id, "加入发布队列", "claim", id, "等待小红书MCP连接器执行");
    return Response.json({ ok: true });
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
