import type { DbUser } from "./database";

export type AppRole = "admin" | "operator" | "reviewer" | "publisher" | "readonly";

export const roleGroups = {
  operate: ["admin", "operator"],
  review: ["admin", "reviewer"],
  publish: ["admin", "publisher"],
  administer: ["admin"],
} as const satisfies Record<string, readonly AppRole[]>;

export function userRoles(user: Pick<DbUser, "roles">): AppRole[] {
  try {
    const parsed = JSON.parse(user.roles) as unknown;
    return Array.isArray(parsed) ? parsed.filter((role): role is AppRole =>
      ["admin", "operator", "reviewer", "publisher", "readonly"].includes(String(role))) : [];
  } catch {
    return [];
  }
}

export function can(user: Pick<DbUser, "roles">, allowed: readonly AppRole[]) {
  const current = userRoles(user);
  return allowed.some((role) => current.includes(role));
}

export function forbidden(message = "你没有执行此操作的权限") {
  return Response.json({ error: message }, { status: 403 });
}
