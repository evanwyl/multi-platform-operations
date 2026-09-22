import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { callMcpTool, checkMcpLogin, readMcpIdentity } from "../../../lib/xhs-mcp";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";
import { canAccessAccount } from "../../../lib/account-access";

type PublishClaim = {
  id: string;
  owner_id: string;
  account_id: string;
  account_name: string;
  account_status: string;
  account_platform: string;
  auth_method: string;
  external_user_id: string | null;
  xhs_user_id: string | null;
  xhs_nickname: string | null;
  status: string;
  content_type: string;
  snapshot: string | null;
  publish_images: string;
  title: string;
  body: string;
  tags: string;
  updated_at: string;
  wechat_theme: string;
  wechat_style: string;
};

const PUBLISH_TIMEOUT_MS = 6 * 60 * 1000;
const INTERRUPTED_RECOVERY_MS = PUBLISH_TIMEOUT_MS + 2 * 60 * 1000;
function isUncertainPublishError(message: string) {
  return /超过\s*\d+\s*分钟|执行中断|连接已中断|页面加载超时|状态暂时无法确认|知乎发布请求未完成|无法解析的响应|发布按钮已触发|结果无法确认/i.test(
    message,
  );
}

async function runtime(
  path: "acquire" | "release" | "discard",
  accountId: string,
) {
  const response = await managerFetch(`/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, purpose: "worker" }),
  }).catch(() => null);
  if (!response) throw new Error("小红书运行管理器未启动");
  const payload = (await response.json()) as { port?: number; error?: string };
  if (!response.ok) throw new Error(payload.error || "无法分配小红书运行槽位");
  return payload;
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const data = (await request.json()) as {
    action?: string;
    claim_id?: string;
    reason?: string;
    outcome?: string;
    theme?: string;
    style?: {
      fontSize?: number;
      lineHeight?: number;
      align?: string;
      primary?: string;
    };
  };
  const claimId = String(data.claim_id ?? "");
  const db = database();
  const claim = await db
    .prepare(
      `SELECT c.id,c.owner_id,c.account_id,c.status,c.content_type,c.snapshot,c.publish_images,c.title,c.body,c.tags,c.updated_at,c.wechat_theme,c.wechat_style,
    a.name AS account_name,a.status AS account_status,a.platform AS account_platform,a.auth_method,a.external_user_id,a.xhs_user_id,a.xhs_nickname
    FROM claims c JOIN accounts a ON a.id=c.account_id WHERE c.id=? AND a.is_demo=0`,
    )
    .bind(claimId)
    .first<PublishClaim>();
  if (!claim)
    return Response.json({ error: "发布任务不存在" }, { status: 404 });
  if (!(await canAccessAccount(db, user, claim.account_id)))
    return forbidden("你没有该账号的操作权限");
  const canPublishAny = can(user, roleGroups.review);
  const canPublishOwned =
    claim.owner_id === user.id && can(user, roleGroups.operate);
  if (!canPublishAny && !canPublishOwned)
    return forbidden("只有内容负责人或审核员可以执行发布");

  const isWechatArticle =
    claim.account_platform === "wechat" &&
    claim.content_type === "wechat_article";
  const themes = new Set([
    "default",
    "grace",
    "simple",
    "business",
    "ink",
    "fresh",
    "magazine",
    "tech",
    "monochrome",
    "knowledge",
    "highlight",
  ]);
  if (data.action === "preview_wechat_layout") {
    if (!isWechatArticle)
      return Response.json(
        { error: "只有公众号文章可以选择公众号排版" },
        { status: 400 },
      );
    if (!["approved", "queued", "failed"].includes(claim.status)) {
      return Response.json(
        { error: "只有待发布内容可以查看审核排版" },
        { status: 409 },
      );
    }
    const frozen = claim.snapshot
      ? (JSON.parse(claim.snapshot) as {
          body?: string;
          wechat_theme?: string;
          wechat_style?: Record<string, unknown>;
        })
      : null;
    const theme = String(
      frozen?.wechat_theme || claim.wechat_theme || "default",
    );
    const sourceStyle =
      frozen?.wechat_style || JSON.parse(claim.wechat_style || "{}");
    const style = {
      fontSize: Math.min(19, Math.max(14, Number(sourceStyle.fontSize) || 16)),
      lineHeight: Math.min(
        2.2,
        Math.max(1.5, Number(sourceStyle.lineHeight) || 1.85),
      ),
      align: sourceStyle.align === "left" ? "left" : "justify",
      primary: /^#[0-9a-f]{6}$/i.test(String(sourceStyle.primary || ""))
        ? String(sourceStyle.primary)
        : "",
    };
    if (!themes.has(theme))
      return Response.json(
        { error: "不支持的公众号排版主题" },
        { status: 400 },
      );
    const markdown = String(frozen?.body || claim.body || "").trim();
    if (!markdown)
      return Response.json(
        { error: "没有可预览的公众号正文" },
        { status: 409 },
      );
    const response = await managerFetch("/wechat/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown, theme, style }),
    }).catch(() => null);
    if (!response)
      return Response.json({ error: "本机排版服务未启动" }, { status: 503 });
    const payload = (await response.json()) as {
      html?: string;
      error?: string;
    };
    if (!response.ok)
      return Response.json(
        { error: payload.error || "生成排版预览失败" },
        { status: response.status },
      );
    return Response.json({ ok: true, theme, style, html: payload.html || "" });
  }

  if (data.action === "return_for_revision") {
    if (!["approved", "queued", "failed"].includes(claim.status)) {
      return Response.json(
        {
          error:
            claim.status === "publishing"
              ? "内容正在发布，不能同时退回修改"
              : "只有尚未发布的内容可以退回修改",
        },
        { status: 409 },
      );
    }
    const reason = String(data.reason ?? "").trim();
    if (!reason)
      return Response.json(
        { error: "退回修改时必须填写原因" },
        { status: 400 },
      );
    const returnedAt = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE claims SET status='revision',review_comment=?,publisher_id=NULL,publish_error='',updated_at=?
      WHERE id=? AND status IN ('approved','queued','failed')`,
      )
      .bind(reason.slice(0, 500), returnedAt, claim.id)
      .run();
    if (!result.meta.changes)
      return Response.json(
        { error: "任务状态已变化，请刷新后重试" },
        { status: 409 },
      );
    await audit(
      user.id,
      "发布前退回修改",
      "claim",
      claim.id,
      `${claim.account_name} / ${reason.slice(0, 300)}`,
    );
    return Response.json({ ok: true, status: "revision" });
  }

  if (data.action === "resolve_interrupted") {
    const age = Date.now() - Date.parse(claim.updated_at);
    if (
      claim.status !== "publishing" ||
      !Number.isFinite(age) ||
      age < INTERRUPTED_RECOVERY_MS
    ) {
      return Response.json(
        { error: "只有超过8分钟仍处于发布中的任务可以人工核对" },
        { status: 409 },
      );
    }
    const outcome =
      data.outcome === "published"
        ? "published"
        : data.outcome === "failed"
          ? "failed"
          : "";
    const reason = String(data.reason ?? "")
      .trim()
      .slice(0, 500);
    if (!outcome || !reason)
      return Response.json(
        { error: "请选择核对结果并填写说明" },
        { status: 400 },
      );
    const resolvedAt = new Date().toISOString();
    const activeJob = await db
      .prepare(
        `SELECT id FROM publish_jobs WHERE claim_id=? AND status IN ('publishing','uncertain')
      ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(claim.id)
      .first<{ id: string }>();
    const result =
      outcome === "published"
        ? await db
            .prepare(
              `UPDATE claims SET status='published',publisher_id=?,published_at=?,publish_error='',updated_at=?
          WHERE id=? AND status='publishing' AND updated_at=?`,
            )
            .bind(user.id, resolvedAt, resolvedAt, claim.id, claim.updated_at)
            .run()
        : await db
            .prepare(
              `UPDATE claims SET status='failed',publisher_id=?,publish_error=?,updated_at=?
          WHERE id=? AND status='publishing' AND updated_at=?`,
            )
            .bind(user.id, reason, resolvedAt, claim.id, claim.updated_at)
            .run();
    if (!result.meta.changes)
      return Response.json(
        { error: "任务已被其他人处理，请刷新列表" },
        { status: 409 },
      );
    if (activeJob) {
      await db.batch([
        db
          .prepare(
            `UPDATE publish_jobs SET status=?,last_error=?,updated_at=?,completed_at=? WHERE id=? AND status IN ('publishing','uncertain')`,
          )
          .bind(
            outcome === "published" ? "succeeded" : "failed",
            outcome === "failed" ? reason : "",
            resolvedAt,
            resolvedAt,
            activeJob.id,
          ),
        db
          .prepare(
            `UPDATE publish_attempts SET status=?,error=?,completed_at=? WHERE job_id=? AND status IN ('publishing','uncertain')`,
          )
          .bind(
            outcome === "published" ? "succeeded" : "failed",
            outcome === "failed" ? reason : "",
            resolvedAt,
            activeJob.id,
          ),
      ]);
    }
    await audit(
      user.id,
      outcome === "published"
        ? "人工确认中断任务已发布"
        : "人工确认中断任务未发布",
      "claim",
      claim.id,
      reason,
    );
    return Response.json({ ok: true, status: outcome });
  }

  if (data.action === "publish_now") {
    if (!["approved", "queued", "failed"].includes(claim.status))
      return Response.json({ error: "当前内容不能执行发布" }, { status: 409 });
    const frozen = claim.snapshot
      ? (JSON.parse(claim.snapshot) as {
          title?: string;
          body?: string;
          tags?: string[];
          images?: string[];
          wechat_theme?: string;
          wechat_style?: Record<string, unknown>;
        })
      : null;
    const images = Array.isArray(frozen?.images) ? frozen.images : [];
    const isZhihuArticle =
      claim.account_platform === "zhihu" &&
      claim.content_type === "zhihu_article";
    if (!isZhihuArticle && !isWechatArticle && !claim.xhs_user_id)
      return Response.json(
        { error: `${claim.account_name} 尚未完成登录和身份绑定` },
        { status: 409 },
      );
    if (!isZhihuArticle && !images.length)
      return Response.json(
        {
          error: isWechatArticle
            ? "审核快照中没有封面图，请退回创作页补充后重新审核"
            : "审核快照中没有图片，请退回创作页补充后重新审核",
        },
        { status: 400 },
      );
    if (isZhihuArticle && !["browser", "openapi"].includes(claim.auth_method))
      return Response.json(
        { error: `${claim.account_name} 尚未完成知乎登录` },
        { status: 409 },
      );
    if (isWechatArticle && claim.auth_method !== "wechat_openapi")
      return Response.json(
        { error: `${claim.account_name} 尚未配置公众号开发者接口` },
        { status: 409 },
      );
    const title = String(frozen?.title || claim.title || "").trim();
    const body = String(frozen?.body || claim.body || "").trim();
    const tags = Array.isArray(frozen?.tags)
      ? frozen.tags
      : (JSON.parse(claim.tags || "[]") as string[]);
    if (!title || !body)
      return Response.json(
        { error: "审核快照缺少标题或正文，无法发布" },
        { status: 409 },
      );
    const startedAt = new Date().toISOString();
    const claimResult = await db
      .prepare(
        `UPDATE claims SET status='publishing',publisher_id=?,publish_error='',updated_at=?
      WHERE id=? AND status IN ('approved','queued','failed')`,
      )
      .bind(user.id, startedAt, claim.id)
      .run();
    if (!claimResult.meta.changes) {
      return Response.json(
        { error: "这篇内容已被其他发布任务处理，请刷新列表确认状态" },
        { status: 409 },
      );
    }
    const jobId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO publish_jobs
          (id,claim_id,idempotency_key,status,requested_by,attempt_count,last_error,result_detail,created_at,updated_at)
          VALUES (?,?,?,'publishing',?,1,'','',?,?)`,
          )
          .bind(jobId, claim.id, idempotencyKey, user.id, startedAt, startedAt),
        db
          .prepare(
            `INSERT INTO publish_attempts
          (id,job_id,attempt_number,status,error,result_detail,started_at) VALUES (?,?,1,'publishing','','',?)`,
          )
          .bind(attemptId, jobId, startedAt),
      ]);
    } catch {
      await db
        .prepare(
          "UPDATE claims SET status='approved',publish_error='发布记录初始化失败，尚未请求平台发布服务',updated_at=? WHERE id=? AND status='publishing' AND updated_at=?",
        )
        .bind(new Date().toISOString(), claim.id, startedAt)
        .run();
      return Response.json(
        { error: "无法创建发布记录，本次没有请求小红书，请稍后重试" },
        { status: 500 },
      );
    }
    let acquired = false;
    let publishDispatched = false;
    try {
      if (isZhihuArticle || isWechatArticle) {
        publishDispatched = true;
        const response = await managerFetch(
          isWechatArticle ? "/wechat/publish" : "/zhihu/publish",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              isWechatArticle
                ? {
                    accountId: claim.account_id,
                    title,
                    body,
                    images,
                    author: claim.account_name,
                    openComment: true,
                    theme:
                      frozen?.wechat_theme || claim.wechat_theme || "default",
                    style:
                      frozen?.wechat_style ||
                      JSON.parse(claim.wechat_style || "{}"),
                  }
                : {
                    accountId: claim.account_id,
                    title,
                    body,
                    authMethod: claim.auth_method,
                    creationStatement: "ai_creation",
                  },
            ),
          },
        ).catch(() => null);
        if (!response)
          throw new Error(
            `${isWechatArticle ? "公众号草稿提交" : "知乎发布"}请求未完成：本机运行管理器未启动`,
          );
        const payload = (await response.json()) as {
          contentToken?: string;
          mediaId?: string;
          url?: string;
          detail?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.error ||
              (isWechatArticle ? "公众号草稿提交失败" : "知乎发布失败"),
          );
        const publishedAt = new Date().toISOString();
        const completedStatus = isWechatArticle ? "drafted" : "published";
        const recordedPublishedAt = isWechatArticle ? null : publishedAt;
        const detail = String(
          payload.detail ||
            (isWechatArticle ? "已写入公众号草稿箱" : "知乎专栏已发布"),
        );
        await db.batch([
          db
            .prepare(
              "UPDATE claims SET status=?,published_at=?,published_url=?,external_content_id=?,publish_error='',updated_at=? WHERE id=? AND status='publishing'",
            )
            .bind(
              completedStatus,
              recordedPublishedAt,
              payload.url || null,
              payload.mediaId || payload.contentToken || null,
              publishedAt,
              claim.id,
            ),
          db
            .prepare(
              "UPDATE publish_jobs SET status='succeeded',result_detail=?,updated_at=?,completed_at=? WHERE id=? AND status='publishing'",
            )
            .bind(detail, publishedAt, publishedAt, jobId),
          db
            .prepare(
              "UPDATE publish_attempts SET status='succeeded',result_detail=?,completed_at=? WHERE id=? AND status='publishing'",
            )
            .bind(detail, publishedAt, attemptId),
        ]);
        await audit(
          user.id,
          isWechatArticle
            ? "通过公众号开发者接口写入草稿箱"
            : claim.auth_method === "browser"
              ? "通过知乎浏览器发布专栏"
              : "通过知乎开放平台发布专栏",
          "claim",
          claim.id,
          `${claim.account_name} / 操作人 ${user.name}${payload.url ? ` / ${payload.url}` : ""}`,
        );
        return Response.json({
          ok: true,
          status: completedStatus,
          published_at: publishedAt,
          published_url: payload.url || "",
          detail,
        });
      }
      const lease = await runtime("acquire", claim.account_id);
      acquired = true;
      const port = Number(lease.port);
      const login = await checkMcpLogin(port);
      if (!login.online) {
        await db
          .prepare(
            "UPDATE accounts SET status='login_expired',updated_at=? WHERE id=?",
          )
          .bind(new Date().toISOString(), claim.account_id)
          .run();
        throw new Error(
          `${claim.account_name} 登录已失效，请先到账号中心重新登录`,
        );
      }
      if (!claim.xhs_user_id)
        throw new Error(`${claim.account_name} 尚未绑定稳定账号ID，请先到账号中心重新核验`);
      const identity = await readMcpIdentity(port);
      if (identity.userId !== claim.xhs_user_id)
        throw new Error(
          `账号身份不匹配：预期账号ID ${claim.xhs_user_id}，实际 ${identity.userId}，已阻止发布`,
        );
      if (
        claim.xhs_nickname &&
        login.nickname &&
        claim.xhs_nickname !== login.nickname
      )
        throw new Error(
          `账号身份不匹配：预期 ${claim.xhs_nickname}，实际 ${login.nickname}`,
        );
      const cleanTags = tags
        .map((tag) => String(tag).replace(/^#+/, "").trim())
        .filter(Boolean);
      publishDispatched = true;
      const result = await callMcpTool(
        port,
        "publish_content",
        { title, content: body, images, tags: cleanTags },
        PUBLISH_TIMEOUT_MS,
      );
      const publishedAt = new Date().toISOString();
      const detail = result
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      await db.batch([
        db
          .prepare(
            "UPDATE claims SET status='published',published_at=?,publish_error='',updated_at=? WHERE id=? AND status='publishing'",
          )
          .bind(publishedAt, publishedAt, claim.id),
        db
          .prepare(
            "UPDATE publish_jobs SET status='succeeded',result_detail=?,updated_at=?,completed_at=? WHERE id=? AND status='publishing'",
          )
          .bind(detail, publishedAt, publishedAt, jobId),
        db
          .prepare(
            "UPDATE publish_attempts SET status='succeeded',result_detail=?,completed_at=? WHERE id=? AND status='publishing'",
          )
          .bind(detail, publishedAt, attemptId),
      ]);
      await audit(
        user.id,
        "通过小红书MCP发布内容",
        "claim",
        claim.id,
        `${claim.account_name} / 发布人 ${user.name} / ${images.length} 张图片`,
      );
      await runtime("release", claim.account_id);
      acquired = false;
      return Response.json({ ok: true, published_at: publishedAt, detail });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : isZhihuArticle
            ? "知乎发布失败"
            : isWechatArticle
              ? "公众号草稿提交失败"
              : "小红书发布失败";
      const completedAt = new Date().toISOString();
      const uncertain = publishDispatched && isUncertainPublishError(message);
      const platformLabel = isZhihuArticle
        ? "知乎"
        : isWechatArticle
          ? "公众号草稿箱"
          : "小红书";
      const safeMessage = uncertain
        ? `发布结果待核验：${message}。请先到${platformLabel}确认是否已发布，不能直接重试。`
        : message;
      await db.batch([
        db
          .prepare(
            "UPDATE claims SET status=?,publish_error=?,updated_at=? WHERE id=? AND status='publishing'",
          )
          .bind(
            uncertain ? "publishing" : "failed",
            safeMessage,
            completedAt,
            claim.id,
          ),
        db
          .prepare(
            "UPDATE publish_jobs SET status=?,last_error=?,updated_at=?,completed_at=? WHERE id=? AND status='publishing'",
          )
          .bind(
            uncertain ? "uncertain" : "failed",
            safeMessage,
            completedAt,
            uncertain ? null : completedAt,
            jobId,
          ),
        db
          .prepare(
            "UPDATE publish_attempts SET status=?,error=?,completed_at=? WHERE id=? AND status='publishing'",
          )
          .bind(
            uncertain ? "uncertain" : "failed",
            safeMessage,
            completedAt,
            attemptId,
          ),
      ]);
      await audit(
        user.id,
        uncertain
          ? `${platformLabel}发布结果待核验`
          : `${platformLabel}发布失败`,
        "claim",
        claim.id,
        safeMessage,
      );
      if (acquired)
        await runtime("discard", claim.account_id).catch(() => undefined);
      return Response.json(
        { error: safeMessage, uncertain },
        { status: uncertain ? 409 : 502 },
      );
    }
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
