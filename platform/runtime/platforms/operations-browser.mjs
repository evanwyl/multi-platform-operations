import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import {
  browserExecutables,
  withSocialMetricPage,
} from "./social-video-browser.mjs";
import { withZhihuMetricPage } from "./zhihu-browser.mjs";
import { contentIdentity, metricNumber } from "./operations-core.mjs";

// Creator-page metric discovery is inspired by mdldm-maitian (MIT).
// Every reader is account scoped, read only, and returns null for unavailable values.
const pages = {
  xiaohongshu: [
    "https://creator.xiaohongshu.com/new/note-manager",
    "https://creator.xiaohongshu.com/statistics/fans-data",
  ],
  douyin: [
    "https://creator.douyin.com/creator-micro/content/manage",
    "https://creator.douyin.com/creator-micro/home",
  ],
  wechat_channels: [
    "https://channels.weixin.qq.com/platform/post/list",
    "https://channels.weixin.qq.com/platform/statistic/follower",
  ],
  zhihu: [
    "https://www.zhihu.com/creator/manage/creation/all",
    "https://www.zhihu.com/creator",
  ],
};

export async function inspect(page, account, claim, health = false) {
  const target = pages[account.platform]?.[claim ? 0 : 1];
  if (!target) throw new Error("该平台暂不支持自动采集");
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  let found;
  for (let round = 0; round < 12; round++) {
    found = await page.evaluate(
      ({ platform, title, contentId, isClaim, health }) => {
        const shadow = document.querySelector("wujie-app")?.shadowRoot;
        const root = shadow || document;
        const allText = shadow?.textContent || document.body.innerText || "";
        if (/扫码登录|验证码登录|微信扫码登录|请先登录/.test(allText))
          return { login: true };
        if (health) return { healthy: /创作|发布|作品|数据|关注者|粉丝/.test(allText) };
        if (!isClaim) {
          const text = (shadow?.textContent || document.body.innerText).replace(
            /\s+/g,
            " ",
          );
          const followers = text.match(
            /(?:关注者总数|粉丝总数|粉丝总量|总粉丝数|关注者数|粉丝数)\s*[:：]?\s*([\d,.]+\s*[万亿wkm]?)/i,
          )?.[1];
          return { followers: followers || null };
        }
        const selectors =
          platform === "xiaohongshu"
            ? ".note-card"
            : platform === "douyin"
              ? "[class*='video-card-info']"
              : platform === "wechat_channels"
                ? ".post-feed-item"
                : "[class*='ContentItem'], [class*='CreationManage'] article";
        const candidates = [...root.querySelectorAll(selectors)].filter(
          (node) => {
            if (
              contentId &&
              [...node.querySelectorAll("a[href]")].some((a) =>
                a.href.includes(contentId),
              )
            )
              return true;
            const heading = node.querySelector(
              ".note-card__title, [class*='title'], h2, h3",
            );
            return title && heading?.textContent?.trim() === title;
          },
        );
        if (candidates.length !== 1)
          return { ambiguous: candidates.length > 1 };
        const card = candidates[0];
        const text = card.textContent.replace(/\s+/g, " ").trim();
        const get = (labels) => {
          const match = text.match(
            new RegExp(
              "(?:" + labels + ")\\s*[:：]?\\s*([\\d,.]+\\s*[万亿wkm]?)",
              "i",
            ),
          );
          return match?.[1] || null;
        };
        let metric = {
          views: get("播放量|播放|阅读量|阅读|浏览量|浏览"),
          likes: get("点赞|获赞"),
          comments: get("评论"),
          favorites: get("收藏"),
          shares: get("分享|转发"),
        };
        if (platform === "xiaohongshu") {
          const stats = [...card.querySelectorAll(".note-card__stat")].map(
            (node) => node.textContent.trim(),
          );
          if (stats.length >= 5)
            metric = {
              views: stats[0],
              comments: stats[1],
              likes: stats[2],
              favorites: stats[3],
              shares: stats[4],
            };
        }
        if (platform === "wechat_channels") {
          for (const node of card.querySelectorAll(".data-item")) {
            const html = node.innerHTML;
            const key = /eyes/.test(html)
              ? "views"
              : /outlined-like/.test(html)
                ? "likes"
                : /comment/.test(html)
                  ? "comments"
                  : /icon-share/.test(html)
                    ? "shares"
                    : "";
            if (key) metric[key] = node.textContent.trim();
          }
        }
        const url =
          [...card.querySelectorAll("a[href]")]
            .map((a) => a.href)
            .find((href) =>
              /\/explore\/|\/video\/\d|\/note\/\d|zhuanlan.zhihu.com\/p\//.test(
                href,
              ),
            ) || "";
        return { metric, url };
      },
      {
        platform: account.platform,
        title: String(claim?.title || "").trim(),
        contentId: String(claim?.external_content_id || ""),
        isClaim: Boolean(claim),
        health,
      },
    );
    if (found.healthy) break;
    if (found.login)
      throw new Error("平台要求重新登录，请在账号管理中完成登录");
    if (found.ambiguous)
      throw new Error("后台存在同名作品，请先关联正式作品链接，避免归错数据");
    if (
      found.followers != null ||
      (found.metric &&
        Object.values(found.metric).some(
          (value) => metricNumber(value) != null,
        ))
    )
      break;
    await page.waitForTimeout(1500);
  }
  if (health) {
    if (!found?.healthy) throw new Error("尚未确认创作者后台可用，请检查登录状态");
    return { healthy: true, source: "creator_health" };
  }
  const metric = found?.metric
    ? Object.fromEntries(
        Object.entries(found.metric).map(([key, value]) => [
          key,
          metricNumber(value),
        ]),
      )
    : null;
  if (
    claim &&
    (!metric || Object.values(metric).every((value) => value == null))
  )
    throw new Error(
      "未在创作者后台找到可核验的作品指标；请确认作品链接、登录状态或页面结构",
    );
  const followers = metricNumber(found?.followers);
  if (!claim && followers == null)
    throw new Error("未读取到粉丝总量；请确认后台页面已更新或登录状态有效");
  const identity = contentIdentity(
    account.platform,
    found?.url || claim?.published_url,
  );
  return {
    source: "creator_dom",
    metric,
    followers,
    url: identity?.url || "",
    contentId: identity?.id || "",
  };
}

export async function collectOperationsMetrics(
  platformRoot,
  appRoot,
  accountRoot,
  payload,
) {
  const { account, claim, health } = payload || {};
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(account?.id)))
    throw new Error("账号标识不合法");
  if (["douyin", "wechat_channels"].includes(account.platform))
    return withSocialMetricPage(
      platformRoot,
      appRoot,
      account.platform,
      account.id,
      account.external_user_id,
      (page) => inspect(page, account, claim, health),
    );
  if (account.platform === "zhihu")
    return withZhihuMetricPage(platformRoot, appRoot, account.id, (page) =>
      inspect(page, account, claim, health),
    );
  if (account.platform !== "xiaohongshu")
    throw new Error("该平台暂不支持自动数据采集");
  const cookiePath = resolve(accountRoot, account.id, "cookies.json");
  if (!existsSync(cookiePath) || !account.xhs_user_id)
    throw new Error("请先登录并核验小红书账号身份");
  const cookies = JSON.parse(readFileSync(cookiePath, "utf8"));
  const profile = resolve(platformRoot, account.id, "metrics-profile");
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  let browser;
  for (const executablePath of browserExecutables(appRoot)) {
    try {
      browser = await chromium.launchPersistentContext(profile, {
        headless: true,
        executablePath,
        locale: "zh-CN",
      });
      break;
    } catch {
      /* Try the next installed or bundled browser. */
    }
  }
  if (!browser)
    throw new Error("无法启动数据采集浏览器，请检查本机 Chrome 或内置浏览器");
  try {
    await browser.addCookies(
      (Array.isArray(cookies) ? cookies : cookies.cookies || []).map(
        (cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || ".xiaohongshu.com",
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
        }),
      ),
    );
    return await inspect(
      browser.pages()[0] || (await browser.newPage()),
      account,
      claim,
      health,
    );
  } finally {
    await browser.close();
  }
}
