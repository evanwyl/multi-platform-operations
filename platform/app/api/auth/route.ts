import { createPasswordHash, createSession, currentUser, destroySession, deviceAuthorized, publicUser, rejectCrossSiteMutation, verifyPassword } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";

const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

function loginAttemptKey(request: Request, username: string) {
  const trustProxy = process.env.HONGSHUTAI_TRUST_PROXY_HEADERS === "1";
  const address = trustProxy
    ? request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "proxy"
    : "local";
  return `${address}:${username}`;
}

export async function GET(request: Request) {
  await ensureDatabase();
  if (!deviceAuthorized(request)) return Response.json({ error: "这台设备尚未加入团队", pairingRequired: true }, { status: 403 });
  const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  const user = await currentUser(request);
  return Response.json({ initialized: Boolean(count?.total), user: user ? publicUser(user) : null });
}

export async function POST(request: Request) {
  await ensureDatabase();
  if (!deviceAuthorized(request)) return Response.json({ error: "这台设备尚未加入团队", pairingRequired: true }, { status: 403 });
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const data = await request.json() as { action?: string; name?: string; username?: string; password?: string };

  if (data.action === "logout") {
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await destroySession(request) } });
  }

  const username = data.username?.trim().toLowerCase() ?? "";
  const password = data.password ?? "";
  if (!/^[a-z0-9_-]{3,24}$/.test(username) || password.length < 8 || password.length > 256) {
    return Response.json({ error: "用户名需为3-24位字母/数字；密码至少8位" }, { status: 400 });
  }

  if (data.action === "setup") {
    const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    if (count?.total) return Response.json({ error: "系统已经完成初始化" }, { status: 409 });
    const id = crypto.randomUUID();
    const result = await database().prepare(`INSERT INTO users (id,name,username,password_hash,roles,status,created_at)
      SELECT ?,?,?,?,?, 'active', ? WHERE NOT EXISTS (SELECT 1 FROM users)`)
      .bind(id, data.name?.trim().slice(0, 80) || "管理员", username, await createPasswordHash(password), JSON.stringify(["admin", "reviewer", "publisher"]), new Date().toISOString()).run();
    if (!result.meta.changes) return Response.json({ error: "系统已经完成初始化" }, { status: 409 });
    await audit(id, "初始化系统", "user", id, "创建首位管理员");
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": await createSession(id, request) } });
  }

  if (data.action === "login") {
    const attemptKey = loginAttemptKey(request, username);
    const attempt = loginAttempts.get(attemptKey);
    if (attempt && attempt.blockedUntil > Date.now()) {
      return Response.json({ error: "登录失败次数过多，请15分钟后再试" }, { status: 429 });
    }
    if (attempt) loginAttempts.delete(attemptKey);
    const user = await database().prepare("SELECT id,name,username,password_hash,roles,status FROM users WHERE username=?")
      .bind(username).first<DbUser & { password_hash: string }>();
    if (!user || user.status !== "active" || !(await verifyPassword(password, user.password_hash))) {
      const failures = (attempt?.failures || 0) + 1;
      loginAttempts.set(attemptKey, { failures, blockedUntil: failures >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_BLOCK_MS : 0 });
      return Response.json({ error: "用户名或密码不正确" }, { status: 401 });
    }
    loginAttempts.delete(attemptKey);
    await audit(user.id, "登录", "user", user.id);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSession(user.id, request) } });
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}

type DbUser = { id: string; name: string; username: string; roles: string; status: string };
