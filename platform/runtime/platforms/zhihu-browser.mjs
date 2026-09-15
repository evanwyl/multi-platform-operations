import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const sessions = new Map();
const browserCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function validAccountId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value)) throw Object.assign(new Error("知乎账号标识不合法"), { status: 400 });
  return value;
}

function profilePath(platformAccountRoot, accountId) {
  const root = resolve(platformAccountRoot, validAccountId(accountId));
  const profile = resolve(root, "zhihu-profile");
  mkdirSync(profile, { recursive: true });
  chmodSync(root, 0o700);
  chmodSync(profile, 0o700);
  return profile;
}

function browserExecutables(appRoot) {
  const configured = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "").trim();
  const bundled = resolve(appRoot, "runtime/bin/chromium/Chromium.app/Contents/MacOS/Chromium");
  return [...new Set([configured, ...browserCandidates, bundled].filter((candidate) => candidate && existsSync(candidate)))];
}

async function launchContext(platformAccountRoot, appRoot, accountId, headless) {
  const executables = browserExecutables(appRoot);
  if (!executables.length) throw Object.assign(new Error("未找到知乎登录浏览器。请安装 Google Chrome 后重试"), { status: 503 });
  let lastError;
  for (const executablePath of executables) {
    try {
      return await chromium.launchPersistentContext(profilePath(platformAccountRoot, accountId), {
        executablePath,
        headless,
        viewport: { width: 1280, height: 820 },
        locale: "zh-CN",
        args: ["--disable-blink-features=AutomationControlled"],
      });
    } catch (error) { lastError = error; }
  }
  throw Object.assign(new Error(`无法启动知乎浏览器${lastError instanceof Error ? `：${lastError.message.split("\n")[0]}` : ""}`), { status: 503 });
}

async function loginState(context) {
  const cookies = await context.cookies("https://www.zhihu.com");
  const authenticated = cookies.some((cookie) => cookie.name === "z_c0" && cookie.value);
  return { authenticated, auth_method: authenticated ? "browser" : "", configured: authenticated };
}

export async function openZhihuBrowserLogin(platformAccountRoot, appRoot, accountId) {
  validAccountId(accountId);
  const prior = sessions.get(accountId);
  if (prior) { try { await prior.close(); } catch { void 0; } }
  const context = await launchContext(platformAccountRoot, appRoot, accountId, false);
  sessions.set(accountId, context);
  context.on("close", () => { if (sessions.get(accountId) === context) sessions.delete(accountId); });
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://www.zhihu.com/signin", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.bringToFront();
  return { ok: true, opened: true, ...(await loginState(context)) };
}

export async function zhihuBrowserAuthStatus(platformAccountRoot, appRoot, accountId, closeAfter = false) {
  validAccountId(accountId);
  let context = sessions.get(accountId);
  let temporary = false;
  if (!context) { context = await launchContext(platformAccountRoot, appRoot, accountId, true); temporary = true; }
  try {
    const state = await loginState(context);
    if (state.authenticated && !temporary) {
      const page = context.pages()[0];
      if (page) await page.goto("https://www.zhihu.com/creator", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    }
    return state;
  } finally {
    if (temporary || closeAfter) { try { await context.close(); } catch { void 0; } sessions.delete(accountId); }
  }
}

function publishedArticle(page) {
  try {
    const url = new URL(page.url());
    const match = url.hostname === "zhuanlan.zhihu.com" && !url.pathname.endsWith("/edit")
      ? url.pathname.match(/^\/p\/(\d+)\/?$/)
      : null;
    return match ? { url: url.href, contentToken: match[1] } : null;
  } catch { return null; }
}

async function firstVisible(page, selectors, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      for (let index = 0; index < await candidates.count(); index += 1) {
        const candidate = candidates.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(250, deadline - Date.now()));
  } while (Date.now() <= deadline);
  return null;
}

export async function publishZhihuArticleBrowser(platformAccountRoot, appRoot, payload) {
  const accountId = validAccountId(payload?.accountId);
  const title = String(payload?.title || "").trim();
  const body = String(payload?.body || "").trim();
  if (!title || !body) throw Object.assign(new Error("知乎专栏标题和正文不能为空"), { status: 400 });
  const active = sessions.get(accountId);
  if (active) { try { await active.close(); } catch { void 0; } sessions.delete(accountId); }
  const context = await launchContext(platformAccountRoot, appRoot, accountId, false);
  let publishClicked = false;
  try {
    if (!(await loginState(context)).authenticated) throw Object.assign(new Error("知乎登录已失效，请先到账号管理重新登录"), { status: 409 });
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://zhuanlan.zhihu.com/write", { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (/signin|login/i.test(page.url())) throw Object.assign(new Error("知乎登录已失效，请先到账号管理重新登录"), { status: 409 });

    const titleInput = await firstVisible(page, ["textarea[placeholder='请输入标题（最多 100 个字）']", ".WriteIndex-titleInput textarea", "textarea[placeholder*='标题']", "input[placeholder*='标题']", "textarea"]);
    if (!titleInput) throw new Error("知乎专栏页面没有找到标题输入框，页面结构可能已更新");
    await titleInput.fill(title);

    const editor = await firstVisible(page, [".public-DraftEditor-content[contenteditable='true']", ".public-DraftEditor-content", "[contenteditable='true']"]);
    if (!editor) throw new Error("知乎专栏页面没有找到正文编辑器，页面结构可能已更新");
    await editor.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.insertText(body);
    const inserted = String(await editor.innerText().catch(() => "")).trim();
    if (inserted.length < Math.min(10, body.length)) throw new Error("知乎正文没有成功写入编辑器，本次尚未点击发布");

    await page.waitForTimeout(1_500);
    const publishButton = await firstVisible(page, ["button:text-is('发布')"]);
    if (!publishButton) throw new Error("知乎页面没有找到精确的“发布”按钮，本次尚未提交");
    await publishButton.scrollIntoViewIfNeeded();
    await publishButton.click({ timeout: 10_000 });
    publishClicked = true;

    for (let round = 0; round < 60; round += 1) {
      const published = publishedArticle(page);
      if (published) return { ...published, detail: "知乎专栏已通过浏览器发布并确认文章地址", auth_method: "browser" };
      if (round === 2 || round === 8) {
        const confirmation = await firstVisible(page, [
          "[role='dialog'] button:text-is('发布')", "[role='dialog'] button:has-text('确认发布')",
          "[role='dialog'] button:text-is('确定')", ".Modal-wrapper button:has-text('发布')",
        ], 0);
        if (confirmation) await confirmation.click({ timeout: 5_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(500);
    }
    throw Object.assign(new Error(`知乎发布按钮已触发，但30秒内无法确认文章地址（当前页面：${page.url()}）`), { uncertain: true });
  } catch (error) {
    const pages = context.pages();
    const page = pages[pages.length - 1];
    if (page) await page.screenshot({ path: resolve(profilePath(platformAccountRoot, accountId), "publish-failure.png"), fullPage: true }).catch(() => undefined);
    if (publishClicked && !error?.uncertain) throw Object.assign(new Error(`知乎发布按钮已触发，但结果无法确认：${error instanceof Error ? error.message : "未知异常"}`), { uncertain: true });
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function closeZhihuBrowsers() {
  const contexts = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(contexts.map((context) => context.close()));
}
