import { database, ensureDatabase, type DbUser } from "./database";
import { env } from "cloudflare:workers";

const SESSION_COOKIE = "hongshutai_session";
const DEVICE_COOKIE = "hongshutai_device";
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(new Uint8Array(hash));
}

export async function createPasswordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
  return `210000.${bytesToBase64(salt)}.${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [iterationsText, saltText, expected] = stored.split(".");
  if (!iterationsText || !saltText || !expected) return false;
  const normalized = saltText.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  const salt = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  const actual = bytesToBase64(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function deviceAuthorized(request: Request) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (runtime.TEAM_MODE !== "host") return true;
  const expected = runtime.TEAM_ACCESS_TOKEN ?? "";
  const actual = cookieValue(request, DEVICE_COOKIE) ?? "";
  if (!expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function currentUser(request: Request): Promise<DbUser | null> {
  await ensureDatabase();
  if (!deviceAuthorized(request)) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await digest(token);
  const user = await database().prepare(
    `SELECT u.id,u.name,u.username,u.roles,u.status FROM sessions s
     JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`
  ).bind(tokenHash, new Date().toISOString()).first<DbUser>();
  return user ?? null;
}

export async function createSession(userId: string, request?: Request) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await database().prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .bind(await digest(token), userId, expires.toISOString(), new Date().toISOString()).run();
  await database().prepare("DELETE FROM sessions WHERE expires_at<=?").bind(new Date().toISOString()).run();
  const secure = request && new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`;
}

export async function destroySession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await database().prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function rejectCrossSiteMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return Response.json({ error: "已拒绝跨站请求" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch { void 0; }
  return Response.json({ error: "请求来源不可信" }, { status: 403 });
}

export function publicUser(user: DbUser) {
  return { ...user, roles: JSON.parse(user.roles) as string[] };
}
