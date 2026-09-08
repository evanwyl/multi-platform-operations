import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "127.0.0.1";
const MANAGER_PORT = Number(process.env.MANAGER_PORT || 18100);
const SLOT_PORTS = [18061, 18062];
const VERIFICATION_PORT = 18063;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFICATION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const HEADED_BROWSER = true;
const managerToken = String(process.env.RUNTIME_MANAGER_TOKEN || "").trim();
const appRoot = resolve(process.env.HONGSHUTAI_APP_ROOT || process.cwd());
const dataRoot = resolve(process.env.HONGSHUTAI_DATA_ROOT || process.cwd());
const root = resolve(dataRoot, "runtime/accounts");
const analysisRoot = resolve(dataRoot, "runtime/analysis");
const publishAssetRoot = resolve(dataRoot, "runtime/publish-assets");
const trendCoverRoot = resolve(dataRoot, "runtime/trend-covers");
const configRoot = resolve(dataRoot, "runtime/config");
const aiConfigPath = join(configRoot, "ai.json");
const bundledXhsBinary = resolve(appRoot, "runtime/bin/xiaohongshu-mcp-darwin-arm64");
const legacyXhsBinary = join(homedir(), ".hermes/services/xiaohongshu-mcp/bin/xiaohongshu-mcp-darwin-arm64");
const binary = process.env.XHS_MCP_BINARY || (existsSync(bundledXhsBinary) ? bundledXhsBinary : legacyXhsBinary);
const promptFiles = {
  research: resolve(appRoot, "runtime/prompts/research-system.md"),
  content: resolve(appRoot, "runtime/prompts/content-system.md"),
  humanizer: resolve(appRoot, "runtime/prompts/humanizer-system.md"),
};
const analysisSchemas = {
  "trend-plan": resolve(appRoot, "runtime/trend-plan.schema.json"),
  "candidate-screen": resolve(appRoot, "runtime/candidate-screen.schema.json"),
  "topic-analysis": resolve(appRoot, "runtime/topic-analysis.schema.json"),
  "content-draft": resolve(appRoot, "runtime/content-draft.schema.json"),
};

process.umask(0o077);
if (managerToken.length < 32) {
  process.stderr.write("本机运行管理器缺少安全访问令牌。请使用 npm run dev 或 npm start 启动平台。\n");
  process.exit(1);
}

mkdirSync(root, { recursive: true });
mkdirSync(analysisRoot, { recursive: true });
mkdirSync(publishAssetRoot, { recursive: true });
mkdirSync(trendCoverRoot, { recursive: true });
mkdirSync(configRoot, { recursive: true });
for (const directory of [root, analysisRoot, publishAssetRoot, trendCoverRoot, configRoot]) chmodSync(directory, 0o700);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const accountRoot = join(root, entry.name);
  chmodSync(accountRoot, 0o700);
  for (const child of ["config", "logs"]) {
    const directory = join(accountRoot, child);
    if (existsSync(directory)) chmodSync(directory, 0o700);
  }
  const cookies = join(accountRoot, "cookies.json");
  if (existsSync(cookies)) chmodSync(cookies, 0o600);
}
if (!existsSync(binary)) {
  process.stderr.write(`找不到小红书 MCP。请设置 XHS_MCP_BINARY，或把可执行文件放到：${bundledXhsBinary}\n`);
  process.exit(1);
}

const slots = [
  ...SLOT_PORTS.map((port) => ({ port, purpose: "worker", accountId: null, child: null, leased: false, stopping: false, lastUsed: 0, startedAt: 0, protectedUntil: 0 })),
  { port: VERIFICATION_PORT, purpose: "verification", accountId: null, child: null, leased: false, stopping: false, lastUsed: 0, startedAt: 0, protectedUntil: 0 },
];
const acquireQueue = [];
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
let analysisBusy = false;
let analysisController = null;
let drainingQueue = false;

const defaultAISettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiKey: "",
};

function readAISettings() {
  let saved = {};
  try { saved = JSON.parse(readFileSync(aiConfigPath, "utf8")); } catch { void 0; }
  return {
    baseUrl: String(process.env.AI_BASE_URL || saved.baseUrl || defaultAISettings.baseUrl).trim().replace(/\/+$/, ""),
    model: String(process.env.AI_MODEL || saved.model || defaultAISettings.model).trim(),
    apiKey: String(process.env.AI_API_KEY || saved.apiKey || "").trim(),
  };
}

function publicAISettings() {
  const settings = readAISettings();
  return {
    configured: Boolean(settings.apiKey && settings.model && settings.baseUrl),
    baseUrl: settings.baseUrl,
    model: settings.model,
    keySource: process.env.AI_API_KEY ? "environment" : settings.apiKey ? "local" : "none",
    busy: analysisBusy,
  };
}

function validateBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw Object.assign(new Error("AI API 地址格式不正确"), { status: 400 }); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password || !["https:", ...(local ? ["http:"] : [])].includes(url.protocol)) {
    throw Object.assign(new Error("远程 AI API 必须使用 HTTPS；本机服务可以使用 HTTP"), { status: 400 });
  }
  return url.toString().replace(/\/+$/, "");
}

function saveAISettings(payload) {
  if (process.env.AI_API_KEY) throw Object.assign(new Error("AI 配置由环境变量管理，不能从页面修改"), { status: 409 });
  const current = readAISettings();
  const next = {
    baseUrl: validateBaseUrl(payload.baseUrl ?? current.baseUrl),
    model: String(payload.model ?? current.model).trim().slice(0, 160),
    apiKey: String(payload.apiKey ?? "").trim() || current.apiKey,
  };
  if (!next.model) throw Object.assign(new Error("请填写 AI 模型名称"), { status: 400 });
  if (!next.apiKey) throw Object.assign(new Error("请填写 AI API Key"), { status: 400 });
  const temporary = `${aiConfigPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, aiConfigPath);
  return publicAISettings();
}

function systemPrompt(kind) {
  if (kind !== "content-draft") {
    if (!existsSync(promptFiles.research)) throw Object.assign(new Error("平台内置 AI 规则缺失"), { status: 503 });
    return readFileSync(promptFiles.research, "utf8");
  }
  if (!existsSync(promptFiles.content) || !existsSync(promptFiles.humanizer)) {
    throw Object.assign(new Error("平台内置小红书专家或 Humanizer 规则缺失"), { status: 503 });
  }
  return `${readFileSync(promptFiles.content, "utf8")}\n\n<EMBEDDED_HUMANIZER_SKILL>\n${readFileSync(promptFiles.humanizer, "utf8")}\n</EMBEDDED_HUMANIZER_SKILL>`;
}

function strictProviderSchema(value) {
  if (Array.isArray(value)) return value.map(strictProviderSchema);
  if (!value || typeof value !== "object") return value;
  const unsupported = new Set(["$schema", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "pattern", "format", "uniqueItems"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !unsupported.has(key))
    .map(([key, item]) => [key, strictProviderSchema(item)]));
}

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
    const filename = `${feedId}.${extension}`;
    if (existsSync(join(trendCoverRoot, filename))) return trendCoverUrl(filename);
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
  const filename = `${feedId}.${extension}`;
  writeFileSync(join(trendCoverRoot, filename), buffer, { mode: 0o600 });
  return trendCoverUrl(filename);
}

function trendCoverKey(filename) {
  return createHmac("sha256", managerToken).update(`trend-cover:${filename}`).digest("hex");
}

function trendCoverUrl(filename) {
  return `http://${HOST}:${MANAGER_PORT}/trend-covers/${filename}?key=${trendCoverKey(filename)}`;
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

function completionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
}

function providerError(payload, status) {
  const message = payload?.error?.message || payload?.message;
  return String(message || `AI 服务请求失败（${status}）`).slice(0, 1000);
}

async function requestCompletion(settings, requestBody, signal) {
  let response;
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw Object.assign(new Error("AI 任务已停止"), { status: 499 });
    throw Object.assign(new Error(`无法连接 AI API：${error instanceof Error ? error.message : "网络错误"}`), { status: 502 });
  }
  const raw = await response.text();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { void 0; }
  if (!response.ok) throw Object.assign(new Error(providerError(payload, response.status)), { status: response.status === 401 ? 401 : 502, providerStatus: response.status });
  return payload;
}

async function runAI(kind, prompt) {
  const schema = analysisSchemas[kind];
  if (!schema || !existsSync(schema)) throw Object.assign(new Error("AI 结构化输出格式未配置"), { status: 400 });
  const settings = readAISettings();
  if (!settings.apiKey) throw Object.assign(new Error("尚未配置 AI API Key，请让管理员前往系统设置完成配置"), { status: 503 });
  if (analysisBusy) throw Object.assign(new Error("AI 正在处理上一项任务，请稍后重试"), { status: 409 });
  analysisBusy = true;
  const controller = new AbortController();
  analysisController = controller;
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const outputSchema = JSON.parse(readFileSync(schema, "utf8"));
    const structuredSchema = strictProviderSchema(outputSchema);
    const messages = [
      { role: "system", content: systemPrompt(kind) },
      { role: "user", content: prompt },
    ];
    const structuredBody = {
      model: settings.model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: kind.replace(/-/g, "_"), strict: true, schema: structuredSchema },
      },
    };
    let payload;
    try {
      payload = await requestCompletion(settings, structuredBody, controller.signal);
    } catch (error) {
      const fallbackEligible = error?.providerStatus === 400 && /json.?schema|response.?format|structured|unsupported/i.test(error.message || "");
      if (!fallbackEligible) throw error;
      payload = await requestCompletion(settings, {
        model: settings.model,
        messages: [
          { role: "system", content: `${systemPrompt(kind)}\n\n你必须只返回一个符合以下 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块：\n${JSON.stringify(outputSchema)}` },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }, controller.signal);
    }
    const text = completionText(payload).trim();
    if (!text) throw Object.assign(new Error(payload?.choices?.[0]?.message?.refusal || "AI 没有返回可识别的内容"), { status: 502 });
    try { return JSON.parse(text); }
    catch { throw Object.assign(new Error("AI 返回的结构化结果无法识别，请更换支持 JSON 输出的模型"), { status: 502 }); }
  } finally {
    clearTimeout(timeout);
    if (analysisController === controller) analysisController = null;
    analysisBusy = false;
  }
}

async function testAIConnection(overrides = {}) {
  const current = readAISettings();
  const settings = {
    baseUrl: overrides.baseUrl ? validateBaseUrl(overrides.baseUrl) : current.baseUrl,
    model: String(overrides.model || current.model).trim(),
    apiKey: String(overrides.apiKey || current.apiKey).trim(),
  };
  if (!settings.apiKey) throw Object.assign(new Error("尚未配置 AI API Key"), { status: 503 });
  if (!settings.model) throw Object.assign(new Error("请填写 AI 模型名称"), { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const payload = await requestCompletion(settings, {
      model: settings.model,
      messages: [{ role: "user", content: "只回复 OK" }],
    }, controller.signal);
    if (!completionText(payload).trim()) throw Object.assign(new Error("AI 服务已响应，但没有返回文本"), { status: 502 });
    return { ok: true, model: settings.model };
  } finally { clearTimeout(timeout); }
}

function cancelAnalysis() {
  if (!analysisController) return false;
  analysisController.abort();
  return true;
}

async function ready(port, child) {
  const endpoint = `http://${HOST}:${port}/mcp`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("小红书 MCP 启动失败");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${managerToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hongshutai-runtime", version: "0.1.0" } } }),
      });
      if (response.ok) return;
    } catch { void 0; }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("小红书 MCP 就绪检查超时，请查看账号运行日志");
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
  for (const directory of [accountRoot, config, logs]) chmodSync(directory, 0o700);
  const cookiePath = join(accountRoot, "cookies.json");
  if (existsSync(cookiePath)) chmodSync(cookiePath, 0o600);
  const logFd = openSync(join(logs, "mcp.log"), "a");
  const child = spawn(binary, ["-port", `${HOST}:${slot.port}`, `-headless=${!HEADED_BROWSER}`], {
    cwd: accountRoot,
    env: { ...process.env, AUTH_TOKEN: managerToken, COOKIES_PATH: cookiePath, XDG_CONFIG_HOME: config },
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
    const coverMatch = request.method === "GET" ? url.pathname.match(/^\/trend-covers\/([a-zA-Z0-9_-]{8,100}\.(?:jpg|png|webp|avif))$/) : null;
    if (coverMatch) {
      const filename = coverMatch[1];
      const expected = Buffer.from(trendCoverKey(filename));
      const supplied = Buffer.from(url.searchParams.get("key") || "");
      const coverPath = join(trendCoverRoot, filename);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || !existsSync(coverPath)) {
        return json(response, 404, { error: "Not found" });
      }
      const extension = filename.split(".").pop();
      const contentType = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" }[extension] || "application/octet-stream";
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "private, max-age=86400",
        "cross-origin-resource-policy": "same-site",
        "x-content-type-options": "nosniff",
      });
      return response.end(readFileSync(coverPath));
    }
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(managerToken);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return json(response, 401, { error: "本机运行服务拒绝了未授权请求" });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, capacity: SLOT_PORTS.length, active: slots.filter((slot) => slot.purpose === "worker" && slot.child).length, verificationActive: Boolean(slots.find((slot) => slot.purpose === "verification")?.child) });
    }
    if (request.method === "GET" && url.pathname === "/slots") {
      return json(response, 200, { pending: acquireQueue.length, slots: slots.map((slot) => ({ port: slot.port, purpose: slot.purpose, accountId: slot.accountId, active: Boolean(slot.child), busy: slot.leased, stopping: slot.stopping, protectedUntil: slot.protectedUntil, lastUsed: slot.lastUsed })) });
    }
    if (request.method === "GET" && url.pathname === "/publish-asset") {
      const assetPath = resolve(url.searchParams.get("path") || "");
      const relative = assetPath.slice(publishAssetRoot.length + 1);
      if (!relative || assetPath === publishAssetRoot || !assetPath.startsWith(`${publishAssetRoot}/`) || relative.includes("..") || !existsSync(assetPath)) {
        return json(response, 404, { error: "图片不存在" });
      }
      const extension = assetPath.split(".").pop()?.toLowerCase();
      const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[extension] || "application/octet-stream";
      response.writeHead(200, { "content-type": contentType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" });
      return response.end(readFileSync(assetPath));
    }
    if (request.method === "GET" && url.pathname === "/ai/settings") {
      return json(response, 200, publicAISettings());
    }
    if (request.method === "POST" && url.pathname === "/ai/settings") {
      return json(response, 200, saveAISettings(await body(request)));
    }
    if (request.method === "POST" && url.pathname === "/ai/test") {
      return json(response, 200, await testAIConnection(await body(request)));
    }
    if (request.method === "GET" && url.pathname === "/ai/health") {
      return json(response, 200, { ok: publicAISettings().configured, ...publicAISettings(), rulesBundled: Object.values(promptFiles).every(existsSync) });
    }
    if (request.method === "POST" && url.pathname === "/ai/run") {
      const payload = await body(request);
      if (typeof payload.prompt !== "string" || payload.prompt.length < 5 || payload.prompt.length > 250_000) return json(response, 400, { error: "分析任务内容不合法" });
      const result = await runAI(payload.kind, payload.prompt);
      return json(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/ai/cancel") {
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
