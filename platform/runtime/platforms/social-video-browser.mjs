import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

// Browser workflow patterns and selector fallbacks are adapted from
// dreammis/social-auto-upload (MIT). See THIRD_PARTY_NOTICES.md.
const sessions = new Map();
const definitions = {
  douyin: {
    label: "抖音",
    loginUrl: "https://creator.douyin.com/creator-micro/content/upload",
    origin: "https://creator.douyin.com",
    profileName: "douyin-profile",
    loginMarkers: ["text=扫码登录", "text=验证码登录", "iframe[src*='passport']"],
    publishUrl: "https://creator.douyin.com/creator-micro/content/upload",
  },
  wechat_channels: {
    label: "视频号",
    loginUrl: "https://channels.weixin.qq.com/platform",
    origin: "https://channels.weixin.qq.com",
    profileName: "wechat-channels-profile",
    loginMarkers: ["text=微信扫码登录", "iframe[src*='open.weixin.qq.com']"],
    publishUrl: "https://channels.weixin.qq.com/platform",
  },
};
const browserCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function platformDefinition(platform) {
  const definition = definitions[platform];
  if (!definition) throw Object.assign(new Error("不支持的视频平台"), { status: 400 });
  return definition;
}

function validAccountId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value))
    throw Object.assign(new Error("账号标识不合法"), { status: 400 });
  return value;
}

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
  const windowsBundled = process.platform === "win32"
    ? findExecutable(resolve(appRoot, "runtime/bin/chromium"), new Set(["chrome.exe", "headless_shell.exe"]))
    : "";
  return [...new Set([configured, ...browserCandidates, bundled, windowsBundled].filter((item) => item && existsSync(item)))];
}

function profilePath(platformAccountRoot, platform, accountId) {
  const definition = platformDefinition(platform);
  const accountRoot = resolve(platformAccountRoot, validAccountId(accountId));
  const profile = resolve(accountRoot, definition.profileName);
  mkdirSync(profile, { recursive: true });
  chmodSync(accountRoot, 0o700);
  chmodSync(profile, 0o700);
  return profile;
}

async function launchContext(platformAccountRoot, appRoot, platform, accountId, headless) {
  const executables = browserExecutables(appRoot);
  if (!executables.length) throw Object.assign(new Error("未找到可用的 Chromium 浏览器"), { status: 503 });
  let lastError;
  for (const executablePath of executables) {
    try {
      return await chromium.launchPersistentContext(profilePath(platformAccountRoot, platform, accountId), {
        executablePath,
        headless,
        viewport: { width: 1440, height: 960 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        args: ["--disable-blink-features=AutomationControlled"],
      });
    } catch (error) { lastError = error; }
  }
  throw Object.assign(new Error(`无法启动浏览器${lastError instanceof Error ? `：${lastError.message.split("\n")[0]}` : ""}`), { status: 503 });
}

async function visibleLocator(scope, selectors, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    for (const selector of selectors) {
      const locator = scope.locator(selector);
      for (let index = 0; index < await locator.count(); index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    }
    if (Date.now() >= deadline) return null;
    await scope.waitForTimeout(300);
  } while (Date.now() < deadline);
  return null;
}

async function loginState(context, platform) {
  const definition = platformDefinition(platform);
  const cookies = await context.cookies(definition.origin);
  const authenticated = platform === "douyin"
    ? cookies.some((cookie) => ["sessionid", "sessionid_ss"].includes(cookie.name) && cookie.value)
    : cookies.some((cookie) => ["wxuin", "uin", "finderuin", "sessionid"].includes(cookie.name) && cookie.value);
  const identityCookieNames =
    platform === "douyin"
      ? ["uid_tt", "uid_tt_ss", "sessionid_ss", "sessionid"]
      : ["finderuin", "wxuin", "uin", "sessionid"];
  const identityCookie = identityCookieNames
    .map((name) => cookies.find((cookie) => cookie.name === name && cookie.value))
    .find(Boolean);
  const identityKey = identityCookie
    ? createHash("sha256").update(`${platform}:${identityCookie.name}:${identityCookie.value}`).digest("hex")
    : "";
  return { authenticated, configured: authenticated, auth_method: authenticated ? "browser" : "", identityKey };
}

async function displayName(context, platform) {
  const page = context.pages()[0];
  if (!page) return "";
  const selectors = platform === "douyin"
    ? ["[class*='user-name']", "[class*='avatar'] + *", "header [class*='name']"]
    : ["[class*='account-name']", "[class*='finder'] [class*='name']", ".weui-desktop-account__nickname"];
  const locator = await visibleLocator(page, selectors, 1_500);
  return String(await locator?.innerText().catch(() => "") || "").trim().slice(0, 100);
}

function sessionKey(platform, accountId) { return `${platform}:${accountId}`; }

export async function openSocialBrowserLogin(platformAccountRoot, appRoot, platform, accountId) {
  const definition = platformDefinition(platform);
  const key = sessionKey(platform, validAccountId(accountId));
  const prior = sessions.get(key);
  if (prior) await prior.close().catch(() => undefined);
  const context = await launchContext(platformAccountRoot, appRoot, platform, accountId, false);
  sessions.set(key, context);
  context.on("close", () => { if (sessions.get(key) === context) sessions.delete(key); });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(definition.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.bringToFront();
  return { ok: true, opened: true, ...(await loginState(context, platform)) };
}

export async function socialBrowserAuthStatus(platformAccountRoot, appRoot, platform, accountId, closeAfter = false) {
  const key = sessionKey(platform, validAccountId(accountId));
  let context = sessions.get(key);
  let temporary = false;
  if (!context) {
    context = await launchContext(platformAccountRoot, appRoot, platform, accountId, true);
    temporary = true;
    const page = context.pages()[0] || await context.newPage();
    await page.goto(platformDefinition(platform).loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  }
  try {
    const state = await loginState(context, platform);
    return { ...state, displayName: state.authenticated ? await displayName(context, platform) : "" };
  } finally {
    if (temporary || closeAfter) {
      await context.close().catch(() => undefined);
      sessions.delete(key);
    }
  }
}

async function fillText(locator, value) {
  if (!locator || !value) return;
  await locator.click();
  await locator.fill(value).catch(async () => {
    await locator.press(process.platform === "win32" ? "Control+A" : "Meta+A");
    await locator.pressSequentially(value, { delay: 8 });
  });
}

async function uploadDouyin(page, payload) {
  const fileInput = await visibleLocator(page, ["input[type='file'][accept*='video']", "input[type='file']"], 30_000);
  if (!fileInput) throw new Error("抖音页面没有找到视频上传入口，页面结构可能已更新");
  await fileInput.setInputFiles(payload.videoPath);
  const title = await visibleLocator(page, ["input[placeholder*='作品标题']", "input[placeholder*='标题']"], 120_000);
  if (!title) throw new Error("抖音视频上传后没有出现标题输入框");
  await fillText(title, payload.title);
  const description = await visibleLocator(page, ["div.zone-container[contenteditable='true']", "[contenteditable='true'][data-placeholder*='简介']", "textarea[placeholder*='简介']"], 10_000);
  const tagText = (payload.tags || []).map((tag) => `#${String(tag).replace(/^#+/, "").trim()}`).filter((tag) => tag.length > 1).join(" ");
  await fillText(description, [payload.description, tagText].filter(Boolean).join("\n"));
  if (payload.coverPortraitPath || payload.coverLandscapePath) {
    const coverEntry = await visibleLocator(page, ["text=选择封面", "text=编辑封面", "[class*='cover'] button"], 4_000);
    if (coverEntry) {
      await coverEntry.click().catch(() => undefined);
      const coverInput = await visibleLocator(page, ["[role='dialog'] input[type='file']", ".dy-creator-content-modal input[type='file']"], 4_000);
      if (coverInput) await coverInput.setInputFiles(payload.coverPortraitPath || payload.coverLandscapePath);
      const confirm = await visibleLocator(page, ["[role='dialog'] button:text-is('完成')", "[role='dialog'] button:text-is('确定')"], 4_000);
      if (confirm) await confirm.click().catch(() => undefined);
    }
  }
  if (payload.scheduleAt) {
    const schedule = await visibleLocator(page, ["label:has-text('定时发布')", "text=定时发布"], 5_000);
    if (!schedule) throw new Error("当前抖音页面没有可用的定时发布入口");
    await schedule.click();
    const scheduleInput = await visibleLocator(page, ["input[placeholder*='日期和时间']", "input[placeholder*='发布时间']"], 5_000);
    if (!scheduleInput) throw new Error("抖音定时发布控件不可用");
    await fillText(scheduleInput, payload.scheduleAt.replace("T", " ").slice(0, 16));
  }
  const submitLabel = payload.mode === "draft" ? "保存草稿" : "发布";
  const submit = await visibleLocator(page, [`button:text-is('${submitLabel}')`, `button:has-text('${submitLabel}')`], 120_000);
  if (!submit || await submit.isDisabled().catch(() => true)) throw new Error(`抖音“${submitLabel}”按钮尚不可用，请检查视频处理和必填项`);
  await submit.click();
  return submitLabel;
}

async function uploadDouyinImages(page, payload) {
  const imagePaths = Array.isArray(payload.imagePaths) ? payload.imagePaths : [];
  if (!imagePaths.length) throw new Error("抖音图文审核快照中没有图片");
  const imageEntry = await visibleLocator(page, [
    "button:has-text('发布图文')",
    "[role='tab']:has-text('发布图文')",
    "text=发布图文",
    "button:has-text('图文')",
  ], 20_000);
  if (!imageEntry) throw new Error("抖音页面没有找到图文发布入口，页面结构可能已更新");
  await imageEntry.click();
  const fileInput = await visibleLocator(page, [
    "input[type='file'][accept*='image']",
    "input[type='file'][multiple]",
    "input[type='file']",
  ], 20_000);
  if (!fileInput) throw new Error("抖音图文页面没有找到图片上传入口，页面结构可能已更新");
  await fileInput.setInputFiles(imagePaths);
  const title = await visibleLocator(page, [
    "input[placeholder*='作品标题']",
    "input[placeholder*='标题']",
  ], 60_000);
  if (title) await fillText(title, payload.title);
  const description = await visibleLocator(page, [
    "div.zone-container[contenteditable='true']",
    "[contenteditable='true'][data-placeholder]",
    "textarea[placeholder*='描述']",
    "textarea[placeholder*='正文']",
  ], 30_000);
  if (!description) throw new Error("抖音图片上传后没有出现正文输入框");
  const tagText = (payload.tags || []).map((tag) => `#${String(tag).replace(/^#+/, "").trim()}`).filter((tag) => tag.length > 1).join(" ");
  await fillText(description, [payload.description, tagText].filter(Boolean).join("\n"));
  const submitLabel = payload.mode === "draft" ? "保存草稿" : "发布";
  const submit = await visibleLocator(page, [`button:text-is('${submitLabel}')`, `button:has-text('${submitLabel}')`], 120_000);
  if (!submit || await submit.isDisabled().catch(() => true)) throw new Error(`抖音“${submitLabel}”按钮尚不可用，请检查图片和必填项`);
  await submit.click();
  return submitLabel;
}

async function openWechatChannelsComposer(page) {
  await page.goto(definitions.wechat_channels.publishUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const entry = await visibleLocator(page, ["button:has-text('发表视频')", "text=发表视频"], 30_000);
  if (entry) await entry.click();
}

async function uploadWechatChannels(page, payload) {
  await openWechatChannelsComposer(page);
  let fileInput = await visibleLocator(page, ["input[type='file'][accept*='video']", "input[type='file']"], 20_000);
  if (!fileInput) {
    for (const frame of page.frames()) {
      fileInput = await visibleLocator(frame, ["input[type='file'][accept*='video']", "input[type='file']"], 1_000);
      if (fileInput) break;
    }
  }
  if (!fileInput) throw new Error("视频号页面没有找到视频上传入口，页面结构可能已更新");
  await fileInput.setInputFiles(payload.videoPath);
  const description = await visibleLocator(page, ["[contenteditable='true']", "textarea[placeholder*='描述']"], 60_000);
  const tagText = (payload.tags || []).map((tag) => `#${String(tag).replace(/^#+/, "").trim()}`).filter((tag) => tag.length > 1).join(" ");
  await fillText(description, [payload.description || payload.title, tagText].filter(Boolean).join("\n"));
  const shortTitle = await visibleLocator(page, ["input[placeholder*='短标题']", "input[placeholder*='标题']"], 6_000);
  if (shortTitle) await fillText(shortTitle, String(payload.title).slice(0, 15));
  if (payload.coverLandscapePath || payload.coverPortraitPath) {
    for (const [label, coverPath] of [["4:3", payload.coverLandscapePath], ["3:4", payload.coverPortraitPath]]) {
      if (!coverPath) continue;
      const entry = await visibleLocator(page, [`text=${label}`, `div:has-text('${label}') [class*='cover']`], 2_000);
      if (!entry) continue;
      await entry.click().catch(() => undefined);
      const input = await visibleLocator(page, ["[role='dialog'] input[type='file']", ".weui-desktop-dialog input[type='file']"], 3_000);
      if (input) await input.setInputFiles(coverPath);
      const confirm = await visibleLocator(page, ["[role='dialog'] button:has-text('确定')", "[role='dialog'] button:has-text('完成')"], 3_000);
      if (confirm) await confirm.click().catch(() => undefined);
    }
  }
  if (payload.scheduleAt) {
    const schedule = await visibleLocator(page, ["label:has-text('定时')", "text=定时发表"], 5_000);
    if (!schedule) throw new Error("当前视频号页面没有可用的定时发布入口");
    await schedule.click();
  }
  const submitLabel = payload.mode === "draft" ? "保存草稿" : "发表";
  const submit = await visibleLocator(page, [`button:text-is('${submitLabel}')`, `button:has-text('${submitLabel}')`], 180_000);
  if (!submit || await submit.isDisabled().catch(() => true)) throw new Error(`视频号“${submitLabel}”按钮尚不可用，请检查视频处理和必填项`);
  await submit.click();
  return submitLabel;
}

export async function publishSocialVideo(platformAccountRoot, appRoot, platform, payload) {
  const definition = platformDefinition(platform);
  const accountId = validAccountId(payload?.accountId);
  const imagePost = platform === "douyin" && payload?.contentType === "douyin_image";
  if (imagePost) {
    if (!Array.isArray(payload.imagePaths) || !payload.imagePaths.length || payload.imagePaths.some((path) => !existsSync(path)))
      throw Object.assign(new Error("审核快照中的图文图片不存在"), { status: 409 });
  } else if (!payload?.videoPath || !existsSync(payload.videoPath)) {
    throw Object.assign(new Error("审核快照中的视频文件不存在"), { status: 409 });
  }
  const key = sessionKey(platform, accountId);
  const active = sessions.get(key);
  if (active) { await active.close().catch(() => undefined); sessions.delete(key); }
  const context = await launchContext(platformAccountRoot, appRoot, platform, accountId, false);
  let submitted = false;
  try {
    const identity = await loginState(context, platform);
    if (!identity.authenticated) throw Object.assign(new Error(`${definition.label}登录已失效，请先重新登录`), { status: 409 });
    if (payload.expectedIdentityKey && identity.identityKey !== payload.expectedIdentityKey)
      throw Object.assign(new Error(`${definition.label}当前登录身份与任务绑定账号不一致，已阻止发布`), { status: 409 });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(definition.publishUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const submitLabel = imagePost
      ? await uploadDouyinImages(page, payload)
      : platform === "douyin"
        ? await uploadDouyin(page, payload)
        : await uploadWechatChannels(page, payload);
    submitted = true;
    const successText = platform === "douyin"
      ? ["发布成功", "作品已发布", "已存入草稿"]
      : ["发表成功", "发布成功", "已保存草稿"];
    for (let round = 0; round < 60; round += 1) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (successText.some((text) => bodyText.includes(text)) || /content\/manage|post\/list/.test(page.url())) {
        return {
          status: payload.mode === "draft" ? "drafted" : payload.scheduleAt ? "scheduled" : "published",
          detail: `${definition.label}${submitLabel}已提交并获得页面确认`,
          identityKey: identity.identityKey,
          url: page.url(),
        };
      }
      await page.waitForTimeout(500);
    }
    throw Object.assign(new Error(`${definition.label}提交按钮已触发，但结果暂时无法确认`), { uncertain: true });
  } catch (error) {
    const page = context.pages().at(-1);
    if (page) await page.screenshot({ path: resolve(profilePath(platformAccountRoot, platform, accountId), "publish-failure.png"), fullPage: true }).catch(() => undefined);
    if (submitted && !error?.uncertain)
      throw Object.assign(new Error(`${definition.label}提交已触发，但结果无法确认：${error instanceof Error ? error.message : "未知异常"}`), { uncertain: true });
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function closeSocialBrowsers() {
  const contexts = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(contexts.map((context) => context.close()));
}
