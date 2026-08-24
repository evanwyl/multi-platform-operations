import { createPasswordHash, currentUser, publicUser } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";

const statusLabels: Record<string, string> = {
  writing: "创作中", review: "待审核", revision: "待修改", approved: "待发布",
  queued: "发布队列", publishing: "发布中", published: "已发布", failed: "发布失败",
};

async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "content-type": "application/json" } });
  return user;
}

export async function GET(request: Request) {
  await ensureDatabase();
  let user;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const db = database();
  const [accounts, topics, claims, logs, users] = await Promise.all([
    db.prepare("SELECT * FROM accounts WHERE is_demo=0 ORDER BY updated_at, rowid").all(),
    db.prepare(`SELECT t.*,u.name AS creator_name,i.brief,i.target_audience,i.pain_point,i.hook_points,i.content_structure,
      i.why_it_works,i.account_fit,i.source_feed_ids,i.score,
      COALESCE(s.source_url,t.source_url) AS source_url,s.author_name AS source_author,s.keyword AS source_keyword,
      s.liked_count,s.collected_count,s.comment_count,s.heat_score,s.first_seen_at AS captured_at,
      s.published_at AS note_published_at,s.feed_id AS note_id,
      latest_claim.status AS claim_status,claim_owner.name AS claim_owner_name
      FROM topics t
      JOIN users u ON u.id=t.created_by
      LEFT JOIN topic_insights i ON i.topic_id=t.id
      LEFT JOIN trend_samples s ON s.feed_id=json_extract(i.source_feed_ids,'$[0]') OR (i.topic_id IS NULL AND s.source_url=t.source_url)
      LEFT JOIN claims latest_claim ON latest_claim.id=(SELECT c.id FROM claims c WHERE c.topic_id=t.id ORDER BY c.updated_at DESC LIMIT 1)
      LEFT JOIN users claim_owner ON claim_owner.id=latest_claim.owner_id
      WHERE t.archived_at IS NULL ORDER BY t.created_at DESC`).all(),
    db.prepare(`SELECT c.*,t.title AS topic_title,a.name AS account_name,a.color AS account_color,u.name AS owner_name
      FROM claims c JOIN topics t ON t.id=c.topic_id JOIN accounts a ON a.id=c.account_id JOIN users u ON u.id=c.owner_id
      WHERE a.is_demo=0 ORDER BY c.updated_at DESC`).all(),
    db.prepare("SELECT l.*,u.name AS actor_name FROM audit_logs l JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 50").all(),
    db.prepare("SELECT id,name,username,roles,status,created_at FROM users ORDER BY created_at").all(),
  ]);
  return Response.json({
    user: publicUser(user), accounts: accounts.results, topics: topics.results.map((topic) => ({
      ...topic,
      hook_points: topic.hook_points ? JSON.parse(String(topic.hook_points)) : [],
      content_structure: topic.content_structure ? JSON.parse(String(topic.content_structure)) : [],
      source_feed_ids: topic.source_feed_ids ? JSON.parse(String(topic.source_feed_ids)) : [],
    })),
    claims: claims.results.map((claim) => ({
      ...claim,
      status_label: statusLabels[String(claim.status)] ?? claim.status,
      tags: JSON.parse(String(claim.tags || "[]")),
      creative: JSON.parse(String(claim.creative_json || "{}")),
      publish_images: JSON.parse(String(claim.publish_images || "[]")),
      publish_snapshot: claim.snapshot ? JSON.parse(String(claim.snapshot)) : null,
    })),
    logs: logs.results, users: users.results.map((row) => ({ ...row, roles: JSON.parse(String(row.roles)) })),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  let user;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const db = database();
  const data = await request.json() as Record<string, unknown>;
  const action = String(data.action ?? "");
  const now = new Date().toISOString();

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

  if (action === "create_topic") {
    const title = String(data.title ?? "").trim();
    if (!title) return Response.json({ error: "请输入选题标题" }, { status: 400 });
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO topics (id,title,source_url,relevance,status,created_by,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, title, String(data.source_url ?? ""), String(data.relevance ?? "中"), "unclaimed", user.id, now).run();
    await audit(user.id, "创建选题", "topic", id, title);
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "claim_topic") {
    const topicId = String(data.topic_id ?? "");
    const accountId = String(data.account_id ?? "");
    if (!topicId || !accountId) return Response.json({ error: "请选择选题和账号" }, { status: 400 });
    const existing = await db.prepare("SELECT id FROM claims WHERE topic_id=? AND account_id=? AND status NOT IN ('published','archived')").bind(topicId, accountId).first();
    if (existing) return Response.json({ error: "该选题已被这个账号认领" }, { status: 409 });
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO claims (id,topic_id,account_id,owner_id,angle,status,created_at,updated_at) VALUES (?,?,?,?,?,'writing',?,?)")
        .bind(id, topicId, accountId, user.id, String(data.angle ?? ""), now, now),
      db.prepare("UPDATE topics SET status='claimed' WHERE id=?").bind(topicId),
    ]);
    await audit(user.id, "认领选题", "claim", id, String(data.angle ?? ""));
    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (action === "save_draft" || action === "import_codex") {
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT owner_id,status FROM claims WHERE id=?").bind(id).first<{ owner_id: string; status: string }>();
    if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
    if (claim.owner_id !== user.id && !JSON.parse(user.roles).includes("admin")) return Response.json({ error: "只有负责人可以编辑" }, { status: 403 });
    const tags = Array.isArray(data.tags) ? data.tags : String(data.tags ?? "").split(/[，,\s]+/).filter(Boolean);
    await db.prepare("UPDATE claims SET title=?,body=?,tags=?,status=CASE WHEN status='revision' THEN 'writing' ELSE status END,updated_at=? WHERE id=?")
      .bind(String(data.title ?? "").trim(), String(data.body ?? "").trim(), JSON.stringify(tags), now, id).run();
    await audit(user.id, action === "import_codex" ? "导入Codex结果" : "保存草稿", "claim", id);
    return Response.json({ ok: true });
  }

  if (action === "submit_review") {
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT owner_id,title,body FROM claims WHERE id=?").bind(id).first<{ owner_id: string; title: string; body: string }>();
    if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
    if (!claim.title.trim() || !claim.body.trim()) return Response.json({ error: "标题和正文填写完整后才能提交" }, { status: 400 });
    if (claim.owner_id !== user.id && !JSON.parse(user.roles).includes("admin")) return Response.json({ error: "只有负责人可以提交" }, { status: 403 });
    await db.prepare("UPDATE claims SET status='review',review_comment='',updated_at=? WHERE id=?").bind(now, id).run();
    await audit(user.id, "提交审核", "claim", id);
    return Response.json({ ok: true });
  }

  if (action === "review") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.some((role) => ["admin", "reviewer"].includes(role))) return Response.json({ error: "你没有审核权限" }, { status: 403 });
    const id = String(data.id ?? "");
    const result = data.result === "approve" ? "approved" : "revision";
    const comment = String(data.comment ?? "").trim();
    if (result === "revision" && !comment) return Response.json({ error: "退回时必须填写原因" }, { status: 400 });
    const claim = await db.prepare("SELECT title,body,tags,creative_json,version_number,status FROM claims WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!claim || claim.status !== "review") return Response.json({ error: "内容当前不在待审核状态" }, { status: 409 });
    const snapshot = result === "approved" ? JSON.stringify({
      title: claim.title,
      body: claim.body,
      tags: JSON.parse(String(claim.tags)),
      creative: JSON.parse(String(claim.creative_json || "{}")),
      version: claim.version_number,
      approved_at: now,
    }) : null;
    await db.prepare("UPDATE claims SET status=?,review_comment=?,reviewer_id=?,snapshot=?,updated_at=? WHERE id=?")
      .bind(result, comment, user.id, snapshot, now, id).run();
    await audit(user.id, result === "approved" ? "审核通过" : "审核退回", "claim", id, comment);
    return Response.json({ ok: true });
  }

  if (action === "queue_publish") {
    const roles = JSON.parse(user.roles) as string[];
    if (!roles.some((role) => ["admin", "publisher", "reviewer"].includes(role))) return Response.json({ error: "你没有发布权限" }, { status: 403 });
    const id = String(data.id ?? "");
    const claim = await db.prepare("SELECT status FROM claims WHERE id=?").bind(id).first<{ status: string }>();
    if (!claim || claim.status !== "approved") return Response.json({ error: "只有审核通过的内容才能排队" }, { status: 409 });
    await db.prepare("UPDATE claims SET status='queued',updated_at=? WHERE id=?").bind(now, id).run();
    await audit(user.id, "加入发布队列", "claim", id, "等待小红书MCP连接器执行");
    return Response.json({ ok: true });
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
