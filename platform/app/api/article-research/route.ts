import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";
import * as cheerio from "cheerio";

type SearchResult = { title?: string; url?: string; content?: string; publishedDate?: string; author?: string; engine?: string; engines?: string[] };

const defaultExcludedDomains = ["zhihu.com", "baike.baidu.com", "xiaohongshu.com", "douyin.com", "bilibili.com", "weibo.com"];

function list(value: unknown, max = 12) {
  return [...new Set((Array.isArray(value) ? value : String(value ?? "").split(/[，,\n]/)).map((item) => String(item).trim()).filter(Boolean))].slice(0, max);
}

function parseJsonList(value: string) { try { const result = JSON.parse(value); return Array.isArray(result) ? result.map(String) : []; } catch { return []; } }

function canonicalize(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持公开 HTTP/HTTPS 文章");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm|from|source|ref|track)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

function looksLikeArticle(raw: string) {
  const url = new URL(raw); const host = url.hostname.toLowerCase(); const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return false;
  if (host === "mp.weixin.qq.com") return /^\/s\/.+/.test(path) || (path === "/s" && Boolean(url.searchParams.get("__biz") || url.searchParams.get("mid") || url.searchParams.get("signature")));
  if (/^\/(news|article|post|p|a)\//i.test(path) || /\.(?:html?|shtml)$/i.test(path) || /\d{5,}/.test(path)) return true;
  return path.split("/").filter(Boolean).length >= 2;
}

function withinTimeRange(value: string, range: string) {
  if (!range) return true;
  const duration: Record<string, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 31 * 86_400_000, year: 366 * 86_400_000 };
  const timestamp = Date.parse(value); const now = Date.now();
  return Number.isFinite(timestamp) && timestamp >= now - duration[range] && timestamp <= now + 86_400_000;
}

function safePublicUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("地址不是公开网页");
  return url;
}

function decode(text: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    }
    return entities[entity.toLowerCase()] ?? " ";
  });
}

function meta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
    ];
    for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decode(match[1].trim()); }
  }
  return "";
}

function elementBodyById(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opening = new RegExp(`<([a-z][\\w:-]*)[^>]+id=["']${escaped}["'][^>]*>`, "i").exec(html);
  if (!opening) return "";
  const tag = opening[1];
  const start = opening.index + opening[0].length;
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = start;
  let depth = 1; let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index);
  }
  return "";
}

function articleText(html: string, host = "") {
  const jsonBody = html.match(/["']articleBody["']\s*:\s*["']((?:\\.|[^"'])+)["']/i)?.[1];
  if (jsonBody) {
    try { const parsed = JSON.parse(`"${jsonBody.replace(/"/g, '\\"')}"`); if (parsed.length > 300) return String(parsed).slice(0, 30000); } catch { void 0; }
  }
  const wechatBody = host === "mp.weixin.qq.com" ? elementBodyById(html, "js_content") : "";
  const candidates = [...html.matchAll(/<(article|main)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  let source = wechatBody || candidates.sort((a, b) => b.length - a.length)[0] || html.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1] || html;
  source = source.replace(/<(script|style|svg|nav|header|footer|form|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote)>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decode(source).replace(/[\t\r ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim().slice(0, 30000);
}

async function fetchArticle(rawUrl: string) {
  const url = safePublicUrl(rawUrl);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36" } });
  if (!response.ok) throw new Error(`网页返回 ${response.status}`);
  safePublicUrl(response.url);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("html")) throw new Error("搜索结果不是文章网页");
  const html = (await response.text()).slice(0, 2_000_000);
  const text = articleText(html, url.hostname.toLowerCase());
  if (text.length < 300) throw new Error("未提取到足够的文章正文");
  const wechatAuthor = url.hostname.toLowerCase() === "mp.weixin.qq.com" ? decode(elementBodyById(html, "js_name").replace(/<[^>]+>/g, " ")).trim() : "";
  const wechatTimestamp = url.hostname.toLowerCase() === "mp.weixin.qq.com" ? html.match(/\bct\s*=\s*["'](\d{10})["']/)?.[1] : "";
  return {
    text,
    author: wechatAuthor || meta(html, ["author", "article:author", "og:article:author"]),
    publishedAt: wechatTimestamp ? new Date(Number(wechatTimestamp) * 1000).toISOString() : meta(html, ["article:published_time", "datePublished", "publishdate", "pubdate"]),
  };
}

function searchEndpoint() {
  const value = String(process.env.SEARXNG_URL || "http://127.0.0.1:8080").trim().replace(/\/+$/, "");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("SearXNG 地址配置不正确");
  return url.toString().replace(/\/+$/, "");
}

async function search(keyword: string, timeRange: string) {
  const found: SearchResult[] = [];
  for (const page of [1, 2, 3]) {
    const url = new URL(`${searchEndpoint()}/search`);
    url.searchParams.set("q", keyword); url.searchParams.set("format", "json"); url.searchParams.set("language", "zh-CN"); url.searchParams.set("safesearch", "1"); url.searchParams.set("pageno", String(page));
    if (["day", "week", "month", "year"].includes(timeRange)) url.searchParams.set("time_range", timeRange);
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`SearXNG 搜索失败（${response.status}）`);
    const payload = await response.json() as { results?: SearchResult[] }; found.push(...(payload.results || []));
    if (!(payload.results || []).length) break;
  }
  const seen = new Set<string>();
  return found.filter((item) => item.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 36);
}

const sogouHeaders = { accept: "text/html,application/xhtml+xml", "accept-language": "zh-CN,zh;q=0.9", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36" };

async function sogouCookies() {
  try {
    const response = await fetch("https://v.sogou.com/v?ie=utf8&query=&p=40030600", { headers: sogouHeaders, signal: AbortSignal.timeout(12_000) });
    return response.headers.getSetCookie?.().map((item) => item.split(";")[0]).join("; ") || "";
  } catch { return ""; }
}

async function resolveSogouUrl(raw: string, cookie: string) {
  if (!raw.includes("weixin.sogou.com")) return raw;
  const base = "ABTEST=7|1716888919|v1; IPLOC=CN3100; ariaDefaultTheme=default";
  const response = await fetch(raw, { redirect: "manual", headers: { ...sogouHeaders, cookie: cookie ? `${base}; ${cookie}` : base, referer: "https://weixin.sogou.com/" }, signal: AbortSignal.timeout(12_000) });
  const location = response.headers.get("location") || "";
  if (location.includes("mp.weixin.qq.com")) return location;
  const html = await response.text();
  const direct = html.match(/https:\/\/mp\.weixin\.qq\.com[^"'<>\s]+/)?.[0];
  if (direct) return decode(direct.replace(/&amp;/g, "&"));
  const parts = [...html.matchAll(/url\s*\+=\s*["']([^"']+)["']/g)].map((item) => item[1]).join("");
  return parts.includes("mp.weixin.qq.com") ? decode(parts.replace(/&amp;/g, "&")) : "";
}

async function searchWechat(keyword: string) {
  const cookie = await sogouCookies(); const collected: SearchResult[] = [];
  for (const page of [1, 2]) {
    const url = new URL("https://weixin.sogou.com/weixin");
    url.searchParams.set("query", keyword); url.searchParams.set("type", "2"); url.searchParams.set("page", String(page)); url.searchParams.set("ie", "utf8"); url.searchParams.set("s_from", "input");
    const response = await fetch(url, { headers: { ...sogouHeaders, cookie, referer: "https://weixin.sogou.com/" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`搜狗微信搜索失败（${response.status}）`);
    const html = await response.text();
    if (/antispider|请输入验证码|异常访问/.test(html)) throw new Error("搜狗微信触发访问验证，请稍后重试");
    const $ = cheerio.load(html); const rows = $("ul.news-list > li").toArray();
    if (!rows.length) break;
    for (const row of rows) {
      const item = $(row), link = item.find("h3 a").first(); const href = String(link.attr("href") || "");
      const timestamp = item.find(".s-p script").text().match(/(\d{10})/)?.[1] || "";
      const redirect = href.startsWith("/") ? `https://weixin.sogou.com${href}` : href;
      let direct = ""; try { direct = await resolveSogouUrl(redirect, cookie); } catch { direct = ""; }
      if (!direct) continue;
      collected.push({ title: link.text().trim(), url: direct, content: item.find("p.txt-info").text().trim(), publishedDate: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : "", author: item.find(".all-time-y2,a.account").first().text().trim(), engine: "sogou weixin", engines: ["sogou weixin"] });
    }
  }
  return collected.slice(0, 20);
}

async function searchServiceAvailable() {
  try {
    const response = await fetch(searchEndpoint(), { method: "HEAD", signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch { return false; }
}

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const platform = new URL(request.url).searchParams.get("platform") === "wechat" ? "wechat" : "zhihu";
  const rows = await database().prepare(`SELECT s.*,e.id AS entry_id,e.platform,e.matched_keywords,e.search_engines,e.best_rank,
    e.occurrence_count,e.relevance_score,e.trend_score,e.status,e.first_seen_at,e.last_seen_at
    FROM article_research_entries e JOIN article_research_samples s ON s.id=e.sample_id
    WHERE e.platform=? AND e.status!='archived' AND s.processing_status='success' AND s.detail_text!=''
    ORDER BY e.status='new' DESC,e.trend_score DESC,e.last_seen_at DESC LIMIT 200`).bind(platform).all<Record<string, unknown>>();
  const accounts = await database().prepare("SELECT id,name,status,persona,audience,content_pillars,strategy_keywords,excluded_topics FROM accounts WHERE platform=? AND is_demo=0 ORDER BY updated_at DESC").bind(platform).all<Record<string, unknown>>();
  return Response.json({ configured: await searchServiceAvailable(), endpoint: searchEndpoint(), samples: rows.results.map((row) => ({ ...row, matched_keywords: parseJsonList(String(row.matched_keywords || "[]")), search_engines: parseJsonList(String(row.search_engines || "[]")) })), accounts: accounts.results });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, roleGroups.operate)) return forbidden("只有管理员或内容运营可以执行文章选题研究");
  const data = await request.json() as Record<string, unknown>;
  const action = String(data.action || "");
  const platform = data.platform === "wechat" ? "wechat" : "zhihu";
  const db = database();
  const now = new Date().toISOString();

  if (action === "search") {
    const keywords = list(data.keywords, 8);
    const includeDomains = list(data.include_domains, 20).map((item) => item.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase());
    const excludeDomains = defaultExcludedDomains;
    const timeRange = ["day", "week", "month", "year", ""].includes(String(data.time_range || "")) ? String(data.time_range || "") : "month";
    if (!keywords.length) return Response.json({ error: "请至少输入一个筛选关键词" }, { status: 400 });
    let discovered = 0; let fetched = 0; let candidates = 0; let rejectedPages = 0; let rejectedByTime = 0; const errors: string[] = [];
    for (const keyword of keywords) {
      const searchDomains = platform === "wechat"
        ? [...(!includeDomains.length || includeDomains.includes("mp.weixin.qq.com") ? ["__wechat__"] : []), ...includeDomains.filter((item) => item !== "mp.weixin.qq.com")]
        : includeDomains.length ? includeDomains : [""];
      for (const searchDomain of searchDomains) {
        const searchQuery = searchDomain && searchDomain !== "__wechat__" ? `${keyword} site:${searchDomain}` : keyword;
        let results: SearchResult[];
        try { results = searchDomain === "__wechat__" ? await searchWechat(keyword) : await search(searchQuery, timeRange); } catch (error) { errors.push(`${keyword}${searchDomain ? `（${searchDomain === "__wechat__" ? "搜狗微信" : searchDomain}）` : ""}：${error instanceof Error ? error.message : "搜索失败"}`); continue; }
        candidates += results.length;
        for (let rank = 0; rank < results.length; rank += 1) {
        const result = results[rank];
        if (!result.url || !result.title) continue;
        let canonical: string; let domain: string;
        try { canonical = canonicalize(result.url); domain = safePublicUrl(canonical).hostname.toLowerCase(); } catch { continue; }
        if (!looksLikeArticle(canonical)) { rejectedPages += 1; continue; }
        if (includeDomains.length && !includeDomains.some((item) => domain === item || domain.endsWith(`.${item}`))) continue;
        if (excludeDomains.some((item) => domain === item || domain.endsWith(`.${item}`))) continue;
        const existing = await db.prepare("SELECT * FROM article_research_samples WHERE canonical_url=?").bind(canonical).first<Record<string, unknown>>();
        const existingEntry = existing ? await db.prepare("SELECT * FROM article_research_entries WHERE sample_id=? AND platform=?").bind(existing.id, platform).first<Record<string, unknown>>() : null;
        const matched = [...new Set([...(existingEntry ? parseJsonList(String(existingEntry.matched_keywords || "[]")) : []), keyword])];
        const engines = [...new Set([...(existingEntry ? parseJsonList(String(existingEntry.search_engines || "[]")) : []), ...(result.engines || []), result.engine || ""].filter(Boolean))];
        let detail = String(existing?.detail_text || ""); let author = String(existing?.author_name || result.author || ""); let publishedAt = String(existing?.published_at || result.publishedDate || ""); let processing = detail ? "success" : "failed"; let detailError = "";
        if (!detail) try { const article = await fetchArticle(canonical); detail = article.text; author = article.author; publishedAt = article.publishedAt || publishedAt; processing = "success"; fetched += 1; } catch (error) { detailError = error instanceof Error ? error.message : "正文抓取失败"; }
        if (processing === "success" && !withinTimeRange(publishedAt, timeRange)) { rejectedByTime += 1; continue; }
        const bestRank = Math.min(Number(existingEntry?.best_rank || 999), rank + 1);
        const occurrences = matched.length;
        const titleMatches = keywords.filter((item) => result.title!.toLowerCase().includes(item.toLowerCase())).length;
        const relevance = Math.min(100, 35 + titleMatches * 20 + Math.max(0, 25 - bestRank * 2));
        const trendScore = Math.min(100, Math.round((101 - Math.min(100, bestRank * 5)) * .45 + occurrences * 12 + relevance * .3));
        const id = String(existing?.id || crypto.randomUUID());
        await db.prepare(`INSERT INTO article_research_samples (id,canonical_url,title,source_url,source_domain,author_name,matched_keywords,search_engines,snippet,detail_text,published_at,best_rank,occurrence_count,relevance_score,trend_score,processing_status,detail_error,status,first_seen_at,last_seen_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title,matched_keywords=excluded.matched_keywords,search_engines=excluded.search_engines,snippet=excluded.snippet,detail_text=CASE WHEN excluded.detail_text!='' THEN excluded.detail_text ELSE article_research_samples.detail_text END,published_at=COALESCE(NULLIF(excluded.published_at,''),article_research_samples.published_at),best_rank=excluded.best_rank,occurrence_count=excluded.occurrence_count,relevance_score=excluded.relevance_score,trend_score=excluded.trend_score,processing_status=CASE WHEN article_research_samples.detail_text!='' THEN 'success' ELSE excluded.processing_status END,detail_error=CASE WHEN article_research_samples.detail_text!='' THEN '' ELSE excluded.detail_error END,last_seen_at=excluded.last_seen_at`)
          .bind(id, canonical, result.title.slice(0, 300), canonical, domain, author.slice(0, 160), JSON.stringify(matched), JSON.stringify(engines), String(result.content || "").slice(0, 2000), detail, publishedAt || null, bestRank, occurrences, relevance, trendScore, processing, detailError.slice(0, 500), existing?.first_seen_at || now, now).run();
        await db.prepare(`INSERT INTO article_research_entries
          (id,sample_id,platform,matched_keywords,search_engines,best_rank,occurrence_count,relevance_score,trend_score,status,first_seen_at,last_seen_at)
          VALUES (?,?,?,?,?,?,?,?,?,'new',?,?) ON CONFLICT(sample_id,platform) DO UPDATE SET
          matched_keywords=excluded.matched_keywords,search_engines=excluded.search_engines,best_rank=excluded.best_rank,
          occurrence_count=excluded.occurrence_count,relevance_score=excluded.relevance_score,trend_score=excluded.trend_score,last_seen_at=excluded.last_seen_at`)
          .bind(String(existingEntry?.id || crypto.randomUUID()), id, platform, JSON.stringify(matched), JSON.stringify(engines), bestRank, occurrences, relevance, trendScore, existingEntry?.first_seen_at || now, now).run();
        if (processing === "success" && detail) discovered += 1;
        }
      }
    }
    await audit(user.id, `执行${platform === "wechat" ? "公众号" : "知乎SEO"}文章搜索`, "article_research", crypto.randomUUID(), `${keywords.join("、")} / 候选${candidates} / 非文章${rejectedPages} / 时间不符${rejectedByTime} / 发现${discovered} / 正文${fetched}`);
    if (!discovered && errors.length) return Response.json({ error: errors.join("；") }, { status: 502 });
    return Response.json({ ok: true, discovered, fetched, candidates, rejected_pages: rejectedPages, rejected_by_time: rejectedByTime, errors });
  }

  if (action === "create_topic") {
    const sampleId = String(data.sample_id || "");
    const sample = await db.prepare(`SELECT s.*,e.matched_keywords,e.best_rank,e.occurrence_count,e.relevance_score,e.trend_score
      FROM article_research_samples s JOIN article_research_entries e ON e.sample_id=s.id
      WHERE s.id=? AND e.platform=? AND e.status!='archived'`).bind(sampleId, platform).first<Record<string, unknown>>();
    if (!sample) return Response.json({ error: "文章样本不存在" }, { status: 404 });
    if (sample.processing_status !== "success" || !sample.detail_text) return Response.json({ error: "来源正文尚未抓取成功，暂时不能转入选题" }, { status: 409 });
    const topicId = crypto.randomUUID();
    const topicTitle = String(data.title || sample.title).trim().slice(0, 300);
    const detail = String(sample.detail_text).slice(0, 1500);
    const keywords = parseJsonList(String(sample.matched_keywords || "[]"));
    await db.batch([
      db.prepare("INSERT INTO topics (id,title,source_url,relevance,status,platform,source_type,source_external_id,created_by,created_at) VALUES (?,?,?,'高','unclaimed',?,'article_search',?,?,?)").bind(topicId, topicTitle, sample.source_url, platform, sampleId, user.id, now),
      db.prepare("INSERT INTO topic_insights (topic_id,brief,target_audience,pain_point,hook_points,content_structure,why_it_works,account_fit,source_feed_ids,score,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(topicId, String(sample.snippet || detail.slice(0, 280)), platform === "wechat" ? "关注相关话题的公众号读者" : "通过相关关键词主动搜索的知乎用户", `围绕“${keywords[0] || topicTitle}”寻找清晰、可信、可执行的内容`, JSON.stringify(keywords.map((item) => platform === "wechat" ? `展开“${item}”的读者价值` : `回答“${item}”背后的真实问题`).slice(0, 5)), JSON.stringify(platform === "wechat" ? ["开头钩子", "核心观点", "证据与案例", "读者启发", "行动建议"] : ["问题界定", "核心观点", "证据与案例", "常见误区", "行动建议"]), `文章在搜索结果中具有较高关联度，并命中 ${keywords.length} 个筛选关键词`, platform === "wechat" ? "适合转化为兼顾阅读价值与账号定位的公众号长文" : "适合转化为问题导向、信息密度高的知乎长文", JSON.stringify([`article:${sampleId}`]), Number(sample.trend_score || 0), now),
      db.prepare("UPDATE article_research_entries SET status='used' WHERE sample_id=? AND platform=?").bind(sampleId, platform),
    ]);
    await audit(user.id, `从文章样本创建${platform === "wechat" ? "公众号" : "知乎SEO"}选题`, "article_research", sampleId, topicTitle);
    return Response.json({ ok: true, topic_id: topicId });
  }

  if (action === "archive") {
    const sampleId = String(data.sample_id || "");
    await db.prepare("UPDATE article_research_entries SET status='archived' WHERE sample_id=? AND platform=?").bind(sampleId, platform).run();
    await audit(user.id, "归档文章研究样本", "article_research", sampleId);
    return Response.json({ ok: true });
  }
  if (action === "archive_bulk") {
    const sampleIds = list(data.sample_ids, 200).filter((id) => /^[a-zA-Z0-9_-]{8,100}$/.test(id));
    if (!sampleIds.length) return Response.json({ error: "请先选择要删除的文章" }, { status: 400 });
    const placeholders = sampleIds.map(() => "?").join(",");
    const result = await db.prepare(`UPDATE article_research_entries SET status='archived' WHERE platform=? AND status!='archived' AND sample_id IN (${placeholders})`).bind(platform, ...sampleIds).run();
    await audit(user.id, `批量删除${platform === "wechat" ? "公众号" : "知乎SEO"}文章样本`, "article_research", crypto.randomUUID(), `${result.meta.changes || 0} 条；仅归档平台索引，共享正文保留`);
    return Response.json({ ok: true, archived: result.meta.changes || 0 });
  }
  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
