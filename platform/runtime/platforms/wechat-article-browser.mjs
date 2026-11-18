import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

let session = null;
const readerPages = new Map();

const browserCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findExecutable(root, names) {
  if (!existsSync(root)) return "";
  const pending = [root];
  while (pending.length) {
    const directory = pending.shift();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isFile() && names.has(entry.name.toLowerCase())) return path;
      if (entry.isDirectory()) pending.push(path);
    }
  }
  return "";
}

function browserExecutables(appRoot) {
  const configured = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "").trim();
  const bundled = resolve(appRoot, "runtime/bin/chromium/Chromium.app/Contents/MacOS/Chromium");
  const windowsRoot = resolve(appRoot, "runtime/bin/chromium");
  const windowsBundled = process.platform === "win32"
    ? findExecutable(windowsRoot, new Set(["chrome.exe", "headless_shell.exe"]))
    : "";
  return [...new Set([configured, ...browserCandidates, bundled, windowsBundled].filter((item) => item && existsSync(item)))];
}

function articleUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.hostname !== "mp.weixin.qq.com")
    throw Object.assign(new Error("本地微信正文读取器只允许打开 mp.weixin.qq.com 文章"), { status: 400 });
  return url.toString();
}

function readerId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id))
    throw Object.assign(new Error("微信正文读取任务标识不合法"), { status: 400 });
  return id;
}

async function context(platformAccountRoot, appRoot) {
  if (session) return session;
  const root = resolve(platformAccountRoot, "wechat-article-reader");
  const profile = resolve(root, "browser-profile");
  mkdirSync(profile, { recursive: true });
  chmodSync(root, 0o700);
  chmodSync(profile, 0o700);
  const executables = browserExecutables(appRoot);
  if (!executables.length)
    throw Object.assign(new Error("未找到微信正文验证浏览器，请安装 Google Chrome 后重试"), { status: 503 });
  let lastError;
  for (const executablePath of executables) {
    try {
      const launched = await chromium.launchPersistentContext(profile, {
        executablePath,
        headless: false,
        viewport: { width: 1180, height: 820 },
        locale: "zh-CN",
        args: ["--disable-blink-features=AutomationControlled"],
      });
      session = launched;
      launched.on("close", () => { if (session === launched) session = null; });
      return launched;
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error(`无法启动微信正文验证浏览器${lastError instanceof Error ? `：${lastError.message.split("\n")[0]}` : ""}`), { status: 503 });
}

export async function openWechatArticleReader(platformAccountRoot, appRoot, id, rawUrl) {
  const key = readerId(id);
  const target = articleUrl(rawUrl);
  const active = await context(platformAccountRoot, appRoot);
  const previous = readerPages.get(key);
  const page = previous && !previous.isClosed() ? previous : await active.newPage();
  readerPages.set(key, page);
  page.on("close", () => { if (readerPages.get(key) === page) readerPages.delete(key); });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.bringToFront();
  return { ok: true, opened: true, verification_required: !await page.locator("#js_content").isVisible().catch(() => false) };
}

async function readPage(page) {
  const result = await page.evaluate(() => {
      const content = document.querySelector("#js_content");
      const text = content?.textContent?.replace(/[\t\r ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim() || "";
      const title = document.querySelector("#activity-name")?.textContent?.trim()
        || document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim()
        || document.title.trim();
      const author = document.querySelector("#js_name")?.textContent?.trim()
        || document.querySelector('meta[name="author"]')?.getAttribute("content")?.trim()
        || "";
      const timestamp = typeof window.ct === "string" || typeof window.ct === "number" ? String(window.ct) : "";
      return { text, title, author, timestamp, url: location.href };
  }).catch(() => null);
  if (!result || result.text.length < 300) return null;
  return {
    text: result.text.slice(0, 30000),
    title: result.title.slice(0, 300),
    author: result.author.slice(0, 160),
    published_at: /^\d{10}$/.test(result.timestamp) ? new Date(Number(result.timestamp) * 1000).toISOString() : "",
    source_url: articleUrl(result.url),
  };
}

const unavailableMessages = [
  "该内容已被发布者删除",
  "该内容已被删除",
  "此内容已被删除",
  "此内容因违规无法查看",
  "该内容因违规无法查看",
  "该内容暂时无法查看",
  "内容已失效",
  "页面不存在",
  "文章不存在",
];

async function inspectPage(page) {
  const article = await readPage(page);
  if (article) return { status: "success", article };
  const state = await page.evaluate((messages) => {
    const text = document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
    const matched = messages.find((message) => text.includes(message)) || "";
    const verification = /环境异常|完成验证|安全验证|访问过于频繁|拖动下方滑块|请输入验证码/.test(text)
      || /\/mp\/(?:verify|wappoc_appmsgcaptcha)|secitptpage\/verify/.test(location.href)
      || Boolean(document.querySelector("#wappoc_appmsgcaptcha, .verify_container, .tcaptcha-transform"));
    return { matched, verification, textLength: text.length, url: location.href };
  }, unavailableMessages).catch(() => ({ matched: "", verification: false, textLength: 0, url: "" }));
  if (state.matched) return { status: "unavailable", reason: state.matched };
  if (state.verification) return { status: "verification_required", reason: "微信正文触发访问验证" };
  return { status: "unreadable", reason: state.textLength ? "页面未包含可读取的公众号正文" : "公众号文章页面加载失败" };
}

export async function captureWechatArticle(platformAccountRoot, appRoot, id) {
  await context(platformAccountRoot, appRoot);
  const key = readerId(id);
  const page = readerPages.get(key);
  if (!page || page.isClosed())
    throw Object.assign(new Error("请先点击“在验证窗口打开”"), { status: 409 });
  const result = await readPage(page);
  if (result) return { ok: true, ...result };
  throw Object.assign(new Error("验证窗口里还没有可读取的公众号正文，请完成验证并确认文章已经显示"), { status: 409 });
}

export async function captureWechatArticleBatch(platformAccountRoot, appRoot, items) {
  const active = await context(platformAccountRoot, appRoot);
  const queue = Array.isArray(items) ? items.slice(0, 10) : [];
  if (!queue.length)
    throw Object.assign(new Error("没有待批量读取的公众号文章"), { status: 400 });
  const firstId = readerId(queue[0]?.id);
  const previous = readerPages.get(firstId);
  const page = previous && !previous.isClosed() ? previous : await active.newPage();
  readerPages.set(firstId, page);
  page.on("close", () => { if (readerPages.get(firstId) === page) readerPages.delete(firstId); });
  const results = [];
  const skipped = [];
  let verificationRequiredId = "";
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    const id = readerId(item?.id);
    const url = articleUrl(item?.url);
    if (index > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200 + Math.floor(Math.random() * 1000)));
    }
    const navigated = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1200).catch(() => undefined);
    let state = await inspectPage(page);
    if (state.status === "verification_required") {
      await page.bringToFront().catch(() => undefined);
      const deadline = Date.now() + 180_000;
      while (state.status === "verification_required" && Date.now() < deadline && !page.isClosed()) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
        state = await inspectPage(page);
      }
      if (state.status === "verification_required") {
        verificationRequiredId = id;
        break;
      }
    }
    if (state.status === "success") {
      results.push({ id, ...state.article });
      continue;
    }
    if (state.status === "unreadable" && navigated) {
      await page.waitForTimeout(2500).catch(() => undefined);
      state = await inspectPage(page);
      if (state.status === "success") {
        results.push({ id, ...state.article });
        continue;
      }
      if (state.status === "verification_required") {
        verificationRequiredId = id;
        await page.bringToFront().catch(() => undefined);
        break;
      }
    }
    skipped.push({ id, reason: state.reason || "公众号文章已失效或无法读取" });
  }
  return {
    ok: true,
    results,
    skipped,
    requested: queue.length,
    verification_required_id: verificationRequiredId,
    completed: results.length,
    skipped_count: skipped.length,
  };
}
