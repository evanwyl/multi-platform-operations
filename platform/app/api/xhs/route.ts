import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { callMcpTool, checkMcpLogin, readMcpIdentity } from "../../../lib/xhs-mcp";
import { managerFetch } from "../../../lib/runtime-client";

type AccountRow = { id: string; name: string; xhs_user_id: string | null; xhs_nickname: string | null; xhs_red_id: string | null };

type RuntimePurpose = "worker" | "verification";

async function runtime(path: "acquire" | "release" | "discard" | "touch", accountId: string, purpose: RuntimePurpose = "worker", options: { holdMs?: number; close?: boolean } = {}) {
  let response: Response;
  try {
    response = await managerFetch(`/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, purpose, ...options }),
    });
  } catch { throw new Error("小红书运行管理器未启动"); }
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
  if (!(JSON.parse(user.roles) as string[]).includes("admin")) return Response.json({ error: "只有管理员可以登录小红书账号" }, { status: 403 });
  const data = await request.json() as { action?: string; account_id?: string };
  const account = await database().prepare("SELECT id,name,xhs_user_id,xhs_nickname,xhs_red_id FROM accounts WHERE id=? AND is_demo=0")
    .bind(data.account_id ?? "").first<AccountRow>();
  if (!account) return Response.json({ error: "账号记录不存在" }, { status: 404 });

  let acquired = false;
  const purpose: RuntimePurpose = data.action === "status" || data.action === "qrcode" ? "verification" : "worker";
  try {
    const lease = await runtime("acquire", account.id, purpose);
    acquired = true;
    let port = Number(lease.port);
    if (!Number.isInteger(port)) throw new Error("运行槽位返回异常");

    if (data.action === "status") {
      let status;
      try { status = await checkMcpLogin(port); }
      catch {
        await runtime("discard", account.id, purpose); acquired = false;
        const retryLease = await runtime("acquire", account.id, purpose); acquired = true; port = Number(retryLease.port);
        try { status = await checkMcpLogin(port); }
        catch {
          await runtime("discard", account.id, purpose); acquired = false;
          await database().prepare("UPDATE accounts SET status='unknown',updated_at=? WHERE id=?").bind(new Date().toISOString(), account.id).run();
          await audit(user.id, "小红书实时状态暂无法确认", "account", account.id, "可见浏览器标准MCP连续两次页面加载超时");
          return Response.json({ online: null, unknown: true, text: "可见浏览器连续两次未能完成小红书页面加载，实时状态暂无法确认" });
        }
      }
      if (status.online && account.xhs_nickname && status.nickname && account.xhs_nickname !== status.nickname) {
        await database().prepare("UPDATE accounts SET status='error',updated_at=? WHERE id=?").bind(new Date().toISOString(), account.id).run();
        await audit(user.id, "阻断账号身份不匹配", "account", account.id, `预期 ${account.xhs_nickname}，实际 ${status.nickname}`);
        await runtime("release", account.id, purpose, { close: true });
        return Response.json({ error: `账号身份不匹配：该记录绑定的是 ${account.xhs_nickname}，当前登录的是 ${status.nickname}` }, { status: 409 });
      }
      const identity = status.online && !account.xhs_user_id ? await readMcpIdentity(port) : null;
      await database().prepare("UPDATE accounts SET status=?,xhs_user_id=COALESCE(xhs_user_id,?),xhs_nickname=COALESCE(?,xhs_nickname),updated_at=? WHERE id=?")
        .bind(status.online ? "online" : "login_expired", identity?.userId || null, status.nickname || identity?.nickname || null, new Date().toISOString(), account.id).run();
      await audit(user.id, "检查小红书登录身份", "account", account.id, status.online ? `${status.nickname || account.xhs_nickname} / 可见浏览器标准MCP` : "未登录 / 可见浏览器标准MCP");
      await runtime("release", account.id, purpose, { close: true });
      return Response.json({ ...status, userId: account.xhs_user_id || identity?.userId || "", identityVerified: status.online && Boolean(account.xhs_user_id || identity?.userId) });
    }

    if (data.action === "qrcode") {
      const content = await callMcpTool(port, "get_login_qrcode");
      const image = content.find((item) => item.type === "image" && item.data);
      const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
      if (!image?.data) return Response.json({ error: "没有取得登录二维码" }, { status: 502 });
      await runtime("release", account.id, purpose, { holdMs: 5 * 60 * 1000 });
      await audit(user.id, "获取小红书登录二维码", "account", account.id, `可见验证槽位 ${port}，保留5分钟`);
      return Response.json({ text, image: `data:${image.mimeType || "image/png"};base64,${image.data}` });
    }
    if (data.action === "profile") {
      const content = await callMcpTool(port, "get_my_profile");
      const text = content.filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n");
      let profile: {
        userBasicInfo?: { nickname?: string; redId?: string; desc?: string; imageb?: string; images?: string };
        interactions?: Array<{ type?: string; name?: string; count?: string }>;
        feeds?: unknown[];
      };
      try { profile = JSON.parse(text); } catch { throw new Error("小红书返回的账号概览格式无法识别"); }
      const basic = profile.userBasicInfo ?? {};
      if ((account.xhs_nickname && basic.nickname && account.xhs_nickname !== basic.nickname) || (account.xhs_red_id && basic.redId && account.xhs_red_id !== basic.redId)) {
        await database().prepare("UPDATE accounts SET status='error',updated_at=? WHERE id=?").bind(new Date().toISOString(), account.id).run();
        await audit(user.id, "阻断账号身份不匹配", "account", account.id, `预期 ${account.xhs_nickname || account.xhs_red_id}，实际 ${basic.nickname || basic.redId}`);
        await runtime("release", account.id, purpose);
        return Response.json({ error: "主页身份与这个账号记录不一致，已阻止同步" }, { status: 409 });
      }
      const count = (type: string, name: string) => profile.interactions?.find((item) => item.type === type || item.name === name)?.count ?? null;
      const syncedAt = new Date().toISOString();
      await database().prepare(`UPDATE accounts SET status='online',xhs_user_id=COALESCE(xhs_user_id,?),xhs_nickname=?,
        xhs_red_id=?,profile_bio=?,avatar_url=?,following_count=?,followers_count=?,interaction_count=?,note_count=?,profile_synced_at=?,updated_at=? WHERE id=?`)
        .bind(account.xhs_user_id, basic.nickname || account.xhs_nickname, basic.redId || null, basic.desc || null,
          basic.imageb || basic.images || null, count("follows", "关注"), count("fans", "粉丝"), count("interaction", "获赞与收藏"),
          Array.isArray(profile.feeds) ? profile.feeds.length : null, syncedAt, syncedAt, account.id).run();
      await audit(user.id, "同步小红书账号概览", "account", account.id, `${basic.nickname || account.xhs_nickname} / ${basic.redId || account.xhs_red_id || "标准MCP"}`);
      await runtime("release", account.id, purpose);
      return Response.json({ ok: true, syncedAt });
    }
    return Response.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    if (acquired) await runtime("discard", account.id, purpose).catch(() => undefined);
    if (data.action !== "qrcode") await database().prepare("UPDATE accounts SET status='unknown',updated_at=? WHERE id=?").bind(new Date().toISOString(), account.id).run().catch(() => undefined);
    const message = error instanceof Error ? error.message : "小红书服务连接失败";
    return Response.json({ error: message }, { status: 502 });
  }
}
