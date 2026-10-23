import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";

const supported = new Set(["douyin", "wechat_channels"]);

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, roleGroups.administer)) return forbidden("只有管理员可以绑定平台账号");
  const data = await request.json() as { account_id?: string; action?: string };
  const accountId = String(data.account_id || "");
  const db = database();
  const account = await db.prepare("SELECT id,name,platform FROM accounts WHERE id=? AND is_demo=0")
    .bind(accountId).first<{ id: string; name: string; platform: string }>();
  if (!account || !supported.has(account.platform))
    return Response.json({ error: "视频平台账号不存在" }, { status: 404 });
  const completing = data.action === "browser_login_complete";
  const response = await managerFetch(completing ? "/social/browser-login-complete" : "/social/browser-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, platform: account.platform }),
  }).catch(() => null);
  if (!response) return Response.json({ error: "本机浏览器服务未启动" }, { status: 503 });
  const payload = await response.json() as {
    authenticated?: boolean; opened?: boolean; identityKey?: string; displayName?: string; error?: string;
  };
  if (!response.ok) return Response.json({ error: payload.error || "平台登录失败" }, { status: response.status });
  if (completing && payload.authenticated && payload.identityKey) {
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE accounts SET status='online',auth_method='browser',external_user_id=?,external_display_name=?,identity_verified_at=?,updated_at=? WHERE id=?`,
    ).bind(payload.identityKey, payload.displayName || account.name, now, now, account.id).run();
    await audit(user.id, `绑定${account.platform === "douyin" ? "抖音" : "视频号"}账号`, "account", account.id, payload.displayName || account.name);
  }
  return Response.json({ ok: true, opened: !completing, authenticated: Boolean(payload.authenticated), display_name: payload.displayName || "" });
}
