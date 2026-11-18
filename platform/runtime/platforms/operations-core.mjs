// Missing metrics stay null: unavailable data must never be presented as zero.
export function metricNumber(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const match = String(value ?? "")
    .replace(/,/g, "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(万|亿|k|m|w)?$/i);
  if (!match) return null;
  return Math.round(
    Number(match[1]) *
      ({ 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6, w: 1e4 }[
        String(match[2] || "").toLowerCase()
      ] || 1),
  );
}

export function contentIdentity(platform, raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const rules = {
      xiaohongshu: [
        /^(www\.)?xiaohongshu\.com$/,
        /^\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i,
      ],
      douyin: [/^(www\.)?douyin\.com$/, /^\/(?:video|note)\/(\d+)/],
      zhihu: [/^zhuanlan\.zhihu\.com$/, /^\/p\/(\d+)/],
      wechat: [/^mp\.weixin\.qq\.com$/, /^\/s(?:\/([\w-]+))?$/],
      wechat_channels: [
        /^channels\.weixin\.qq\.com$/,
        /^\/platform\/post\/([\w-]{16,})$/,
      ],
    };
    const rule = rules[platform];
    const match =
      rule && rule[0].test(url.hostname) && url.pathname.match(rule[1]);
    const id = match && (match[1] || url.searchParams.get("mid"));
    return id ? { url: url.href, id } : null;
  } catch {
    return null;
  }
}

export function collectionInterval(publishedAt, now = Date.now()) {
  const age = now - Date.parse(publishedAt || "");
  return Number.isFinite(age) && age >= 0 && age < 3 * 86400e3
    ? 6 * 3600e3
    : 24 * 3600e3;
}

export function interactionRate(metric) {
  if (!metric || !(metric.views > 0)) return null;
  const values = [
    metric.likes,
    metric.comments,
    metric.favorites,
    metric.shares,
  ];
  if (values.some((value) => value == null)) return null;
  return values.reduce((sum, value) => sum + value, 0) / metric.views;
}

export const metricLeaseSql = `UPDATE metric_jobs SET status='running',started_at=? WHERE id=(
  SELECT id FROM metric_jobs WHERE status='pending' ORDER BY created_at LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM metric_jobs WHERE status='running') RETURNING *`;

export function reviewSnapshot(samples, publishedAt, days) {
  const start = Date.parse(publishedAt || ""),
    end = start + days * 86400e3;
  return (
    samples
      .filter((sample) => {
        const at = Date.parse(sample.collected_at);
        return at >= start && at <= end && at >= end - 24 * 3600e3;
      })
      .sort((a, b) => b.collected_at.localeCompare(a.collected_at))[0] || null
  );
}
