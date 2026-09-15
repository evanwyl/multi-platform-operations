import { currentUser, rejectCrossSiteMutation } from "../../../lib/auth";
import { audit, database, ensureDatabase } from "../../../lib/database";
import { can, forbidden, roleGroups } from "../../../lib/permissions";

type SearchResult = { title?: string; url?: string; content?: string; publishedDate?: string; engine?: string; engines?: string[] };

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

function articleText(html: string) {
  const jsonBody = html.match(/["']articleBody["']\s*:\s*["']((?:\\.|[^"'])+)["']/i)?.[1];
  if (jsonBody) {
    try { const parsed = JSON.parse(`"${jsonBody.replace(/"/g, '\\"')}"`); if (parsed.length > 300) return String(parsed).slice(0, 30000); } catch { void 0; }
  }
  const candidates = [...html.matchAll(/<(article|main)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  let source = candidates.sort((a, b) => b.length - a.length)[0] || html.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1] || html;
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
  const text = articleText(html);
  if (text.length < 300) throw new Error("未提取到足够的文章正文");
  return {
    text,
    author: meta(html, ["author", "article:author", "og:article:author"]),
    publishedAt: meta(html, ["article:published_time", "datePublished", "publishdate", "pubdate"]),
  };
}

function searchEndpoint() {
  const value = String(process.env.SEARXNG_URL || "http://127.0.0.1:8080").trim().replace(/\/+$/, "");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("SearXNG 地址配置不正确");
  return url.toString().replace(/\/+$/, "");
}

async function search(keyword: string, timeRange: string) {
  const url = new URL(`${searchEndpoint()}/search`);
  url.searchParams.set("q", keyword);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "zh-CN");
  url.searchParams.set("safesearch", "1");
  if (["day", "week", "month", "year"].includes(timeRange)) url.searchParams.set("time_range", timeRange);
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`SearXNG 搜索失败（${response.status}）`);
  const payload = await response.json() as { results?: SearchResult[] };
  return (payload.results || []).slice(0, 12);
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
  const rows = await database().prepare("SELECT * FROM article_research_samples WHERE status!='archived' AND processing_status='success' AND detail_text!='' ORDER BY status='new' DESC,trend_score DESC,last_seen_at DESC LIMIT 200").all<Record<string, unknown>>();
  const accounts = await database().prepare("SELECT id,name,status,persona,audience,content_pillars,strategy_keywords,excluded_topics FROM accounts WHERE platform='zhihu' AND is_demo=0 ORDER BY updated_at DESC").all<Record<string, unknown>>();
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
  const db = database();
  const now = new Date().toISOString();

  if (action === "search") {
    const keywords = list(data.keywords, 8);
    const includeDomains = list(data.include_domains, 20).map((item) => item.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase());
    const excludeDomains = defaultExcludedDomains;
    const timeRange = ["day", "week", "month", "year", ""].includes(String(data.time_range || "")) ? String(data.time_range || "") : "month";
    if (!keywords.length) return Response.json({ error: "请至少输入一个筛选关键词" }, { status: 400 });
    let discovered = 0; let fetched = 0; const errors: string[] = [];
    for (const keyword of keywords) {
      const searchDomains = includeDomains.length ? includeDomains : [""];
      for (const searchDomain of searchDomains) {
        const searchQuery = searchDomain ? `${keyword} site:${searchDomain}` : keyword;
        let results: SearchResult[];
        try { results = await search(searchQuery, timeRange); } catch (error) { errors.push(`${keyword}${searchDomain ? `（${searchDomain}）` : ""}：${error instanceof Error ? error.message : "搜索失败"}`); continue; }
        for (let rank = 0; rank < results.length; rank += 1) {
        const result = results[rank];
        if (!result.url || !result.title) continue;
        let canonical: string; let domain: string;
        try { canonical = canonicalize(result.url); domain = safePublicUrl(canonical).hostname.toLowerCase(); } catch { continue; }
        if (includeDomains.length && !includeDomains.some((item) => domain === item || domain.endsWith(`.${item}`))) continue;
        if (excludeDomains.some((item) => domain === item || domain.endsWith(`.${item}`))) continue;
        const existing = await db.prepare("SELECT * FROM article_research_samples WHERE canonical_url=?").bind(canonical).first<Record<string, unknown>>();
        const matched = [...new Set([...(existing ? parseJsonList(String(existing.matched_keywords || "[]")) : []), keyword])];
        const engines = [...new Set([...(existing ? parseJsonList(String(existing.search_engines || "[]")) : []), ...(result.engines || []), result.engine || ""].filter(Boolean))];
        let detail = String(existing?.detail_text || ""); let author = String(existing?.author_name || ""); let publishedAt = String(existing?.published_at || result.publishedDate || ""); let processing = detail ? "success" : "failed"; let detailError = "";
        if (!detail) try { const article = await fetchArticle(canonical); detail = article.text; author = article.author; publishedAt = article.publishedAt || publishedAt; processing = "success"; fetched += 1; } catch (error) { detailError = error instanceof Error ? error.message : "正文抓取失败"; }
        const bestRank = Math.min(Number(existing?.best_rank || 999), rank + 1);
        const occurrences = matched.length;
        const titleMatches = keywords.filter((item) => result.title!.toLowerCase().includes(item.toLowerCase())).length;
        const relevance = Math.min(100, 35 + titleMatches * 20 + Math.max(0, 25 - bestRank * 2));
        const trendScore = Math.min(100, Math.round((101 - Math.min(100, bestRank * 5)) * .45 + occurrences * 12 + relevance * .3));
        const id = String(existing?.id || crypto.randomUUID());
        await db.prepare(`INSERT INTO article_research_samples (id,canonical_url,title,source_url,source_domain,author_name,matched_keywords,search_engines,snippet,detail_text,published_at,best_rank,occurrence_count,relevance_score,trend_score,processing_status,detail_error,status,first_seen_at,last_seen_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title,matched_keywords=excluded.matched_keywords,search_engines=excluded.search_engines,snippet=excluded.snippet,detail_text=CASE WHEN excluded.detail_text!='' THEN excluded.detail_text ELSE article_research_samples.detail_text END,published_at=COALESCE(NULLIF(excluded.published_at,''),article_research_samples.published_at),best_rank=excluded.best_rank,occurrence_count=excluded.occurrence_count,relevance_score=excluded.relevance_score,trend_score=excluded.trend_score,processing_status=CASE WHEN article_research_samples.detail_text!='' THEN 'success' ELSE excluded.processing_status END,detail_error=CASE WHEN article_research_samples.detail_text!='' THEN '' ELSE excluded.detail_error END,last_seen_at=excluded.last_seen_at`)
          .bind(id, canonical, result.title.slice(0, 300), canonical, domain, author.slice(0, 160), JSON.stringify(matched), JSON.stringify(engines), String(result.content || "").slice(0, 2000), detail, publishedAt || null, bestRank, occurrences, relevance, trendScore, processing, detailError.slice(0, 500), existing?.first_seen_at || now, now).run();
        if (processing === "success" && detail) discovered += 1;
        }
      }
    }
    await audit(user.id, "执行知乎SEO文章搜索", "article_research", crypto.randomUUID(), `${keywords.join("、")} / 发现${discovered} / 正文${fetched}`);
    if (!discovered && errors.length) return Response.json({ error: errors.join("；") }, { status: 502 });
    return Response.json({ ok: true, discovered, fetched, errors });
  }

  if (action === "create_topic") {
    const sampleId = String(data.sample_id || "");
    const sample = await db.prepare("SELECT * FROM article_research_samples WHERE id=? AND status!='archived'").bind(sampleId).first<Record<string, unknown>>();
    if (!sample) return Response.json({ error: "文章样本不存在" }, { status: 404 });
    if (sample.processing_status !== "success" || !sample.detail_text) return Response.json({ error: "来源正文尚未抓取成功，暂时不能转入选题" }, { status: 409 });
    const topicId = crypto.randomUUID();
    const topicTitle = String(data.title || sample.title).trim().slice(0, 300);
    const detail = String(sample.detail_text).slice(0, 1500);
    const keywords = parseJsonList(String(sample.matched_keywords || "[]"));
    await db.batch([
      db.prepare("INSERT INTO topics (id,title,source_url,relevance,status,platform,source_type,source_external_id,created_by,created_at) VALUES (?,?,?,'高','unclaimed','zhihu','article_search',?,?,?)").bind(topicId, topicTitle, sample.source_url, sampleId, user.id, now),
      db.prepare("INSERT INTO topic_insights (topic_id,brief,target_audience,pain_point,hook_points,content_structure,why_it_works,account_fit,source_feed_ids,score,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(topicId, String(sample.snippet || detail.slice(0, 280)), "通过相关关键词主动搜索的知乎用户", `围绕“${keywords[0] || topicTitle}”寻找清晰、可信、可执行的解释`, JSON.stringify(keywords.map((item) => `回答“${item}”背后的真实问题`).slice(0, 5)), JSON.stringify(["问题界定", "核心观点", "证据与案例", "常见误区", "行动建议"]), `文章在搜索结果中的最佳排名为 ${sample.best_rank}，并命中 ${sample.occurrence_count} 个筛选关键词`, "适合转化为问题导向、信息密度高的知乎长文", JSON.stringify([`article:${sampleId}`]), Number(sample.trend_score || 0), now),
      db.prepare("UPDATE article_research_samples SET status='used' WHERE id=?").bind(sampleId),
    ]);
    await audit(user.id, "从文章样本创建知乎SEO选题", "article_research", sampleId, topicTitle);
    return Response.json({ ok: true, topic_id: topicId });
  }

  if (action === "archive") {
    const sampleId = String(data.sample_id || "");
    await db.prepare("UPDATE article_research_samples SET status='archived' WHERE id=?").bind(sampleId).run();
    await audit(user.id, "归档文章研究样本", "article_research", sampleId);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
