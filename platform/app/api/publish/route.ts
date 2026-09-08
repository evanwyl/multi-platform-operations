import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { callMcpTool, checkMcpLogin } from "../../../lib/xhs-mcp";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";

type PublishClaim = {
  id: string; account_id: string; account_name: string; account_status: string;
  xhs_user_id: string | null; xhs_nickname: string | null; status: string;
  snapshot: string | null; publish_images: string; title: string; body: string; tags: string; updated_at: string;
};

const PUBLISH_TIMEOUT_MS = 6 * 60 * 1000;
const INTERRUPTED_RECOVERY_MS = PUBLISH_TIMEOUT_MS + 2 * 60 * 1000;

function isUncertainPublishError(message: string) {
  return /超过\s*\d+\s*分钟|执行中断|连接已中断|页面加载超时|状态暂时无法确认/i.test(message);
}

async function runtime(path: "acquire" | "release" | "discard", accountId: string) {
  const response = await managerFetch(`/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, purpose: "worker" }),
  }).catch(() => null);
  if (!response) throw new Error("小红书运行管理器未启动");
  const payload = await response.json() as { port?: number; error?: string };
  if (!response.ok) throw new Error(payload.error || "无法分配小红书运行槽位");
  return payload;
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, roleGroups.publish)) return forbidden("你没有发布权限");
  const data = await request.json() as { action?: string; claim_id?: string; reason?: string; outcome?: string };
  const claimId = String(data.claim_id ?? "");
  const db = database();
  const claim = await db.prepare(`SELECT c.id,c.account_id,c.status,c.snapshot,c.publish_images,c.title,c.body,c.tags,c.updated_at,
    a.name AS account_name,a.status AS account_status,a.xhs_user_id,a.xhs_nickname
    FROM claims c JOIN accounts a ON a.id=c.account_id WHERE c.id=? AND a.is_demo=0`).bind(claimId).first<PublishClaim>();
  if (!claim) return Response.json({ error: "发布任务不存在" }, { status: 404 });

  if (data.action === "return_for_revision") {
    if (!["approved", "queued", "failed"].includes(claim.status)) {
      return Response.json({ error: claim.status === "publishing" ? "内容正在发布，不能同时退回修改" : "只有尚未发布的内容可以退回修改" }, { status: 409 });
    }
    const reason = String(data.reason ?? "").trim();
    if (!reason) return Response.json({ error: "退回修改时必须填写原因" }, { status: 400 });
    const returnedAt = new Date().toISOString();
    const result = await db.prepare(`UPDATE claims SET status='revision',review_comment=?,publisher_id=NULL,publish_error='',updated_at=?
      WHERE id=? AND status IN ('approved','queued','failed')`).bind(reason.slice(0, 500), returnedAt, claim.id).run();
    if (!result.meta.changes) return Response.json({ error: "任务状态已变化，请刷新后重试" }, { status: 409 });
    await audit(user.id, "发布前退回修改", "claim", claim.id, `${claim.account_name} / ${reason.slice(0, 300)}`);
    return Response.json({ ok: true, status: "revision" });
  }

  if (data.action === "resolve_interrupted") {
    const age = Date.now() - Date.parse(claim.updated_at);
    if (claim.status !== "publishing" || !Number.isFinite(age) || age < INTERRUPTED_RECOVERY_MS) {
      return Response.json({ error: "只有超过8分钟仍处于发布中的任务可以人工核对" }, { status: 409 });
    }
    const outcome = data.outcome === "published" ? "published" : data.outcome === "failed" ? "failed" : "";
    const reason = String(data.reason ?? "").trim().slice(0, 500);
    if (!outcome || !reason) return Response.json({ error: "请选择核对结果并填写说明" }, { status: 400 });
    const resolvedAt = new Date().toISOString();
    const activeJob = await db.prepare(`SELECT id FROM publish_jobs WHERE claim_id=? AND status IN ('publishing','uncertain')
      ORDER BY created_at DESC LIMIT 1`).bind(claim.id).first<{ id: string }>();
    const result = outcome === "published"
      ? await db.prepare(`UPDATE claims SET status='published',publisher_id=?,published_at=?,publish_error='',updated_at=?
          WHERE id=? AND status='publishing' AND updated_at=?`).bind(user.id, resolvedAt, resolvedAt, claim.id, claim.updated_at).run()
      : await db.prepare(`UPDATE claims SET status='failed',publisher_id=?,publish_error=?,updated_at=?
          WHERE id=? AND status='publishing' AND updated_at=?`).bind(user.id, reason, resolvedAt, claim.id, claim.updated_at).run();
    if (!result.meta.changes) return Response.json({ error: "任务已被其他人处理，请刷新列表" }, { status: 409 });
    if (activeJob) {
      await db.batch([
        db.prepare(`UPDATE publish_jobs SET status=?,last_error=?,updated_at=?,completed_at=? WHERE id=? AND status IN ('publishing','uncertain')`)
          .bind(outcome === "published" ? "succeeded" : "failed", outcome === "failed" ? reason : "", resolvedAt, resolvedAt, activeJob.id),
        db.prepare(`UPDATE publish_attempts SET status=?,error=?,completed_at=? WHERE job_id=? AND status IN ('publishing','uncertain')`)
          .bind(outcome === "published" ? "succeeded" : "failed", outcome === "failed" ? reason : "", resolvedAt, activeJob.id),
      ]);
    }
    await audit(user.id, outcome === "published" ? "人工确认中断任务已发布" : "人工确认中断任务未发布", "claim", claim.id, reason);
    return Response.json({ ok: true, status: outcome });
  }

  if (data.action === "publish_now") {
    if (!["approved", "queued", "failed"].includes(claim.status)) return Response.json({ error: "当前内容不能执行发布" }, { status: 409 });
    if (!claim.xhs_user_id) return Response.json({ error: `${claim.account_name} 尚未完成登录和身份绑定` }, { status: 409 });
    const frozen = claim.snapshot ? JSON.parse(claim.snapshot) as { title?: string; body?: string; tags?: string[]; images?: string[] } : null;
    const images = Array.isArray(frozen?.images) ? frozen.images : [];
    if (!images.length) return Response.json({ error: "审核快照中没有图片，请退回创作页补充后重新审核" }, { status: 400 });
    const title = String(frozen?.title || claim.title || "").trim();
    const body = String(frozen?.body || claim.body || "").trim();
    const tags = Array.isArray(frozen?.tags) ? frozen.tags : JSON.parse(claim.tags || "[]") as string[];
    if (!title || !body) return Response.json({ error: "审核快照缺少标题或正文，无法发布" }, { status: 409 });
    const startedAt = new Date().toISOString();
    const claimResult = await db.prepare(`UPDATE claims SET status='publishing',publisher_id=?,publish_error='',updated_at=?
      WHERE id=? AND status IN ('approved','queued','failed')`).bind(user.id, startedAt, claim.id).run();
    if (!claimResult.meta.changes) {
      return Response.json({ error: "这篇内容已被其他发布任务处理，请刷新列表确认状态" }, { status: 409 });
    }
    const jobId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare(`INSERT INTO publish_jobs
          (id,claim_id,idempotency_key,status,requested_by,attempt_count,last_error,result_detail,created_at,updated_at)
          VALUES (?,?,?,'publishing',?,1,'','',?,?)`).bind(jobId, claim.id, idempotencyKey, user.id, startedAt, startedAt),
        db.prepare(`INSERT INTO publish_attempts
          (id,job_id,attempt_number,status,error,result_detail,started_at) VALUES (?,?,1,'publishing','','',?)`)
          .bind(attemptId, jobId, startedAt),
      ]);
    } catch {
      await db.prepare("UPDATE claims SET status='approved',publish_error='发布记录初始化失败，尚未请求小红书',updated_at=? WHERE id=? AND status='publishing' AND updated_at=?")
        .bind(new Date().toISOString(), claim.id, startedAt).run();
      return Response.json({ error: "无法创建发布记录，本次没有请求小红书，请稍后重试" }, { status: 500 });
    }
    let acquired = false;
    let publishDispatched = false;
    try {
      const lease = await runtime("acquire", claim.account_id); acquired = true;
      const port = Number(lease.port);
      const login = await checkMcpLogin(port);
      if (!login.online) {
        await db.prepare("UPDATE accounts SET status='login_expired',updated_at=? WHERE id=?").bind(new Date().toISOString(), claim.account_id).run();
        throw new Error(`${claim.account_name} 登录已失效，请先到账号中心重新登录`);
      }
      if (claim.xhs_nickname && login.nickname && claim.xhs_nickname !== login.nickname) throw new Error(`账号身份不匹配：预期 ${claim.xhs_nickname}，实际 ${login.nickname}`);
      const cleanTags = tags.map((tag) => String(tag).replace(/^#+/, "").trim()).filter(Boolean);
      publishDispatched = true;
      const result = await callMcpTool(port, "publish_content", { title, content: body, images, tags: cleanTags }, PUBLISH_TIMEOUT_MS);
      const publishedAt = new Date().toISOString();
      const detail = result.filter((item) => item.type === "text").map((item) => item.text).join("\n");
      await db.batch([
        db.prepare("UPDATE claims SET status='published',published_at=?,publish_error='',updated_at=? WHERE id=? AND status='publishing'").bind(publishedAt, publishedAt, claim.id),
        db.prepare("UPDATE publish_jobs SET status='succeeded',result_detail=?,updated_at=?,completed_at=? WHERE id=? AND status='publishing'").bind(detail, publishedAt, publishedAt, jobId),
        db.prepare("UPDATE publish_attempts SET status='succeeded',result_detail=?,completed_at=? WHERE id=? AND status='publishing'").bind(detail, publishedAt, attemptId),
      ]);
      await audit(user.id, "通过小红书MCP发布内容", "claim", claim.id, `${claim.account_name} / 发布人 ${user.name} / ${images.length} 张图片`);
      await runtime("release", claim.account_id); acquired = false;
      return Response.json({ ok: true, published_at: publishedAt, detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : "小红书发布失败";
      const completedAt = new Date().toISOString();
      const uncertain = publishDispatched && isUncertainPublishError(message);
      const safeMessage = uncertain ? `发布结果待核验：${message}。请先到小红书确认是否已发布，不能直接重试。` : message;
      await db.batch([
        db.prepare("UPDATE claims SET status=?,publish_error=?,updated_at=? WHERE id=? AND status='publishing'")
          .bind(uncertain ? "publishing" : "failed", safeMessage, completedAt, claim.id),
        db.prepare("UPDATE publish_jobs SET status=?,last_error=?,updated_at=?,completed_at=? WHERE id=? AND status='publishing'")
          .bind(uncertain ? "uncertain" : "failed", safeMessage, completedAt, uncertain ? null : completedAt, jobId),
        db.prepare("UPDATE publish_attempts SET status=?,error=?,completed_at=? WHERE id=? AND status='publishing'")
          .bind(uncertain ? "uncertain" : "failed", safeMessage, completedAt, attemptId),
      ]);
      await audit(user.id, uncertain ? "小红书发布结果待核验" : "小红书发布失败", "claim", claim.id, safeMessage);
      if (acquired) await runtime("discard", claim.account_id).catch(() => undefined);
      return Response.json({ error: safeMessage, uncertain }, { status: uncertain ? 409 : 502 });
    }
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
