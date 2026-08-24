import { createPasswordHash, createSession, currentUser, destroySession, publicUser, verifyPassword } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";

export async function GET(request: Request) {
  await ensureDatabase();
  const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  const user = await currentUser(request);
  return Response.json({ initialized: Boolean(count?.total), user: user ? publicUser(user) : null });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const data = await request.json() as { action?: string; name?: string; username?: string; password?: string };

  if (data.action === "logout") {
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await destroySession(request) } });
  }

  const username = data.username?.trim().toLowerCase() ?? "";
  const password = data.password ?? "";
  if (!/^[a-z0-9_-]{3,24}$/.test(username) || password.length < 8) {
    return Response.json({ error: "用户名需为3–24位字母/数字；密码至少8位" }, { status: 400 });
  }

  if (data.action === "setup") {
    const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    if (count?.total) return Response.json({ error: "系统已经完成初始化" }, { status: 409 });
    const id = crypto.randomUUID();
    await database().prepare("INSERT INTO users (id,name,username,password_hash,roles,status,created_at) VALUES (?,?,?,?,?,'active',?)")
      .bind(id, data.name?.trim() || "管理员", username, await createPasswordHash(password), JSON.stringify(["admin", "reviewer", "publisher"]), new Date().toISOString()).run();
    await audit(id, "初始化系统", "user", id, "创建首位管理员");
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": await createSession(id) } });
  }

  if (data.action === "login") {
    const user = await database().prepare("SELECT id,name,username,password_hash,roles,status FROM users WHERE username=?")
      .bind(username).first<DbUser & { password_hash: string }>();
    if (!user || user.status !== "active" || !(await verifyPassword(password, user.password_hash))) {
      return Response.json({ error: "用户名或密码不正确" }, { status: 401 });
    }
    await audit(user.id, "登录", "user", user.id);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSession(user.id) } });
  }

  return Response.json({ error: "不支持的操作" }, { status: 400 });
}

type DbUser = { id: string; name: string; username: string; roles: string; status: string };
