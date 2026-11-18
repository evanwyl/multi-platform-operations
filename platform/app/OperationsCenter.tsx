/* eslint-disable @next/next/no-img-element -- authenticated local covers */
"use client";
import { useCallback, useEffect, useState } from "react";
import {
  interactionRate,
  reviewSnapshot,
} from "../runtime/platforms/operations-core.mjs";
type Account = { id: string; name: string; platform?: string; status: string };
type Claim = {
  id: string;
  title: string;
  topic_title: string;
  account_id: string;
  account_name: string;
  account_platform?: string;
  status: string;
  status_label: string;
  owner_name: string;
  published_at?: string;
  published_url?: string;
  updated_at: string;
  publish_images?: string[];
  creative?: { video_options?: { mode?: string; schedule_at?: string } };
};
type Metric = {
  account_id: string;
  claim_id: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  favorites: number | null;
  shares: number | null;
  collected_at: string;
};
type Followers = {
  account_id: string;
  followers: number;
  collected_at: string;
};
type Job = {
  id: string;
  account_id: string;
  claim_id: string;
  status: string;
  error: string;
  created_at: string;
  completed_at?: string;
};
type Data = {
  content: Metric[];
  accounts: Followers[];
  jobs: Job[];
  enabled: boolean;
  notifications?: { configured: boolean; enabled: boolean } | null;
  plans?: {
    id: string;
    claim_id: string;
    account_id: string;
    execute_at: string;
    status: string;
    error: string;
  }[];
};
const platforms: Record<string, [string, string, string]> = {
  xiaohongshu: ["小红书", "小", "#ee4055"],
  zhihu: ["知乎", "知", "#1677d2"],
  wechat: ["公众号", "微", "#20a16b"],
  douyin: ["抖音", "抖", "#202124"],
  wechat_channels: ["视频号", "视", "#ed922e"],
};
const tabs = [
  ["overview", "运营大屏"],
  ["performance", "内容表现"],
  ["followers", "账号增长"],
  ["calendar", "发布日历"],
  ["archive", "内容档案"],
  ["system", "采集状态"],
];
const n = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("zh-CN");
const date = (v?: string) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Shanghai",
      })
    : "尚未采集";
const day = (v: string) =>
  new Date(v).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
function Mark({ platform }: { platform?: string }) {
  const p = platforms[platform || "xiaohongshu"] || ["其他", "·", "#777"];
  return (
    <span className="oc-mark" style={{ background: p[2] }} title={p[0]}>
      {p[1]}
    </span>
  );
}
function Cover({ claim }: { claim: Claim }) {
  const [failedId, setFailedId] = useState("");
  return claim.publish_images?.length && failedId !== claim.id ? (
    <img
      className="oc-cover"
      src={`/api/assets?claim_id=${encodeURIComponent(claim.id)}&index=0`}
      alt={claim.title || claim.topic_title}
      loading="lazy"
      onError={() => setFailedId(claim.id)}
    />
  ) : (
    <div className="oc-cover oc-cover-empty">
      <Mark platform={claim.account_platform} />
      <span>{claim.title || claim.topic_title}</span>
    </div>
  );
}
function Spark({
  values,
  color = "#0071e3",
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2)
    return <p className="oc-muted">积累两次采样后显示趋势</p>;
  const low = Math.min(...values),
    range = Math.max(...values) - low || 1;
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 300},${70 - ((v - low) / range) * 60}`,
    )
    .join(" ");
  return (
    <svg
      className="oc-spark"
      viewBox="0 0 300 80"
      role="img"
      aria-label={`从 ${values[0]} 到 ${values.at(-1)}，共 ${values.length} 次采样`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export default function OperationsCenter({
  accounts,
  claims,
  roles,
  openClaim,
  notify,
}: {
  accounts: Account[];
  claims: Claim[];
  roles: string[];
  openClaim: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState("overview"),
    [query, setQuery] = useState(""),
    [accountId, setAccountId] = useState(""),
    [page, setPage] = useState(1);
  const [data, setData] = useState<Data>({
    content: [],
    accounts: [],
    jobs: [],
    enabled: false,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [monthOffset, setMonthOffset] = useState(0);
  const [linkClaim, setLinkClaim] = useState<Claim | null>(null),
    [linkUrl, setLinkUrl] = useState("");
  const [selected, setSelected] = useState<Claim | null>(null);
  const [webhook, setWebhook] = useState("");
  const [confirmPublished, setConfirmPublished] = useState(false);
  const [scheduleClaim, setScheduleClaim] = useState<Claim | null>(null);
  const [executeAt, setExecuteAt] = useState("");
  const canCollect = roles.some((r) =>
    ["admin", "operator", "reviewer"].includes(r),
  );
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/operations");
      const v = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw new Error(v.error || "运营数据读取失败");
      setData(v);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "运营数据读取失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const v = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(v.error || "操作失败");
      await load();
      notify(
        payload.action === "collect"
          ? "已加入后台采集队列，可在采集状态中查看结果"
          : "已保存",
      );
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const filtered = claims.filter(
    (c) =>
      (!accountId || c.account_id === accountId) &&
      `${c.title} ${c.topic_title} ${c.account_name} ${c.owner_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const published = filtered
    .filter((c) => c.status === "published")
    .sort((a, b) =>
      (b.published_at || b.updated_at).localeCompare(
        a.published_at || a.updated_at,
      ),
    );
  const archived = filtered.filter((c) =>
    [
      "published",
      "scheduled",
      "drafted",
      "failed",
      "approved",
      "queued",
      "publishing",
      "awaiting_user",
    ].includes(c.status),
  );
  const metric = (id: string) => data.content.find((v) => v.claim_id === id);
  const follower = (id: string) =>
    data.accounts.find((v) => v.account_id === id);
  const visibleAccounts = accounts.filter(
    (a) => !accountId || a.id === accountId,
  );
  const measured = published
    .map((c) => metric(c.id))
    .filter((v): v is Metric => Boolean(v));
  const views = measured.some((v) => v.views != null)
    ? measured.reduce((sum, v) => sum + (v.views || 0), 0)
    : null;
  const fans = visibleAccounts
    .map((a) => follower(a.id))
    .filter((v): v is Followers => Boolean(v));
  const latest = published[0],
    latestMetric = latest ? metric(latest.id) : null;
  const pending = data.jobs.filter((j) =>
    ["running", "pending"].includes(j.status),
  );
  const failed = data.jobs.filter((j) => j.status === "failed");
  const lastSuccess = data.jobs.find((j) => j.status === "succeeded");
  const changeTab = (id: string) => {
    setTab(id);
    setPage(1);
  };
  const rows =
    tab === "performance"
      ? published
      : tab === "system"
        ? data.jobs.filter((j) => !accountId || j.account_id === accountId)
        : archived;
  const pageCount = Math.max(1, Math.ceil(rows.length / 10)),
    currentPage = Math.min(page, pageCount);
  const now = new Date(),
    month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const days = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(
        month.getFullYear(),
        month.getMonth(),
        1 - ((month.getDay() + 6) % 7) + i,
      ),
  );
  const rate = (m?: Metric | null) => {
    const v = interactionRate(m);
    return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  };
  const pagination = (
    <div className="oc-pagination">
      <span>共 {rows.length} 条 · 每页 10 条</span>
      <button
        disabled={currentPage === 1}
        onClick={() => setPage(currentPage - 1)}
      >
        上一页
      </button>
      <strong>
        {currentPage} / {pageCount}
      </strong>
      <button
        disabled={currentPage === pageCount}
        onClick={() => setPage(currentPage + 1)}
      >
        下一页
      </button>
    </div>
  );
  const search = (
    <input
      className="oc-search"
      aria-label="搜索内容"
      placeholder="搜索标题、账号或负责人"
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        setPage(1);
      }}
    />
  );
  return (
    <section className="operations-center">
      <header className="oc-header">
        <div>
          <span className="oc-eyebrow">内容运营 · 数据与复盘</span>
          <h1>让每一次发布，都积累经验</h1>
          <p>查看内容表现、账号增长和发布安排，沿着作品回到选题与创作。</p>
        </div>
        <div className="oc-health">
          <i className={failed.length ? "warn" : ""} />
          {pending.length
            ? `${pending.length} 个采集任务排队中`
            : `最近成功任务：${date(lastSuccess?.completed_at)}`}
        </div>
      </header>
      <div className="oc-toolbar">
        <nav aria-label="运营数据视图">
          {tabs.map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => changeTab(id)}
              key={id}
            >
              {label}
            </button>
          ))}
        </nav>
        <select
          aria-label="筛选账号"
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部账号</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {platforms[a.platform || ""]?.[0]} · {a.name}
            </option>
          ))}
        </select>
        <button className="oc-button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      {error ? (
        <div role="alert" className="oc-error">
          {error}
          <button onClick={() => void load()}>重试</button>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="oc-empty">
          正在读取运营记录…
        </p>
      ) : null}
      {!loading && tab === "overview" ? (
        <>
          <div className="oc-hero-grid">
            <article className="oc-panel oc-latest">
              {latest ? (
                <>
                  <Cover claim={latest} />
                  <div className="oc-latest-info">
                    <span className="oc-eyebrow">最近发布</span>
                    <h2>{latest.title || latest.topic_title}</h2>
                    <p>
                      {latest.account_name} · {date(latest.published_at)}
                    </p>
                    <div className="oc-inline-stats">
                      <div>
                        <small>播放 / 阅读</small>
                        <strong>{n(latestMetric?.views)}</strong>
                      </div>
                      <div>
                        <small>互动率</small>
                        <strong>{rate(latestMetric)}</strong>
                      </div>
                    </div>
                    <button
                      className="oc-button primary"
                      onClick={() => setSelected(latest)}
                    >
                      查看内容表现
                    </button>
                  </div>
                </>
              ) : (
                <div className="oc-empty">
                  <h2>从第一篇正式发布开始</h2>
                  <p>已有草稿与定时任务可以在内容档案中查看。</p>
                  <button
                    className="oc-button"
                    onClick={() => changeTab("archive")}
                  >
                    查看内容档案
                  </button>
                </div>
              )}
            </article>
            <article className="oc-panel">
              <span className="oc-muted">已采集账号粉丝</span>
              <strong className="oc-big-number">
                {fans.length
                  ? n(fans.reduce((sum, v) => sum + v.followers, 0))
                  : "—"}
              </strong>
              <p className="oc-muted">
                已覆盖 {fans.length} / {visibleAccounts.length} 个账号
              </p>
              <div className="oc-growth-summary">
                <strong>{published.length}</strong>
                <span>篇正式发布</span>
                <strong>{measured.length}</strong>
                <span>篇已有数据</span>
              </div>
              <button
                className="oc-text-button"
                onClick={() => changeTab("followers")}
              >
                查看各账号趋势 →
              </button>
            </article>
            <article className="oc-panel oc-discoveries">
              <h2>运营发现</h2>
              <p>
                <b>{published.length}</b> 篇正式发布，<b>{measured.length}</b>{" "}
                篇已有指标。
              </p>
              {measured.length ? (
                <p>
                  已采集作品累计播放 / 阅读 <b>{n(views)}</b>。
                </p>
              ) : (
                <p>完成首次采集后，可比较内容表现与账号历史基准。</p>
              )}
              <p>
                <b>{filtered.filter((c) => c.status === "review").length}</b>{" "}
                篇等待审核，
                <b>
                  {filtered.filter((c) => c.status === "failed").length}
                </b>{" "}
                篇发布异常。
              </p>
              <button
                className="oc-text-button"
                onClick={() => changeTab("system")}
              >
                查看采集状态 →
              </button>
            </article>
          </div>
          <div className="oc-account-grid">
            {visibleAccounts.map((a) => {
              const v = follower(a.id),
                history = data.accounts
                  .filter((item) => item.account_id === a.id)
                  .slice(0, 30)
                  .reverse();
              const delta =
                history.length > 1
                  ? history.at(-1)!.followers - history[0].followers
                  : null;
              return (
                <article className="oc-panel oc-account" key={a.id}>
                  <div className="oc-account-title">
                    <Mark platform={a.platform} />
                    <div>
                      <strong>{a.name}</strong>
                      <small>{platforms[a.platform || ""]?.[0]}</small>
                    </div>
                  </div>
                  <strong className="oc-account-number">
                    {n(v?.followers)}
                  </strong>
                  <span className="oc-muted">粉丝总量</span>
                  <Spark
                    values={history.map((item) => item.followers)}
                    color={platforms[a.platform || ""]?.[2]}
                  />
                  <small>
                    期间变化{" "}
                    {delta == null ? "—" : `${delta > 0 ? "+" : ""}${n(delta)}`}{" "}
                    · {date(v?.collected_at)}
                  </small>
                  <button
                    className="oc-text-button"
                    onClick={() => {
                      setAccountId(a.id);
                      changeTab("followers");
                    }}
                  >
                    查看账号增长 →
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
      {!loading && tab === "performance" ? (
        <>
          <div className="oc-kpis">
            {[
              ["已正式发布", published.length],
              ["已采集作品", measured.length],
              ["累计播放 / 阅读", views],
              ["待采集", published.length - measured.length],
            ].map(([label, v]) => (
              <article className="oc-panel" key={String(label)}>
                <small>{label}</small>
                <strong>{n(v as number | null)}</strong>
              </article>
            ))}
          </div>
          {search}
          <div className="oc-panel oc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>内容</th>
                  <th>账号</th>
                  <th>播放 / 阅读</th>
                  <th>赞 / 评 / 藏 / 转</th>
                  <th>互动率</th>
                  <th>最近采集</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {published
                  .slice((currentPage - 1) * 10, currentPage * 10)
                  .map((c) => {
                    const m = metric(c.id);
                    return (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="oc-content-link"
                            onClick={() => setSelected(c)}
                          >
                            <Mark platform={c.account_platform} />
                            <strong>{c.title || c.topic_title}</strong>
                          </button>
                        </td>
                        <td>{c.account_name}</td>
                        <td>{n(m?.views)}</td>
                        <td>
                          {[m?.likes, m?.comments, m?.favorites, m?.shares]
                            .map(n)
                            .join(" / ")}
                        </td>
                        <td>{rate(m)}</td>
                        <td>{date(m?.collected_at)}</td>
                        <td>
                          <button
                            className="oc-text-button"
                            disabled={busy || !canCollect}
                            onClick={() =>
                              void mutate({ action: "collect", claim_id: c.id })
                            }
                          >
                            采集
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {!published.length ? (
              <p className="oc-empty">尚无符合条件的正式发布记录</p>
            ) : null}
            {pagination}
          </div>
          <p className="oc-muted">
            “—”表示尚未获得数据；互动率仅在播放与四项互动指标均可核验时计算。
          </p>
        </>
      ) : null}
      {!loading && tab === "followers" ? (
        <div className="oc-account-grid">
          {visibleAccounts.map((a) => {
            const history = data.accounts
              .filter((v) => v.account_id === a.id)
              .slice(0, 120)
              .reverse();
            return (
              <article className="oc-panel" key={a.id}>
                <div className="oc-account-title">
                  <Mark platform={a.platform} />
                  <h2>{a.name}</h2>
                </div>
                <strong className="oc-big-number">
                  {n(history.at(-1)?.followers)}
                </strong>
                <p className="oc-muted">
                  最近采集 {date(history.at(-1)?.collected_at)}
                </p>
                <Spark
                  values={history.map((v) => v.followers)}
                  color={platforms[a.platform || ""]?.[2]}
                />
                <button
                  className="oc-button"
                  disabled={busy || !canCollect || a.platform === "wechat"}
                  onClick={() =>
                    void mutate({ action: "collect", account_id: a.id })
                  }
                >
                  {a.platform === "wechat"
                    ? "公众号数据接口待接入"
                    : "采集账号数据"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
      {!loading && tab === "calendar" ? (
        <>
          <div className="oc-calendar-head">
            <h2>
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </h2>
            <div>
              <button
                className="oc-button"
                onClick={() => setMonthOffset(monthOffset - 1)}
              >
                上月
              </button>
              <button className="oc-button" onClick={() => setMonthOffset(0)}>
                本月
              </button>
              <button
                className="oc-button"
                onClick={() => setMonthOffset(monthOffset + 1)}
              >
                下月
              </button>
            </div>
          </div>
          <div className="oc-panel oc-calendar">
            {["一", "二", "三", "四", "五", "六", "日"].map((v) => (
              <div className="oc-weekday" key={v}>
                周{v}
              </div>
            ))}
            {days.map((v) => {
              const key = day(v.toISOString()),
                today = day(new Date().toISOString()) === key;
              const entries = filtered.filter((c) => {
                const at =
                  data.plans?.find(
                    (plan) =>
                      plan.claim_id === c.id &&
                      ["pending", "running"].includes(plan.status),
                  )?.execute_at ||
                  c.creative?.video_options?.schedule_at ||
                  c.published_at;
                return at && day(at) === key;
              });
              return (
                <div
                  className={`oc-day ${today ? "today" : ""} ${v.getMonth() !== month.getMonth() ? "outside" : ""}`}
                  key={key}
                >
                  <span>
                    {v.getDate()}
                    {today ? " · 今天" : ""}
                  </span>
                  {entries.map((c) => (
                    <button
                      className="oc-calendar-item"
                      key={c.id}
                      onClick={() => setSelected(c)}
                    >
                      <Mark platform={c.account_platform} />
                      <span>
                        <strong>{c.title || c.topic_title}</strong>
                        <small>{c.status_label}</small>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="oc-muted">
            仅将已有明确发布时间的内容放入日历；未排期任务可在内容创作中处理。
          </p>
        </>
      ) : null}
      {!loading && tab === "archive" ? (
        <>
          {search}
          <div className="oc-archive-grid">
            {archived
              .slice((currentPage - 1) * 10, currentPage * 10)
              .map((c) => (
                <button
                  className="oc-panel oc-poster"
                  key={c.id}
                  onClick={() => setSelected(c)}
                >
                  <Cover claim={c} />
                  <div className="oc-poster-copy">
                    <small>
                      {c.account_name} · {date(c.published_at || c.updated_at)}
                    </small>
                    <h2>{c.title || c.topic_title}</h2>
                    <div>
                      <span className={`oc-status ${c.status}`}>
                        {c.status_label}
                      </span>
                      <span>{n(metric(c.id)?.views)} 播放 / 阅读</span>
                    </div>
                  </div>
                </button>
              ))}
          </div>
          {!archived.length ? <p className="oc-empty">尚无内容档案</p> : null}
          {pagination}
        </>
      ) : null}
      {!loading && tab === "system" ? (
        <>
          <article className="oc-panel oc-settings">
            <div>
              <h2>后台自动采集</h2>
              <p>
                新内容前 3 天每 6
                小时采集，之后每天采集；粉丝每天采集，登录状态每小时巡检。团队主机运行时持续执行。
              </p>
              <small>
                公众号草稿不计作正式发布。采集失败不会覆盖历史数据。
              </small>
            </div>
            <button
              className="oc-button primary"
              disabled={busy || !roles.includes("admin")}
              onClick={() =>
                void mutate({ action: "settings", enabled: !data.enabled })
              }
            >
              {data.enabled ? "暂停自动采集" : "启用自动采集"}
            </button>
          </article>
          <div className="oc-panel oc-table-wrap">
            {data.plans?.length ? (
              <>
                <h2>自动发布排期</h2>
                <table>
                  <thead>
                    <tr>
                      <th>内容</th>
                      <th>执行时间</th>
                      <th>状态</th>
                      <th>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plans
                      .filter(
                        (plan) => !accountId || plan.account_id === accountId,
                      )
                      .slice(0, 10)
                      .map((plan) => (
                        <tr key={plan.id}>
                          <td>
                            {claims.find((c) => c.id === plan.claim_id)
                              ?.title || "内容任务"}
                          </td>
                          <td>{date(plan.execute_at)}</td>
                          <td>
                            {
                              (
                                {
                                  pending: "等待执行",
                                  running: "执行中",
                                  completed: "已执行",
                                  canceled: "已取消",
                                  failed: "失败",
                                  uncertain: "待人工核验",
                                } as Record<string, string>
                              )[plan.status]
                            }
                          </td>
                          <td>{plan.error || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : null}
            {roles.includes("admin") ? (
              <form
                className="oc-settings"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await mutate({
                      action: "notifications",
                      webhook,
                      enabled: true,
                    })
                  )
                    setWebhook("");
                }}
              >
                <div>
                  <h2>飞书运营通知</h2>
                  <p>审核和发布事件通过后台队列发送，地址仅保存在团队主机。</p>
                  <label>
                    机器人 Webhook
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={
                        data.notifications?.configured
                          ? "已配置；留空保留原地址"
                          : "https://open.feishu.cn/open-apis/bot/v2/hook/…"
                      }
                      value={webhook}
                      onChange={(e) => setWebhook(e.target.value)}
                    />
                  </label>
                </div>
                <div className="oc-detail-actions">
                  <button
                    className="oc-button primary"
                    disabled={
                      busy || (!webhook && !data.notifications?.configured)
                    }
                  >
                    保存并启用通知
                  </button>
                  {data.notifications?.enabled ? (
                    <button
                      type="button"
                      className="oc-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate({ action: "notifications", enabled: false })
                      }
                    >
                      暂停通知
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}
            <h2>最近采集任务</h2>
            <table>
              <thead>
                <tr>
                  <th>账号 / 内容</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs
                  .filter((j) => !accountId || j.account_id === accountId)
                  .slice((currentPage - 1) * 10, currentPage * 10)
                  .map((j) => (
                    <tr key={j.id}>
                      <td>
                        {accounts.find((a) => a.id === j.account_id)?.name}
                        <small>
                          {claims.find((c) => c.id === j.claim_id)?.title ||
                            (j.claim_id === "__health__" ? "登录状态巡检" : "账号粉丝")}
                        </small>
                      </td>
                      <td>
                        {(
                          {
                            pending: "排队中",
                            running: "采集中",
                            succeeded: "已完成",
                            failed: "失败",
                          } as Record<string, string>
                        )[j.status] || j.status}
                      </td>
                      <td>{date(j.completed_at || j.created_at)}</td>
                      <td>
                        {j.error ||
                          (j.status === "succeeded"
                            ? "已保存指标快照"
                            : "等待执行")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.jobs.length ? (
              <p className="oc-empty">
                暂无采集任务，可在内容表现或账号增长中开始采集。
              </p>
            ) : null}
            {pagination}
          </div>
        </>
      ) : null}
      {selected ? (
        <div className="modal-backdrop">
          <section
            className="modal oc-detail"
            role="dialog"
            aria-modal="true"
            aria-label="内容表现与复盘"
          >
            <header>
              <div>
                <span className="oc-eyebrow">
                  内容档案 · {selected.status_label}
                </span>
                <h2>{selected.title || selected.topic_title}</h2>
              </div>
              <button className="oc-button" onClick={() => setSelected(null)}>
                关闭
              </button>
            </header>
            <p>
              {selected.account_name} · 负责人 {selected.owner_name}
            </p>
            <div className="oc-detail-metrics">
              {[
                ["播放 / 阅读", metric(selected.id)?.views],
                ["点赞", metric(selected.id)?.likes],
                ["评论", metric(selected.id)?.comments],
                ["收藏", metric(selected.id)?.favorites],
                ["分享", metric(selected.id)?.shares],
              ].map(([label, v]) => (
                <div key={label as string}>
                  <small>{label}</small>
                  <strong>{n(v as number | null | undefined)}</strong>
                </div>
              ))}
            </div>
            <Spark
              values={data.content
                .filter((v) => v.claim_id === selected.id && v.views != null)
                .slice(0, 100)
                .reverse()
                .map((v) => v.views!)}
            />
            <h3>发布后复盘</h3>
            <div className="oc-review-grid">
              {[1, 3, 7].map((d) => {
                const base = Date.parse(selected.published_at || ""),
                  at = base + d * 86400e3;
                const snapshot = reviewSnapshot(
                  data.content.filter((v) => v.claim_id === selected.id),
                  selected.published_at,
                  d,
                ) as Metric | null;
                return (
                  <article key={d}>
                    <strong>第 {d} 天</strong>
                    <p>
                      {!Number.isFinite(base) || now.getTime() < at
                        ? "尚未到复盘时间"
                        : snapshot
                          ? `${n(snapshot.views)} 播放 / 阅读 · ${rate(snapshot)} 互动率`
                          : "该时段无采样记录"}
                    </p>
                    <small>
                      {snapshot
                        ? `采样于 ${date(snapshot.collected_at)}`
                        : "后续采样不会回填为历史数据"}
                    </small>
                  </article>
                );
              })}
            </div>
            <div className="oc-detail-actions">
              {canCollect && selected.status === "approved" ? (
                <button
                  className="oc-button"
                  onClick={() => {
                    setScheduleClaim(selected);
                    setExecuteAt("");
                  }}
                >
                  安排自动执行发布
                </button>
              ) : null}
              {canCollect &&
              data.plans?.some(
                (plan) =>
                  plan.claim_id === selected.id && plan.status === "pending",
              ) ? (
                <button
                  className="oc-button"
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      action: "cancel_schedule",
                      claim_id: selected.id,
                    })
                  }
                >
                  取消发布排期
                </button>
              ) : null}
              <button
                className="oc-button primary"
                onClick={() => openClaim(selected.id)}
              >
                查看选题、创作与审核链路
              </button>
              {selected.published_url ? (
                <a
                  className="oc-button"
                  href={selected.published_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开平台记录 ↗
                </a>
              ) : null}
              {canCollect ? (
                <button
                  className="oc-button"
                  onClick={() => {
                    setLinkClaim(selected);
                    setLinkUrl(selected.published_url || "");
                    setConfirmPublished(false);
                  }}
                >
                  关联正式作品链接
                </button>
              ) : null}
              {selected.status === "published" && canCollect ? (
                <button
                  disabled={busy}
                  className="oc-button"
                  onClick={() =>
                    void mutate({ action: "collect", claim_id: selected.id })
                  }
                >
                  采集最新数据
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {linkClaim ? (
        <div className="modal-backdrop">
          <form
            className="modal oc-link-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate({
                  action: "link",
                  claim_id: linkClaim.id,
                  url: linkUrl,
                  confirm_published: confirmPublished,
                })
              )
                setLinkClaim(null);
            }}
          >
            <h2>关联正式作品链接</h2>
            <p>粘贴该作品的公开地址，后台管理页地址不能用作作品ID。</p>
            <label>
              作品链接
              <input
                required
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </label>
            {linkClaim.status !== "published" ? (
              <label className="oc-confirm">
                <input
                  type="checkbox"
                  checked={confirmPublished}
                  onChange={(event) =>
                    setConfirmPublished(event.target.checked)
                  }
                />
                我已到平台核对，确认作品已正式发布（不含草稿或未到时间的定时任务）
              </label>
            ) : null}
            <div className="oc-detail-actions">
              <button
                type="button"
                className="oc-button"
                onClick={() => setLinkClaim(null)}
              >
                取消
              </button>
              <button className="oc-button primary" disabled={busy}>
                保存链接
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {scheduleClaim ? (
        <div className="modal-backdrop">
          <form
            className="modal oc-link-modal"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await mutate({
                  action: "schedule_publish",
                  claim_id: scheduleClaim.id,
                  execute_at: `${executeAt}:00+08:00`,
                })
              )
                setScheduleClaim(null);
            }}
          >
            <h2>安排自动执行发布</h2>
            <p>
              {scheduleClaim.account_name} ·{" "}
              {scheduleClaim.title || scheduleClaim.topic_title}
            </p>
            <label>
              执行时间（中国标准时间）
              <input
                required
                type="datetime-local"
                value={executeAt}
                onChange={(event) => setExecuteAt(event.target.value)}
              />
            </label>
            <p>
              到点后将使用当前审核快照执行真实发布。团队主机须保持运行；结果不确定时停止重试并等待人工核验。
            </p>
            <div className="oc-detail-actions">
              <button
                type="button"
                className="oc-button"
                onClick={() => setScheduleClaim(null)}
              >
                取消
              </button>
              <button
                className="oc-button primary"
                disabled={busy || !executeAt}
              >
                确认排期
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
