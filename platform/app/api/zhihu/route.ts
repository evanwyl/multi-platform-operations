import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { forbidden, userRoles } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";

async function requireAdmin(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "content-type": "application/json" } });
  if (!userRoles(user).includes("admin")) throw forbidden("只有管理员可以管理知乎授权");
  return user;
}

export async function GET(request: Request) {
  await ensureDatabase();
  try { await requireAdmin(request); } catch (response) { return response as Response; }
  const accountId = new URL(request.url).searchParams.get("account_id") || "";
  const account = await database().prepare("SELECT id,name,platform,external_user_id,external_display_name,auth_method,identity_verified_at,status FROM accounts WHERE id=? AND is_demo=0")
    .bind(accountId).first<{ id: string; name: string; platform: string }>();
  if (!account || account.platform !== "zhihu") return Response.json({ error: "知乎账号不存在" }, { status: 404 });
  const response = await managerFetch(`/zhihu/auth-status?accountId=${encodeURIComponent(accountId)}`).catch(() => null);
  if (!response) return Response.json({ error: "知乎运行管理器未启动" }, { status: 503 });
  const payload = await response.json() as { configured?: boolean; authenticated?: boolean; auth_method?: string; error?: string };
  if (!response.ok) return Response.json({ error: payload.error || "无法读取知乎授权状态" }, { status: response.status });
  return Response.json({ ...account, configured: Boolean(payload.configured), authenticated: Boolean(payload.authenticated), auth_method: payload.auth_method || "" });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  let user;
  try { user = await requireAdmin(request); } catch (response) { return response as Response; }
  const data = await request.json() as Record<string, unknown>;
  const accountId = String(data.account_id || "");
  const account = await database().prepare("SELECT id,name,platform FROM accounts WHERE id=? AND is_demo=0").bind(accountId).first<{ id: string; name: string; platform: string }>();
  if (!account || account.platform !== "zhihu") return Response.json({ error: "知乎账号不存在" }, { status: 404 });
  const action = String(data.action || "browser_login");
  if (action === "browser_login" || action === "browser_login_complete") {
    const managerPath = action === "browser_login" ? "/zhihu/browser-login" : "/zhihu/browser-login-complete";
    const response = await managerFetch(managerPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) }).catch(() => null);
    if (!response) return Response.json({ error: "知乎浏览器登录服务未启动" }, { status: 503 });
    const payload = await response.json() as { authenticated?: boolean; error?: string };
    if (!response.ok) return Response.json({ error: payload.error || "无法打开知乎登录浏览器" }, { status: response.status });
    if (action === "browser_login_complete" && payload.authenticated) {
      const now = new Date().toISOString();
      await database().prepare("UPDATE accounts SET auth_method='browser',status='online',identity_verified_at=?,updated_at=? WHERE id=?").bind(now, now, accountId).run();
      await audit(user.id, "完成知乎浏览器登录", "account", accountId, `${account.name} / 独立浏览器登录态已保存`);
    }
    return Response.json({ ok: true, opened: action === "browser_login", authenticated: Boolean(payload.authenticated), auth_method: payload.authenticated ? "browser" : "" });
  }
  const appKey = String(data.app_key || "").trim();
  const appSecret = String(data.app_secret || "");
  const displayName = String(data.display_name || "").trim().slice(0, 100);
  const response = await managerFetch("/zhihu/credentials", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, appKey, appSecret }),
  }).catch(() => null);
  if (!response) return Response.json({ error: "知乎运行管理器未启动" }, { status: 503 });
  const payload = await response.json() as { configured?: boolean; auth_method?: string; error?: string };
  if (!response.ok) return Response.json({ error: payload.error || "知乎授权保存失败" }, { status: response.status });
  const now = new Date().toISOString();
  await database().prepare("UPDATE accounts SET external_user_id=?,external_display_name=?,auth_method='openapi',status='auth_configured',identity_verified_at=?,updated_at=? WHERE id=?")
    .bind(appKey, displayName || null, now, now, accountId).run();
  await audit(user.id, "配置知乎开放平台授权", "account", accountId, `${account.name} / 用户 Token 已保存，访问密钥未写入数据库`);
  return Response.json({ ok: true, configured: true, auth_method: "openapi" });
}
