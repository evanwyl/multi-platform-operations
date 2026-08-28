import { currentUser } from "../../../lib/auth";
import { audit, database, ensureDatabase, type DbUser } from "../../../lib/database";

type ImagePrompt = { label: string; prompt: string };

type CreativeDraft = {
  title_options: string[];
  title: string;
  body: string;
  tags: string[];
  image_prompts: ImagePrompt[];
  creative_note: string;
};

type ClaimContext = {
  id: string; owner_id: string; status: string; title: string; body: string; tags: string;
  creative_json: string; version_number: number; review_comment: string; angle: string;
  topic_title: string; account_name: string; persona: string; audience: string;
  brief: string; target_audience: string; pain_point: string; hook_points: string;
  content_structure: string; why_it_works: string; account_fit: string;
};

async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "content-type": "application/json" } });
  return user;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function textList(value: unknown, max: number) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[，,\s]+/);
  return [...new Set(source.map((item) => String(item).replace(/^#/, "").trim()).filter(Boolean))].slice(0, max);
}

function normalizeImagePrompt(value: unknown, index: number): ImagePrompt {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    label: String(item.label ?? `配图 ${index + 1}`).trim().slice(0, 20),
    prompt: String(item.prompt ?? item.image_prompt ?? item.visual_hint ?? "").trim().slice(0, 1200),
  };
}

function normalizeCreative(value: unknown): CreativeDraft {
  const draft = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const directPrompts = (Array.isArray(draft.image_prompts) ? draft.image_prompts : []).slice(0, 6).map(normalizeImagePrompt).filter((item) => item.prompt);
  return {
    title_options: textList(draft.title_options, 6).map((item) => item.slice(0, 20)),
    title: String(draft.title ?? "").trim().slice(0, 20),
    body: String(draft.body ?? "").trim().slice(0, 1200),
    tags: textList(draft.tags, 10).map((item) => item.slice(0, 16)),
    image_prompts: directPrompts,
    creative_note: String(draft.creative_note ?? "").trim().slice(0, 300),
  };
}

async function claimContext(id: string) {
  return database().prepare(`SELECT c.*,t.title AS topic_title,a.name AS account_name,a.persona,a.audience,
    COALESCE(i.brief,'') AS brief,COALESCE(i.target_audience,'') AS target_audience,
    COALESCE(i.pain_point,'') AS pain_point,COALESCE(i.hook_points,'[]') AS hook_points,
    COALESCE(i.content_structure,'[]') AS content_structure,COALESCE(i.why_it_works,'') AS why_it_works,
    COALESCE(i.account_fit,'') AS account_fit
    FROM claims c JOIN topics t ON t.id=c.topic_id JOIN accounts a ON a.id=c.account_id
    LEFT JOIN topic_insights i ON i.topic_id=t.id WHERE c.id=? AND a.is_demo=0`).bind(id).first<ClaimContext>();
}

function canEdit(user: DbUser, claim: ClaimContext) {
  return Boolean(user.id && claim.id);
}

async function codex<T>(kind: "content-draft", prompt: string) {
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:18100/codex/run", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, prompt }),
    });
  } catch { throw new Error("本机 AI 创作服务未启动"); }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "AI 创作失败");
  return payload;
}

async function saveVersion(user: DbUser, claim: ClaimContext, draft: CreativeDraft, source: string) {
  const db = database();
  const now = new Date().toISOString();
  const nextVersion = Number(claim.version_number || 0) + 1;
  await db.batch([
    db.prepare(`UPDATE claims SET title=?,body=?,tags=?,creative_json=?,creation_status='ready',creation_error='',
      version_number=?,generated_at=CASE WHEN ?='codex' THEN ? ELSE generated_at END,
      status=CASE WHEN status='revision' THEN 'writing' ELSE status END,updated_at=? WHERE id=?`)
      .bind(draft.title, draft.body, JSON.stringify(draft.tags), JSON.stringify(draft), nextVersion, source, now, now, claim.id),
    db.prepare(`INSERT INTO claim_versions (id,claim_id,version_number,source,title,body,tags,creative_json,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), claim.id, nextVersion, source, draft.title, draft.body, JSON.stringify(draft.tags), JSON.stringify(draft), user.id, now),
  ]);
  await audit(user.id, source === "codex" ? "AI一键创作" : "保存图文稿", "claim", claim.id, `版本 ${nextVersion}`);
  return nextVersion;
}

export async function GET(request: Request) {
  await ensureDatabase();
  let user: DbUser;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const id = new URL(request.url).searchParams.get("id") || "";
  const claim = await claimContext(id);
  if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
  if (!canEdit(user, claim)) return Response.json({ error: "当前账号无法查看这个团队任务" }, { status: 403 });
  const versions = await database().prepare(`SELECT id,version_number,source,title,created_at FROM claim_versions
    WHERE claim_id=? ORDER BY version_number DESC LIMIT 20`).bind(id).all();
  return Response.json({ creative: parseJson(claim.creative_json, {}), versions: versions.results });
}

export async function POST(request: Request) {
  await ensureDatabase();
  let user: DbUser;
  try { user = await requireUser(request); } catch (response) { return response as Response; }
  const data = await request.json() as Record<string, unknown>;
  const action = String(data.action ?? "");
  const id = String(data.id ?? "");
  let claim = await claimContext(id);
  if (!claim) return Response.json({ error: "内容任务不存在" }, { status: 404 });
  if (!canEdit(user, claim)) return Response.json({ error: "当前账号无法编辑这个团队任务" }, { status: 403 });
  if (!["writing", "revision"].includes(claim.status)) return Response.json({ error: "当前内容状态不能继续创作" }, { status: 409 });

  if (action === "generate") {
    const instruction = String(data.instruction ?? "").trim().slice(0, 500);
    const prompt = `你是小红书资深内容编辑和视觉策划。请在同一次任务中，为一个真实团队完成一篇原创小红书图文笔记及其整套配图提示词。

选题：${claim.topic_title}
发布账号：${claim.account_name}
账号定位：${claim.persona || "未填写，按选题自然表达"}
目标受众：${claim.audience || claim.target_audience || "普通小红书用户"}
认领角度：${claim.angle || "结合账号定位自然展开"}
选题摘要：${claim.brief || "无"}
用户痛点：${claim.pain_point || "无"}
已拆解爆点：${parseJson<string[]>(claim.hook_points, []).join("、") || "无"}
建议结构：${parseJson<string[]>(claim.content_structure, []).join(" → ") || "无"}
账号适配：${claim.account_fit || "无"}
审核意见：${claim.review_comment || "无"}
本次补充要求：${instruction || "无"}

要求：
1. 标题不超过20字，具体可信，不承诺爆款，不虚构案例、数据或亲身经历。
2. 正文自然、可直接编辑发布，段落清晰；标签不要带#号。
3. 先在内部完成最终标题和正文，再基于这份最终内容规划3到6张配图；这是一次 Codex 调用和一次结构化返回，不要拆成后续任务。
4. image_prompts 至少包含“封面主视觉”“核心观点图”“真实场景图”，可按内容增加对比场景、关键细节或情绪收尾。每张图承担不同叙事作用，但保持同一篇帖子的视觉语言连贯。
5. 每条 prompt 必须是一份脱离本任务上下文也能直接用于生图的完整制作说明，不能使用“结合正文”“根据本篇”“如上所述”等指代。使用清晰的短标签组织：用途、核心画面、场景、主体、动作/状态、风格/媒介、构图/镜头、光线/氛围、色彩/材质、限制/避免。
6. 主体、动作、道具、空间关系和镜头必须具体可见，避免“高级感”“小红书风”“科技感”“艺术感”“视觉冲击”等没有画面信息的空泛词。摄影类写清景别、视角、真实纹理与自然光；插画、信息图或产品图按 Imagegen Skill 对应类型写清制作规格。
7. 每条都描述一张可以直接发布或使用的完整成品图，而不是背景图、文字卡片、排版模板或留白底图。禁止“预留文字区域”“方便叠字”“纯背景”“全幅背景”“卡片模板”等表述。
8. 只有内容确实需要且能够给出逐字文案时才允许图中文字，并用引号标注准确文字、位置与字形；否则明确无文字、无水印、无品牌标识。不要虚构正文之外的人物身份、产品、品牌、案例或数据。
9. 输出前在内部逐条质检：是否能仅凭该 prompt 还原明确画面、是否与文案观点直接相关、是否与其他配图明显不同、是否误写成背景图；不合格就重写。image_prompts 只推荐图片，不声称已经生成，不包含API、模型参数、工具调用或文件路径。
10. 严格按 JSON Schema 一次返回标题、正文、标签、image_prompts 和创作说明；不要在JSON之外输出任何内容。`;
    await database().prepare("UPDATE claims SET creation_status='generating',creation_error='',creation_prompt=?,updated_at=? WHERE id=?")
      .bind(prompt, new Date().toISOString(), id).run();
    try {
      const result = normalizeCreative(await codex<CreativeDraft>("content-draft", prompt));
      if (!result.title || !result.body || result.image_prompts.length < 3) throw new Error("AI 返回的图文稿或图片提示词不完整");
      claim = await claimContext(id) as ClaimContext;
      const version = await saveVersion(user, claim, result, "codex");
      return Response.json({ ok: true, creative: result, version });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 创作失败";
      await database().prepare("UPDATE claims SET creation_status='error',creation_error=?,updated_at=? WHERE id=?")
        .bind(message, new Date().toISOString(), id).run();
      return Response.json({ error: message }, { status: 502 });
    }
  }

  if (action === "save") {
    const draft = normalizeCreative(data.creative);
    if (!draft.title || !draft.body) return Response.json({ error: "标题和正文不能为空" }, { status: 400 });
    const version = await saveVersion(user, claim, draft, "manual");
    return Response.json({ ok: true, creative: draft, version });
  }

  if (action === "restore") {
    const versionNumber = Number(data.version_number);
    const version = await database().prepare("SELECT * FROM claim_versions WHERE claim_id=? AND version_number=?")
      .bind(id, versionNumber).first<{ creative_json: string }>();
    if (!version) return Response.json({ error: "历史版本不存在" }, { status: 404 });
    const creative = normalizeCreative(parseJson(version.creative_json, {}));
    const nextVersion = await saveVersion(user, claim, creative, "restore");
    return Response.json({ ok: true, creative, version: nextVersion });
  }

  return Response.json({ error: "不支持的创作操作" }, { status: 400 });
}
