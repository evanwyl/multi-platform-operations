import type { DbUser } from "./database";

function isAdmin(user: DbUser) {
  try { return (JSON.parse(user.roles) as string[]).includes("admin"); }
  catch { return false; }
}

export async function canAccessAccount(db: D1Database, user: DbUser, accountId: string) {
  if (isAdmin(user)) return true;
  return Boolean(await db.prepare(
    "SELECT 1 AS allowed FROM user_account_access WHERE user_id=? AND account_id=?",
  ).bind(user.id, accountId).first());
}

export async function accessibleAccountIds(db: D1Database, user: DbUser) {
  if (isAdmin(user)) return null;
  const rows = await db.prepare(
    "SELECT account_id FROM user_account_access WHERE user_id=?",
  ).bind(user.id).all<{ account_id: string }>();
  return new Set(rows.results.map((row) => row.account_id));
}
