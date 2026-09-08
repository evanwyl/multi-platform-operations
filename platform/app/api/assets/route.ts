import { currentUser } from "../../../lib/auth";
import { database, ensureDatabase } from "../../../lib/database";
import { managerFetch } from "../../../lib/runtime-client";

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const claimId = url.searchParams.get("claim_id") || "";
  const index = Number(url.searchParams.get("index"));
  if (!claimId || !Number.isInteger(index) || index < 0 || index > 8) return Response.json({ error: "图片参数不合法" }, { status: 400 });
  const claim = await database().prepare("SELECT publish_images FROM claims WHERE id=?").bind(claimId).first<{ publish_images: string }>();
  if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
  const paths = JSON.parse(claim.publish_images || "[]") as string[];
  const path = paths[index];
  if (!path) return Response.json({ error: "图片不存在" }, { status: 404 });
  const response = await managerFetch(`/publish-asset?path=${encodeURIComponent(path)}`).catch(() => null);
  if (!response?.ok) return Response.json({ error: "图片读取失败" }, { status: response?.status || 503 });
  return new Response(await response.arrayBuffer(), {
    headers: { "content-type": response.headers.get("content-type") || "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" },
  });
}
