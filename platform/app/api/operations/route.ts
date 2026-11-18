import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import {
  accessibleAccountIds,
  canAccessAccount,
} from "../../../lib/account-access";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";
import {
  collectionInterval,
  contentIdentity,
  metricLeaseSql,
  verifiedXhsProfile,
  xhsProfileMetrics,
} from "../../../runtime/platforms/operations-core.mjs";
import { callMcpTool, readMcpIdentity } from "../../../lib/xhs-mcp";

type Row = Record<string, string | number | null>;
const collectable = new Set([
  "xiaohongshu",
  "douyin",
  "wechat_channels",
  "zhihu",
]);

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const db = database();
  const allowed = await accessibleAccountIds(db, user);
  const [content, accounts, jobs, settings, plans] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM content_metrics ORDER BY collected_at DESC LIMIT 5000",
      )
      .all<Row>(),
    db
      .prepare(
        "SELECT * FROM account_metrics ORDER BY collected_at DESC LIMIT 5000",
      )
      .all<Row>(),
    db
      .prepare("SELECT * FROM metric_jobs ORDER BY created_at DESC LIMIT 200")
      .all<Row>(),
    db
      .prepare("SELECT enabled FROM operations_settings WHERE id='default'")
      .first<Row>(),
    db
      .prepare(
        "SELECT id,claim_id,account_id,execute_at,status,error FROM publication_plans ORDER BY execute_at DESC LIMIT 500",
      )
      .all<Row>(),
  ]);
  const filter = (rows: Row[]) =>
    rows.filter((row) => !allowed || allowed.has(String(row.account_id)));
  return Response.json({
    content: filter(content.results),
    accounts: filter(accounts.results),
    jobs: filter(jobs.results),
    plans: filter(plans.results),
    enabled: Boolean(settings?.enabled),
    notifications: can(user, roleGroups.administer)
      ? await managerFetch("/operations/notifications")
          .then((r) => r.json())
          .catch(() => ({ configured: false, enabled: false }))
      : null,
  });
}

async function enqueue(accountId: string, claimId: string, actor: string) {
  const db = database(),
    now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO metric_jobs(id,account_id,claim_id,status,requested_by,created_at)
    SELECT ?,?,?,'pending',?,? WHERE NOT EXISTS
    (SELECT 1 FROM metric_jobs WHERE account_id=? AND claim_id=? AND status IN ('pending','running'))`,
    )
    .bind(
      crypto.randomUUID(),
      accountId,
      claimId,
      actor,
      now,
      accountId,
      claimId,
    )
    .run();
}

async function tick() {
  const db = database(),
    now = new Date().toISOString();
  const event = await db
    .prepare(
      "UPDATE operations_events SET status='sending' WHERE id=(SELECT id FROM operations_events WHERE status='pending' ORDER BY created_at LIMIT 1) RETURNING *",
    )
    .first<Row>();
  if (event) {
    const result = await managerFetch("/operations/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: event.action, detail: event.detail }),
    }).catch(() => null);
    await db
      .prepare(
        "UPDATE operations_events SET status=?,completed_at=? WHERE id=?",
      )
      .bind(result?.ok ? "completed" : "failed", now, event.id)
      .run();
  }
  await db
    .prepare(
      "UPDATE publication_plans SET status='uncertain',error='执行中断，须先到平台核对；不会自动重试' WHERE status='running' AND started_at<?",
    )
    .bind(new Date(Date.now() - 10 * 60e3).toISOString())
    .run();
  const plan = await db
    .prepare(
      `UPDATE publication_plans SET status='running',started_at=? WHERE id=(SELECT id FROM publication_plans WHERE status='pending' AND execute_at<=? ORDER BY execute_at LIMIT 1)
    AND NOT EXISTS(SELECT 1 FROM publication_plans WHERE status='running') RETURNING id`,
    )
    .bind(now, now)
    .first<Row>();
  if (plan) {
    try {
      const response = await fetch(
        new URL("/api/publish", "http://127.0.0.1:3000"),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.RUNTIME_MANAGER_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "execute_plan", plan_id: plan.id }),
          signal: AbortSignal.timeout(7 * 60e3),
        },
      );
      const result = (await response.json()) as { error?: string };
      await db
        .prepare(
          "UPDATE publication_plans SET status=?,error=?,completed_at=? WHERE id=? AND status='running'",
        )
        .bind(
          response.ok ? "completed" : "failed",
          String(result.error || "").slice(0, 300),
          new Date().toISOString(),
          plan.id,
        )
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE publication_plans SET status='uncertain',error='发布请求结果无法确认，请先到平台核对',completed_at=? WHERE id=?",
        )
        .bind(new Date().toISOString(), plan.id)
        .run();
    }
    return Response.json({ ok: true, dispatched: true });
  }
  await db
    .prepare(
      "UPDATE metric_jobs SET status='failed',error='采集进程中断，可重新采集',completed_at=? WHERE status='running' AND started_at<?",
    )
    .bind(now, new Date(Date.now() - 10 * 60e3).toISOString())
    .run();
  const settings = await db
    .prepare("SELECT enabled FROM operations_settings WHERE id='default'")
    .first<Row>();
  if (settings?.enabled) {
    const rows = await db
      .prepare(
        `SELECT c.id,c.account_id,c.published_at,a.platform,
      (SELECT MAX(created_at) FROM metric_jobs j WHERE j.claim_id=c.id) AS last_attempt
      FROM claims c JOIN accounts a ON a.id=c.account_id WHERE c.status='published' AND a.is_demo=0
      ORDER BY c.published_at DESC LIMIT 200`,
      )
      .all<Row>();
    for (const row of rows.results) {
      if (!collectable.has(String(row.platform))) continue;
      if (
        !row.last_attempt ||
        Date.now() - Date.parse(String(row.last_attempt)) >=
          collectionInterval(row.published_at)
      )
        await enqueue(String(row.account_id), String(row.id), "scheduler");
    }
    const accounts = await db
      .prepare(
        `SELECT a.id,a.platform,(SELECT MAX(created_at) FROM metric_jobs j WHERE j.account_id=a.id AND j.claim_id='') AS last_attempt
      FROM accounts a WHERE a.is_demo=0`,
      )
      .all<Row>();
    for (const row of accounts.results) {
      if (
        collectable.has(String(row.platform)) &&
        (!row.last_attempt ||
          Date.now() - Date.parse(String(row.last_attempt)) >= 86400e3)
      )
        await enqueue(String(row.id), "", "scheduler");
      const health = await db
        .prepare(
          "SELECT created_at FROM metric_jobs WHERE account_id=? AND claim_id='__health__' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(row.id)
        .first<Row>();
      if (
        collectable.has(String(row.platform)) &&
        (!health ||
          Date.now() - Date.parse(String(health.created_at)) >= 3600e3)
      )
        await enqueue(String(row.id), "__health__", "scheduler");
    }
  }
  // A single atomic lease serializes browser access across requests and accounts.
  const leased = await db.prepare(metricLeaseSql).bind(now).first<Row>();
  if (!leased) return Response.json({ ok: true, idle: true });
  let xhsLease = false;
  let xhsProfile: unknown = null;
  try {
    const account = await db
      .prepare(
        "SELECT id,platform,external_user_id,xhs_user_id,xhs_red_id FROM accounts WHERE id=? AND is_demo=0",
      )
      .bind(leased.account_id)
      .first<Row>();
    if (!account) throw new Error("账号已不存在");
    if (account.platform === "xiaohongshu") {
      const acquired = await managerFetch("/acquire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id, purpose: "worker" }),
      });
      const result = (await acquired.json()) as {
        port?: number;
        error?: string;
      };
      if (!acquired.ok || !result.port)
        throw new Error(result.error || "小红书账号运行器不可用");
      xhsLease = true;
      const identity = await readMcpIdentity(result.port).catch(() => null);
      if (
        identity &&
        account.xhs_user_id &&
        identity.userId !== account.xhs_user_id
      )
        throw new Error("小红书当前账号身份与绑定账号不一致，已阻止采集");
      if (!identity || !account.xhs_user_id) {
        const content = await callMcpTool(
          result.port,
          "get_my_profile",
          {},
          90_000,
        );
        xhsProfile = JSON.parse(
          content
            .filter((item) => item.type === "text")
            .map((item) => item.text || "")
            .join("\n"),
        );
        if (!verifiedXhsProfile(xhsProfile, account))
          throw new Error("个人主页身份与已绑定小红书号不匹配，已阻止采集");
      }
    }
    const health = leased.claim_id === "__health__";
    const claim =
      leased.claim_id && !health
        ? await db
            .prepare(
              "SELECT id,title,body,published_url,external_content_id,status FROM claims WHERE id=? AND account_id=?",
            )
            .bind(leased.claim_id, leased.account_id)
            .first<Row>()
        : null;
    if (leased.claim_id && !health && (!claim || claim.status !== "published"))
      throw new Error("仅正式发布的作品可以采集，草稿不计入运营数据");
    const profileValue = xhsProfile
      ? xhsProfileMetrics(xhsProfile, claim, account, health)
      : null;
    const response = profileValue
      ? Response.json(profileValue)
      : await managerFetch("/operations/collect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account, claim, health }),
        });
    const value = (await response.json()) as {
      error?: string;
      source?: string;
      followers?: number;
      metric?: Record<string, number | null>;
      url?: string;
      contentId?: string;
      healthy?: boolean;
    };
    if (!response.ok) throw new Error(value.error || "数据采集失败");
    const collected = new Date().toISOString();
    if (
      value.followers != null &&
      Number.isFinite(value.followers) &&
      value.followers >= 0
    )
      await db
        .prepare(
          "INSERT INTO account_metrics(id,account_id,followers,source,collected_at) VALUES (?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          account.id,
          value.followers,
          value.source || "creator",
          collected,
        )
        .run();
    if (
      claim &&
      value.metric &&
      Object.values(value.metric).some((v) => v != null)
    ) {
      const metric = (key: string) =>
        typeof value.metric?.[key] === "number" &&
        Number.isFinite(value.metric[key]) &&
        value.metric[key]! >= 0
          ? Math.round(value.metric[key]!)
          : null;
      await db
        .prepare(
          "INSERT INTO content_metrics(id,claim_id,account_id,views,likes,comments,favorites,shares,source,collected_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          claim.id,
          account.id,
          metric("views"),
          metric("likes"),
          metric("comments"),
          metric("favorites"),
          metric("shares"),
          value.source || "creator",
          collected,
        )
        .run();
    }
    const identity = contentIdentity(account.platform, value.url);
    if (claim && identity)
      await db
        .prepare(
          "UPDATE claims SET published_url=?,external_content_id=? WHERE id=? AND account_id=?",
        )
        .bind(identity.url, identity.id, claim.id, account.id)
        .run();
    if (!value.metric && value.followers == null && !value.healthy)
      throw new Error("页面未返回可核验指标，未写入数据");
    await db
      .prepare(
        "UPDATE metric_jobs SET status='succeeded',completed_at=? WHERE id=?",
      )
      .bind(collected, leased.id)
      .run();
  } catch (error) {
    await db
      .prepare(
        "UPDATE metric_jobs SET status='failed',error=?,completed_at=? WHERE id=?",
      )
      .bind(
        (error instanceof Error ? error.message : "数据采集失败").slice(0, 300),
        new Date().toISOString(),
        leased.id,
      )
      .run();
  } finally {
    if (xhsLease)
      await managerFetch("/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: leased.account_id }),
      }).catch(() => undefined);
  }
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const token = process.env.RUNTIME_MANAGER_TOKEN;
  const internal = Boolean(
    token && request.headers.get("authorization") === `Bearer ${token}`,
  );
  await ensureDatabase();
  if (internal) return tick();
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const data = (await request.json()) as Record<string, unknown>;
  const db = database();
  if (data.action === "schedule_publish" || data.action === "cancel_schedule") {
    const claim = await db
      .prepare(
        "SELECT account_id,owner_id,status,snapshot FROM claims WHERE id=?",
      )
      .bind(String(data.claim_id || ""))
      .first<Row>();
    if (!claim || !(await canAccessAccount(db, user, String(claim.account_id))))
      return forbidden();
    if (
      !can(user, roleGroups.review) &&
      !(claim.owner_id === user.id && can(user, roleGroups.operate))
    )
      return forbidden("只有负责人或审核员可以安排发布");
    if (data.action === "cancel_schedule") {
      const canceled = await db
        .prepare(
          "UPDATE publication_plans SET status='canceled',completed_at=? WHERE claim_id=? AND status='pending' RETURNING id",
        )
        .bind(new Date().toISOString(), data.claim_id)
        .first();
      if (!canceled)
        return Response.json(
          { error: "任务已开始执行，无法取消；请先核对平台结果" },
          { status: 409 },
        );
      await db
        .prepare(
          "UPDATE claims SET status='approved' WHERE id=? AND status='queued'",
        )
        .bind(data.claim_id)
        .run();
      await audit(user.id, "取消发布排期", "claim", String(data.claim_id));
      return Response.json({ ok: true });
    }
    if (claim.status !== "approved" || !claim.snapshot)
      return Response.json(
        { error: "只有已审核通过的内容可以安排自动发布" },
        { status: 409 },
      );
    const executeAt = Date.parse(String(data.execute_at || ""));
    if (
      !Number.isFinite(executeAt) ||
      executeAt < Date.now() + 60e3 ||
      executeAt > Date.now() + 30 * 86400e3
    )
      return Response.json(
        { error: "请选择 1 分钟后至 30 天内的执行时间" },
        { status: 400 },
      );
    const snapshot = JSON.parse(String(claim.snapshot));
    if (snapshot.creative?.video_options?.schedule_at)
      return Response.json(
        {
          error: "稿件已使用平台定时发布，请直接执行发布；不要重复设置主机排期",
        },
        { status: 409 },
      );
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO publication_plans(id,claim_id,account_id,requested_by,execute_at,snapshot,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            data.claim_id,
            claim.account_id,
            user.id,
            new Date(executeAt).toISOString(),
            claim.snapshot,
            new Date().toISOString(),
          ),
        db
          .prepare(
            "UPDATE claims SET status='queued' WHERE id=? AND status='approved'",
          )
          .bind(data.claim_id),
      ]);
    } catch {
      return Response.json(
        { error: "该内容已有有效排期，请刷新查看" },
        { status: 409 },
      );
    }
    await audit(
      user.id,
      "安排自动发布",
      "claim",
      String(data.claim_id),
      new Date(executeAt).toISOString(),
    );
    return Response.json({ ok: true });
  }
  if (data.action === "notifications") {
    if (!can(user, roleGroups.administer)) return forbidden();
    const response = await managerFetch("/operations/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhook: data.webhook, enabled: data.enabled }),
    });
    return Response.json(await response.json(), { status: response.status });
  }
  if (data.action === "settings") {
    if (!can(user, roleGroups.administer)) return forbidden();
    await db
      .prepare(
        "INSERT INTO operations_settings(id,enabled,updated_at) VALUES ('default',?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at",
      )
      .bind(data.enabled ? 1 : 0, new Date().toISOString())
      .run();
    await audit(
      user.id,
      "更新自动数据采集",
      "settings",
      "operations",
      data.enabled ? "启用" : "暂停",
    );
    return Response.json({ ok: true });
  }
  if (!can(user, [...roleGroups.operate, ...roleGroups.review]))
    return forbidden();
  const claimId = String(data.claim_id || "");
  const claim = claimId
    ? await db
        .prepare("SELECT account_id,status,owner_id FROM claims WHERE id=?")
        .bind(claimId)
        .first<Row>()
    : null;
  const accountId = String(claim?.account_id || data.account_id || "");
  if (!(await canAccessAccount(db, user, accountId))) return forbidden();
  const account = await db
    .prepare("SELECT platform FROM accounts WHERE id=? AND is_demo=0")
    .bind(accountId)
    .first<Row>();
  if (!account) return Response.json({ error: "账号不存在" }, { status: 404 });
  if (data.action === "link") {
    if (
      !claim ||
      !["published", "scheduled", "drafted", "awaiting_user"].includes(
        String(claim.status),
      )
    )
      return Response.json({ error: "请选择已有发布记录" }, { status: 409 });
    const identity = contentIdentity(account.platform, data.url);
    if (!identity)
      return Response.json(
        { error: "请填写该平台的正式作品链接，不能使用后台管理页地址" },
        { status: 400 },
      );
    if (
      data.confirm_published === true &&
      claim.owner_id !== user.id &&
      !can(user, roleGroups.review)
    )
      return forbidden("只有负责人或审核员可以确认正式发布");
    await db
      .prepare(
        "UPDATE claims SET published_url=?,external_content_id=? WHERE id=? AND account_id=?",
      )
      .bind(identity.url, identity.id, claimId, accountId)
      .run();
    await audit(user.id, "关联正式作品链接", "claim", claimId);
    if (data.confirm_published === true) {
      await db
        .prepare(
          "UPDATE claims SET status='published',published_at=COALESCE(published_at,?),updated_at=? WHERE id=? AND status IN ('scheduled','drafted','awaiting_user')",
        )
        .bind(new Date().toISOString(), new Date().toISOString(), claimId)
        .run();
      await audit(
        user.id,
        "人工核验平台已正式发布",
        "claim",
        claimId,
        identity.url,
      );
    }
    return Response.json({ ok: true });
  }
  if (data.action !== "collect")
    return Response.json({ error: "未知操作" }, { status: 400 });
  if (!collectable.has(String(account.platform)))
    return Response.json(
      { error: "该平台暂未提供后台数据采集；可先关联正式文章链接" },
      { status: 400 },
    );
  if (claimId && (!claim || claim.status !== "published"))
    return Response.json(
      { error: "仅正式发布的作品可以采集" },
      { status: 409 },
    );
  const recent = await db
    .prepare(
      "SELECT created_at FROM metric_jobs WHERE account_id=? AND claim_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(accountId, claimId)
    .first<Row>();
  if (recent && Date.now() - Date.parse(String(recent.created_at)) < 60e3)
    return Response.json(
      { error: "任务已进入队列，请稍后查看采集状态" },
      { status: 429 },
    );
  await enqueue(accountId, claimId, user.id);
  return Response.json({ ok: true, queued: true });
}
