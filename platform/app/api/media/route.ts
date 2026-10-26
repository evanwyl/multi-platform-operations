import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import { canAccessAccount } from "../../../lib/account-access";
import { managerFetch } from "../../../lib/runtime-client";
import { isVideoContentType } from "../../../lib/platforms";

const mediaKinds = new Set(["video", "cover_landscape", "cover_portrait", "subtitle"]);

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, roleGroups.operate)) return forbidden("你没有上传视频素材的权限");
  const url = new URL(request.url);
  const claimId = url.searchParams.get("claim_id") || "";
  const kind = url.searchParams.get("kind") || "";
  const fileName = decodeURIComponent(request.headers.get("x-file-name") || "media");
  if (!mediaKinds.has(kind)) return Response.json({ error: "媒体类型不合法" }, { status: 400 });
  const db = database();
  const claim = await db.prepare(
    `SELECT c.id,c.owner_id,c.status,c.account_id,c.content_type FROM claims c WHERE c.id=?`,
  ).bind(claimId).first<{ id: string; owner_id: string; status: string; account_id: string; content_type: string }>();
  if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
  if (!(await canAccessAccount(db, user, claim.account_id))) return forbidden("你没有该账号的操作权限");
  if (claim.owner_id !== user.id && !can(user, roleGroups.review)) return forbidden("只有内容负责人或审核员可以管理视频素材");
  if (!["writing", "revision"].includes(claim.status))
    return Response.json({ error: "只有创作中或待修改的内容可以更换素材" }, { status: 409 });
  if (!isVideoContentType(claim.content_type))
    return Response.json({ error: "当前内容不是视频发布任务" }, { status: 400 });
  if (!request.body) return Response.json({ error: "没有收到媒体文件" }, { status: 400 });
  const uploadHeaders: Record<string, string> = {
    "content-type":
      request.headers.get("content-type") || "application/octet-stream",
    "x-claim-id": claimId,
    "x-media-kind": kind,
    "x-file-name": encodeURIComponent(fileName),
  };
  const contentLength = request.headers.get("content-length");
  if (contentLength) uploadHeaders["content-length"] = contentLength;
  const response = await managerFetch("/media-assets", {
    method: "POST",
    headers: uploadHeaders,
    body: request.body,
  }).catch(() => null);
  if (!response) return Response.json({ error: "本机媒体服务未启动" }, { status: 503 });
  const payload = await response.json() as {
    path?: string; size?: number; sha256?: string; mimeType?: string; originalName?: string; error?: string;
  };
  if (!response.ok || !payload.path || !payload.sha256)
    return Response.json({ error: payload.error || "媒体文件保存失败" }, { status: response.status || 502 });
  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM media_assets WHERE claim_id=? AND kind=?").bind(claimId, kind),
    db.prepare(
      `INSERT INTO media_assets (id,claim_id,owner_id,kind,source,path,original_name,mime_type,sha256,size,created_at)
       VALUES (?,?,?,?,'uploaded',?,?,?,?,?,?)`,
    ).bind(assetId, claimId, user.id, kind, payload.path, payload.originalName || fileName, payload.mimeType || "", payload.sha256, Number(payload.size || 0), now),
  ]);
  await audit(user.id, "上传视频发布素材", "claim", claimId, `${kind} / ${fileName} / ${payload.size || 0} bytes`);
  return Response.json({ ok: true, asset: { id: assetId, kind, original_name: payload.originalName || fileName, mime_type: payload.mimeType, sha256: payload.sha256, size: payload.size, created_at: now } });
}
