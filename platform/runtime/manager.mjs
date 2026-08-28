import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "127.0.0.1";
const MANAGER_PORT = 18100;
const SLOT_PORTS = [18061, 18062];
const VERIFICATION_PORT = 18063;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFICATION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const HEADED_BROWSER = true;
const root = resolve(process.cwd(), "runtime/accounts");
const analysisRoot = resolve(process.cwd(), "runtime/analysis");
const publishAssetRoot = resolve(process.cwd(), "runtime/publish-assets");
const trendCoverRoot = resolve(process.cwd(), "public/trend-covers");
const binary = process.env.XHS_MCP_BINARY || join(homedir(), ".hermes/services/xiaohongshu-mcp/bin/xiaohongshu-mcp-darwin-arm64");
const codexBinary = process.env.CODEX_BINARY || "/Applications/ChatGPT.app/Contents/Resources/codex";
const xhsExpertSkill = process.env.XHS_EXPERT_SKILL || join(homedir(), ".codex/skills/xiaohongshu-operations-expert/SKILL.md");
const imagegenSkill = process.env.IMAGEGEN_SKILL || join(homedir(), ".codex/skills/.system/imagegen/SKILL.md");
const analysisSchemas = {
  "trend-plan": resolve(process.cwd(), "runtime/trend-plan.schema.json"),
  "topic-analysis": resolve(process.cwd(), "runtime/topic-analysis.schema.json"),
  "content-draft": resolve(process.cwd(), "runtime/content-draft.schema.json"),
};

mkdirSync(root, { recursive: true });
mkdirSync(analysisRoot, { recursive: true });
mkdirSync(publishAssetRoot, { recursive: true });
mkdirSync(trendCoverRoot, { recursive: true });
if (!existsSync(binary)) {
  process.stderr.write(`找不到小红书 MCP：${binary}\n`);
  process.exit(1);
}

const slots = [
  ...SLOT_PORTS.map((port) => ({ port, purpose: "worker", accountId: null, child: null, leased: false, stopping: false, lastUsed: 0, startedAt: 0, protectedUntil: 0 })),
  { port: VERIFICATION_PORT, purpose: "verification", accountId: null, child: null, leased: false, stopping: false, lastUsed: 0, startedAt: 0, protectedUntil: 0 },
];
const acquireQueue = [];
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
let analysisBusy = false;
let analysisChild = null;
let drainingQueue = false;

function validAccountId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

function validPurpose(value) {
  return value === "worker" || value === "verification";
}

function validTrendFeedId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}

function allowedXhsImageUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && (url.hostname === "xhscdn.com" || url.hostname.endsWith(".xhscdn.com"));
  } catch { return false; }
}

async function cacheTrendCover(feedId, sourceUrl) {
  if (!validTrendFeedId(feedId) || !allowedXhsImageUrl(sourceUrl)) {
    throw Object.assign(new Error("头图地址或笔记标识不合法"), { status: 400 });
  }
  for (const extension of ["jpg", "png", "webp", "avif"]) {
    if (existsSync(join(trendCoverRoot, `${feedId}.${extension}`))) return `/trend-covers/${feedId}.${extension}`;
  }
  const remote = await fetch(sourceUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
      referer: "https://www.xiaohongshu.com/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
  });
  if (!remote.ok || !allowedXhsImageUrl(remote.url)) throw Object.assign(new Error(`下载头图失败（${remote.status}）`), { status: 502 });
  const mime = String(remote.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/avif" ? "avif" : ["image/jpeg", "image/jpg"].includes(mime) ? "jpg" : "";
  if (!extension) throw Object.assign(new Error("小红书返回的头图格式不支持"), { status: 502 });
  const buffer = Buffer.from(await remote.arrayBuffer());
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw Object.assign(new Error("头图为空或超过12MB"), { status: 502 });
  writeFileSync(join(trendCoverRoot, `${feedId}.${extension}`), buffer, { mode: 0o600 });
  return `/trend-covers/${feedId}.${extension}`;
}

function leaseResult(slot) {
  return { port: slot.port, purpose: slot.purpose, accountId: slot.accountId, capacity: SLOT_PORTS.length, queued: false };
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function runCodex(kind, prompt) {
  const schema = analysisSchemas[kind];
  if (!schema || !existsSync(schema)) throw Object.assign(new Error("Codex 分析格式未配置"), { status: 400 });
  if (!existsSync(codexBinary)) throw Object.assign(new Error("本机没有找到 Codex CLI"), { status: 503 });
  if (kind === "content-draft" && (!existsSync(xhsExpertSkill) || !existsSync(imagegenSkill))) {
    throw Object.assign(new Error("AI 创作所需的小红书或生图提示词 Skill 未安装完整"), { status: 503 });
  }
  if (analysisBusy) throw Object.assign(new Error("Codex 正在分析上一项任务，请稍后重试"), { status: 409 });
  analysisBusy = true;
  try {
    const skilledPrompt = kind === "content-draft"
      ? `这是平台内的一次性 AI 创作任务，需要在同一次 Codex 执行中同时完成文案和整篇配图提示词。\n开始创作前必须完整读取并遵循：\n1. 小红书运营专家 Skill：${xhsExpertSkill}\n2. Imagegen Skill：${imagegenSkill}\n按照两份 Skill 的路由继续读取本次单篇创作与生图提示词所需参考资料。先在内部完成文案，再基于最终文案完成配图规划和提示词质检，但只能进行这一次执行、一次 JSON 返回。不要调用生图工具，不要在最终 JSON 中解释 Skill、步骤或工作过程。\n\n${prompt}`
      : prompt;
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(codexBinary, ["exec", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check", "--output-schema", schema, "--color", "never", "-"], {
        cwd: analysisRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"],
      });
      analysisChild = child;
      let stdout = ""; let stderr = ""; let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (analysisChild === child) analysisChild = null;
        if (error) rejectPromise(error); else resolvePromise(result);
      };
      child.stdout.on("data", (chunk) => { if (stdout.length < 2_000_000) stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { if (stderr.length < 20_000) stderr += chunk.toString(); });
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code !== 0) return finish(new Error(stderr.trim() || `Codex 分析失败（${code}）`));
        try { finish(null, JSON.parse(stdout.trim())); }
        catch { finish(new Error("Codex 返回的结构化结果无法识别")); }
      });
      const timer = setTimeout(() => { child.kill("SIGTERM"); finish(new Error("Codex 分析超过5分钟，已停止本次任务")); }, 5 * 60 * 1000);
      child.stdin.end(skilledPrompt);
    });
  } finally { analysisBusy = false; }
}

function cancelAnalysis() {
  if (!analysisChild || analysisChild.exitCode !== null) return false;
  const child = analysisChild;
  child.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000);
  timer.unref();
  return true;
}

async function ready(port, child) {
  const endpoint = `http://${HOST}:${port}/mcp`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("小红书 MCP 启动失败");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hongshutai-runtime", version: "0.1.0" } } }),
      });
      if (response.ok) return;
    } catch { void 0; }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("小红书 MCP 启动超时");
}

function stop(slot, reason = "release") {
  if (!slot.child) return;
  const child = slot.child;
  slot.leased = false;
  slot.stopping = true;
  child.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000);
  timer.unref();
  process.stdout.write(`运行槽位 ${slot.port} 已释放（${reason}）\n`);
}

async function startProcess(accountId, slot) {
  const accountRoot = join(root, accountId);
  const config = join(accountRoot, "config");
  const logs = join(accountRoot, "logs");
  for (const directory of [accountRoot, config, logs]) mkdirSync(directory, { recursive: true });
  const logFd = openSync(join(logs, "mcp.log"), "a");
  const child = spawn(binary, ["-port", `${HOST}:${slot.port}`, `-headless=${!HEADED_BROWSER}`], {
    cwd: accountRoot,
    env: { ...process.env, COOKIES_PATH: join(accountRoot, "cookies.json"), XDG_CONFIG_HOME: config },
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  slot.accountId = accountId;
  slot.child = child;
  slot.leased = true;
  slot.stopping = false;
  slot.lastUsed = Date.now();
  slot.startedAt = Date.now();
  slot.protectedUntil = 0;
  child.once("exit", () => {
    if (slot.child === child) {
      slot.child = null; slot.accountId = null; slot.leased = false; slot.stopping = false; slot.lastUsed = 0; slot.protectedUntil = 0;
      void drainQueue();
    }
  });
  try { await ready(slot.port, child); }
  catch (error) { stop(slot, "启动失败"); throw error; }
  process.stdout.write(`账号 ${accountId.slice(0, 8)} 已进入${slot.purpose === "verification" ? "可见验证" : "有头采集"}槽位 ${slot.port}\n`);
  return slot;
}

async function acquire(accountId, purpose = "worker") {
  const existing = slots.find((slot) => slot.purpose === purpose && slot.accountId === accountId && slot.child?.exitCode === null);
  if (existing && !existing.leased && !existing.stopping) {
    existing.leased = true; existing.lastUsed = Date.now(); return existing;
  }
  const conflicting = slots.find((slot) => slot.accountId === accountId && slot.purpose !== purpose && slot.child?.exitCode === null);
  const free = existing || conflicting ? null : slots.find((slot) => slot.purpose === purpose && !slot.child && !slot.stopping);
  if (free) return startProcess(accountId, free);
  return new Promise((resolvePromise, rejectPromise) => {
    const waiter = { accountId, purpose, resolvePromise, rejectPromise, createdAt: Date.now(), timer: null };
    waiter.timer = setTimeout(() => {
      const index = acquireQueue.indexOf(waiter);
      if (index >= 0) acquireQueue.splice(index, 1);
      rejectPromise(Object.assign(new Error("等待小红书运行槽位超过10分钟，任务已取消"), { status: 409 }));
    }, QUEUE_TIMEOUT_MS);
    waiter.timer.unref();
    acquireQueue.push(waiter);
    void drainQueue();
  });
}

function grant(waiter, slot) {
  clearTimeout(waiter.timer);
  slot.leased = true;
  slot.lastUsed = Date.now();
  waiter.resolvePromise(slot);
}

async function drainQueue() {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    while (acquireQueue.length) {
      const sameIndex = acquireQueue.findIndex((waiter) => slots.some((slot) => slot.purpose === waiter.purpose && slot.accountId === waiter.accountId && slot.child?.exitCode === null && !slot.leased && !slot.stopping));
      if (sameIndex >= 0) {
        const waiter = acquireQueue.splice(sameIndex, 1)[0];
        const slot = slots.find((candidate) => candidate.purpose === waiter.purpose && candidate.accountId === waiter.accountId && candidate.child?.exitCode === null && !candidate.leased && !candidate.stopping);
        if (slot) grant(waiter, slot);
        continue;
      }
      const eligibleIndex = acquireQueue.findIndex((waiter) => !slots.some((slot) => slot.accountId === waiter.accountId && slot.child?.exitCode === null)
        && slots.some((slot) => slot.purpose === waiter.purpose && !slot.child && !slot.stopping));
      if (eligibleIndex >= 0) {
        const waiter = acquireQueue.splice(eligibleIndex, 1)[0];
        const free = slots.find((slot) => slot.purpose === waiter.purpose && !slot.child && !slot.stopping);
        clearTimeout(waiter.timer);
        try { waiter.resolvePromise(await startProcess(waiter.accountId, free)); }
        catch (error) { waiter.rejectPromise(error); }
        continue;
      }
      const waiter = acquireQueue[0];
      const conflict = slots.find((slot) => slot.accountId === waiter.accountId && slot.purpose !== waiter.purpose && slot.child && !slot.leased && !slot.stopping && Date.now() >= slot.protectedUntil);
      if (conflict) { stop(conflict, "切换运行模式"); continue; }
      const reclaimable = slots.filter((slot) => slot.purpose === waiter.purpose && slot.child && !slot.leased && !slot.stopping && Date.now() >= slot.protectedUntil).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (reclaimable) stop(reclaimable, "切换账号");
      break;
    }
  } finally { drainingQueue = false; }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${HOST}:${MANAGER_PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, capacity: SLOT_PORTS.length, active: slots.filter((slot) => slot.purpose === "worker" && slot.child).length, verificationActive: Boolean(slots.find((slot) => slot.purpose === "verification")?.child) });
    }
    if (request.method === "GET" && url.pathname === "/slots") {
      return json(response, 200, { pending: acquireQueue.length, slots: slots.map((slot) => ({ port: slot.port, purpose: slot.purpose, accountId: slot.accountId, active: Boolean(slot.child), busy: slot.leased, stopping: slot.stopping, protectedUntil: slot.protectedUntil, lastUsed: slot.lastUsed })) });
    }
    if (request.method === "GET" && url.pathname === "/codex/health") {
      return json(response, 200, { ok: existsSync(codexBinary), busy: analysisBusy, authenticatedBy: "ChatGPT", expertSkill: existsSync(xhsExpertSkill), expertSkillName: "xiaohongshu-operations-expert" });
    }
    if (request.method === "POST" && url.pathname === "/codex/run") {
      const payload = await body(request);
      if (typeof payload.prompt !== "string" || payload.prompt.length < 5 || payload.prompt.length > 250_000) return json(response, 400, { error: "分析任务内容不合法" });
      const result = await runCodex(payload.kind, payload.prompt);
      return json(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/codex/cancel") {
      return json(response, 200, { ok: true, cancelled: cancelAnalysis() });
    }
    if (request.method === "POST" && url.pathname === "/publish-assets") {
      const payload = await body(request);
      if (!validAccountId(payload.claimId)) return json(response, 400, { error: "内容任务标识不合法" });
      if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 9) return json(response, 400, { error: "每篇笔记需要上传1-9张图片" });
      const claimRoot = join(publishAssetRoot, payload.claimId);
      mkdirSync(claimRoot, { recursive: true });
      let totalBytes = 0;
      const paths = payload.files.map((file, index) => {
        const mime = String(file.type || "").toLowerCase();
        const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "";
        if (!extension || typeof file.data !== "string") throw Object.assign(new Error("只支持 JPG、PNG 或 WebP 图片"), { status: 400 });
        const buffer = Buffer.from(file.data, "base64");
        totalBytes += buffer.length;
        if (!buffer.length || buffer.length > 12 * 1024 * 1024 || totalBytes > 60 * 1024 * 1024) throw Object.assign(new Error("图片为空或文件总大小超过限制"), { status: 400 });
        const path = join(claimRoot, `${Date.now()}-${index + 1}.${extension}`);
        writeFileSync(path, buffer, { mode: 0o600 });
        return path;
      });
      return json(response, 200, { ok: true, paths });
    }
    if (request.method === "POST" && url.pathname === "/cover-cache") {
      const payload = await body(request);
      const path = await cacheTrendCover(payload.feedId, payload.sourceUrl);
      return json(response, 200, { ok: true, path });
    }
    if (request.method === "POST" && ["/acquire", "/release", "/discard", "/touch"].includes(url.pathname)) {
      const payload = await body(request);
      if (!validAccountId(payload.accountId)) return json(response, 400, { error: "账号标识不合法" });
      const purpose = payload.purpose ?? "worker";
      if (!validPurpose(purpose)) return json(response, 400, { error: "运行用途不合法" });
      if (url.pathname === "/acquire") {
        const slot = await acquire(payload.accountId, purpose);
        return json(response, 200, leaseResult(slot));
      }
      const slot = slots.find((candidate) => candidate.accountId === payload.accountId && candidate.purpose === purpose);
      if (url.pathname === "/discard") { if (slot) stop(slot, "异常重启"); return json(response, 200, { ok: true }); }
      if (url.pathname === "/release") {
        if (slot) {
          slot.leased = false; slot.lastUsed = Date.now();
          slot.protectedUntil = purpose === "verification" ? Date.now() + Math.max(0, Math.min(Number(payload.holdMs) || 0, VERIFICATION_IDLE_TIMEOUT_MS)) : 0;
          if (payload.close === true && purpose === "verification") stop(slot, "验证完成");
          else void drainQueue();
        }
        return json(response, 200, { ok: true });
      }
      if (slot) slot.lastUsed = Date.now();
      return json(response, 200, { ok: Boolean(slot) });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, error?.status || 500, { error: error instanceof Error ? error.message : "运行管理器异常" });
  }
});

const sweep = setInterval(() => {
  const now = Date.now();
  for (const slot of slots) {
    const timeout = slot.purpose === "verification" ? VERIFICATION_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
    if (slot.child && !slot.leased && !slot.stopping && now >= slot.protectedUntil && now - slot.lastUsed > timeout) stop(slot, "空闲超时");
  }
}, 30_000);
sweep.unref();

function shutdown() {
  cancelAnalysis();
  for (const slot of slots) stop(slot, "平台关闭");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(MANAGER_PORT, HOST, () => process.stdout.write(`小红书运行管理器：http://${HOST}:${MANAGER_PORT}，采集槽位 ${SLOT_PORTS.join("、")}，可见验证槽位 ${VERIFICATION_PORT}\n`));
