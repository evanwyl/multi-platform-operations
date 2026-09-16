import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { forbidden, userRoles } from "../../../lib/permissions";
import { managerFetch } from "../../../lib/runtime-client";

async function admin(request: Request) { const user = await currentUser(request); if (!user) throw Response.json({ error: "请先登录" }, { status: 401 }); if (!userRoles(user).includes("admin")) throw forbidden("只有管理员可以管理公众号授权"); return user; }
async function account(id: string) { const row = await database().prepare("SELECT id,name,platform,external_user_id,external_display_name,auth_method,status FROM accounts WHERE id=? AND is_demo=0").bind(id).first<Record<string,string>>(); if (!row || row.platform !== "wechat") throw Response.json({ error: "公众号账号不存在" }, { status: 404 }); return row; }
export async function GET(request: Request) { await ensureDatabase(); try { await admin(request); const id = new URL(request.url).searchParams.get("account_id") || ""; const row = await account(id); const response = await managerFetch(`/wechat/auth-status?accountId=${encodeURIComponent(id)}`); const status = await response.json() as Record<string, unknown>; return Response.json({ ...row, ...status }); } catch (error) { return error instanceof Response ? error : Response.json({ error: "无法读取公众号授权状态" }, { status: 503 }); } }
export async function POST(request: Request) {
  await ensureDatabase(); const cross = rejectCrossSiteMutation(request); if (cross) return cross;
  try {
    const user = await admin(request), data = await request.json() as Record<string,unknown>, id = String(data.account_id || ""), row = await account(id), action = String(data.action || "save");
    const path = action === "test" ? "/wechat/test" : "/wechat/credentials";
    const response = await managerFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: id, appId: data.app_id, appSecret: data.app_secret }) });
    const value = await response.json() as { error?: string; detail?: string }; if (!response.ok) return Response.json({ error: value.error || "公众号接口操作失败" }, { status: response.status });
    if (action === "test") return Response.json({ ok: true, detail: value.detail });
    const verification = await managerFetch("/wechat/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: id }) });
    const verified = await verification.json() as { error?: string }; if (!verification.ok) return Response.json({ error: verified.error || "凭据已保存在本机，但公众号连接验证失败" }, { status: verification.status });
    const now = new Date().toISOString(), display = String(data.display_name || "").trim().slice(0,100), appId = String(data.app_id || "").trim();
    await database().prepare("UPDATE accounts SET external_user_id=?,external_display_name=?,auth_method='wechat_openapi',status='auth_configured',identity_verified_at=?,updated_at=? WHERE id=?").bind(appId, display || null, now, now, id).run();
    await audit(user.id, "配置公众号开发者接口", "account", id, `${row.name} / AppID 已记录，AppSecret 仅保存在本机私有文件`);
    return Response.json({ ok: true, configured: true });
  } catch (error) { return error instanceof Response ? error : Response.json({ error: error instanceof Error ? error.message : "公众号接口操作失败" }, { status: 502 }); }
}
