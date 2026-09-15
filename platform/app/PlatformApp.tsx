/* eslint-disable @next/next/no-img-element -- authenticated local review assets cannot use the remote image optimizer */
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Bell,
  CaretDown,
  CheckCircle,
  FileText,
  GearSix,
  House,
  Lightbulb,
  ListMagnifyingGlass,
  PaperPlaneTilt,
  PenNib,
  Plus,
  TrendUp,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";

type User = { id: string; name: string; username: string; roles: string[] };
type PlatformId = "xiaohongshu" | "zhihu" | "wechat";
type Account = { id: string; name: string; status: string; color: string; queue_count: number; platform?: PlatformId; external_user_id?: string; external_display_name?: string; auth_method?: string; xhs_user_id?: string; xhs_nickname?: string; xhs_red_id?: string; profile_bio?: string; avatar_url?: string; following_count?: string; followers_count?: string; interaction_count?: string; note_count?: number; profile_synced_at?: string; persona?: string; audience?: string; content_pillars?: string[]; strategy_keywords?: string[]; excluded_topics?: string[] };
type Topic = { id: string; title: string; source_url: string; relevance: string; status: string; platform?: PlatformId; source_type?: string; creator_name: string; created_at: string; brief?: string; target_audience?: string; pain_point?: string; hook_points?: string[]; content_structure?: string[]; why_it_works?: string; account_fit?: string; source_feed_ids?: string[]; score?: number; source_author?: string; source_keyword?: string; liked_count?: string; collected_count?: string; comment_count?: string; heat_score?: number; captured_at?: string; note_published_at?: string; note_id?: string; source_processing_status?: string; source_detail_verified?: number; claim_status?: string; claim_owner_name?: string };
type ImagePrompt = { label: string; prompt: string };
type CreativeDraft = { title_options: string[]; title: string; body: string; tags: string[]; image_prompts: ImagePrompt[]; creative_note: string };
type CreativeVersion = { id: string; version_number: number; source: string; title: string; created_at: string };
type Claim = { id: string; topic_id: string; topic_title: string; account_id: string; account_name: string; account_color: string; account_platform?: PlatformId; content_type?: "xiaohongshu_note" | "zhihu_article" | "zhihu_answer" | "wechat_article"; external_content_id?: string; published_url?: string; owner_id: string; owner_name: string; angle: string; status: string; status_label: string; title: string; body: string; tags: string[]; review_comment: string; updated_at: string; creative?: Partial<CreativeDraft>; creation_status?: string; creation_error?: string; version_number?: number; generated_at?: string; publish_images?: string[]; publish_error?: string; published_at?: string; publisher_id?: string; publisher_name?: string; publish_recoverable?: boolean; publish_snapshot?: { title?: string; body?: string; tags?: string[]; images?: string[]; approved_at?: string; content_type?: string } | null };
type Log = { id: string; actor_name: string; action: string; object_type: string; detail: string; created_at: string };
type AISettings = { configured: boolean; baseUrl: string; model: string; keySource: "environment" | "local" | "none"; busy?: boolean; unavailable?: boolean };
type AppData = { user: User; accounts: Account[]; topics: Topic[]; claims: Claim[]; logs: Log[]; users: User[]; ai_settings: AISettings };
type TrendSettings = { account_id?: string; target_account_id?: string; keywords: string[]; exclude_keywords: string[]; publish_time: string; sort_by: string; content_type?: "image" | "video" | "all"; last_scanned_at?: string; next_allowed_at?: string };
type TrendSample = { id: string; feed_id: string; keyword: string; matched_keywords: string[]; title: string; author_name: string; note_type: string; source_url: string; cover_url: string; detail_text: string; original_tags: string[]; content_summary: string; sample_hooks: string[]; title_hook: string; visual_highlight: string; sample_pain_point: string; emotion_pain: string; practical_value: string; controversy_point: string; sample_structure: string[]; reusable_directions: string[]; account_adaptation: string; relevance_score: number; intent_match_score: number; account_fit_score: number; information_density_score: number; remix_value_score: number; visible_proof_score: number; reproducibility_score: number; prefilter_score: number; final_quality_score: number; quality_tier: "core" | "signal" | "excluded" | "unrated"; selection_reason: string; liked_count: string; collected_count: string; comment_count: string; shared_count: string; raw_heat_score: number; heat_score: number; published_at?: string; selection_status: string; processing_status: string; capture_outcome: string; detail_error: string; status: string; first_seen_at: string; last_seen_at: string };
type SearchPlan = { theme: string; intent_summary: string; primary_keyword: string; intent_phrase: string; scenario_terms: string[]; keywords: string[]; exclude_keywords: string[]; publish_time: string; sort_by: string; content_type: "image" | "video" | "all"; target_account_id: string; target_account_name: string };
type TrendScan = { id: string; keywords: string[]; completed_keywords: string[]; status: string; result_count: number; error: string; started_at: string; completed_at?: string };
type TrendData = { settings: TrendSettings; samples: TrendSample[]; scans: TrendScan[]; accounts: Account[] };
type ArticleSample = { id: string; title: string; source_url: string; source_domain: string; author_name: string; matched_keywords: string[]; search_engines: string[]; snippet: string; detail_text: string; published_at?: string; best_rank: number; occurrence_count: number; relevance_score: number; trend_score: number; processing_status: string; detail_error: string; status: string; last_seen_at: string };
type ArticleResearchData = { configured: boolean; endpoint: string; samples: ArticleSample[]; accounts: Account[] };
type AuthData = { initialized: boolean; user: User | null };
type TrendActionResult = {
  scan_id?: string; reused?: boolean; detail_sample_ids?: string[]; needs_analysis?: boolean;
  message?: string; next_allowed_at?: string; keywords?: string[]; recovered_failed_screen?: boolean;
  warning?: string; candidate_count?: number; selected_count?: number; core_samples?: number;
};
type XhsActionResult = { image: string; text: string; unknown?: boolean; online?: boolean };

const navItems: Array<[string, Icon, string]> = [
  ["logs", ListMagnifyingGlass, "日志中心"], ["settings", GearSix, "系统设置"],
];

const accountStatus: Record<string, string> = { online: "在线", auth_configured: "授权已配置", busy: "发布中", login_expired: "登录失效", unknown: "状态未知", paused: "已暂停", error: "异常" };
const claimStatus: Record<string, string> = { writing: "创作中", review: "待审核", revision: "待修改", approved: "待发布", queued: "发布队列", publishing: "发布中", published: "已发布", failed: "发布失败" };
const sampleProcessingStatus: Record<string, string> = { pending: "等待处理", detail_fetching: "正在获取详情", success: "成功", skipped: "跳过", detail_failed: "详情获取失败" };
const sampleCaptureOutcome: Record<string, string> = { new: "新发现", duplicate: "已存在/重复" };

async function jsonRequest<T = Record<string, unknown>>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data as T;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function reviewImageUrl(claimId: string, index: number) {
  return `/api/assets?claim_id=${encodeURIComponent(claimId)}&index=${index}`;
}

function withCoverTitle(creative: CreativeDraft): CreativeDraft {
  if (!creative.title || !creative.image_prompts.length) return creative;
  const found = creative.image_prompts.findIndex((item) => /封面|主视觉/.test(item.label));
  const index = found >= 0 ? found : 0;
  const cover = { ...creative.image_prompts[index], label: "封面主视觉" };
  const rule = `标题文字：画面必须逐字、清晰呈现“${creative.title}”，作为最高视觉层级；使用醒目的高对比中文字体，字号约占画面高度12%至18%，确保手机缩略图中仍可辨认，不得改字、漏字、使用占位符或生成乱码。`;
  const base = cover.prompt.replace(/\n?标题文字：画面必须逐字、清晰呈现[\s\S]*$/, "").trim();
  cover.prompt = `${base.slice(0, Math.max(0, 1180 - rule.length))}\n${rule}`.trim();
  return { ...creative, image_prompts: [cover, ...creative.image_prompts.filter((_, itemIndex) => itemIndex !== index)] };
}

function platformLabel(platform?: string) { return platform === "zhihu" ? "知乎" : platform === "wechat" ? "微信公众号" : "小红书"; }
function accountIdentitySummary(account: Account) {
  if (account.platform === "wechat") return "微信公众号账号";
  if (account.platform === "zhihu") return account.external_user_id ? "已配置知乎账号标识" : "尚未配置知乎授权";
  return account.xhs_red_id ? `小红书号 ${account.xhs_red_id}` : account.xhs_user_id ? "已绑定小红书身份" : "尚未绑定小红书身份";
}
function isZhihuClaim(claim?: Claim) { return claim?.content_type === "zhihu_article" || claim?.content_type === "wechat_article" || claim?.account_platform === "zhihu" || claim?.account_platform === "wechat"; }

function blankCreative(claim?: Claim): CreativeDraft {
  const saved = (claim?.creative ?? {}) as Partial<CreativeDraft>;
  const currentPrompts = Array.isArray(saved.image_prompts) ? saved.image_prompts
    .map((item) => ({ label: String(item.label ?? "配图建议"), prompt: String(item.prompt ?? "") }))
    .filter((item) => item.prompt) : [];
  const creative = {
    title_options: Array.isArray(saved?.title_options) ? saved.title_options : [],
    title: saved?.title ?? claim?.title ?? "",
    body: saved?.body ?? claim?.body ?? "",
    tags: Array.isArray(saved?.tags) ? saved.tags : claim?.tags ?? [],
    image_prompts: currentPrompts.slice(0, 6),
    creative_note: saved?.creative_note ?? "",
  };
  return isZhihuClaim(claim) ? creative : withCoverTitle(creative);
}

export default function PlatformApp() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState("dashboard");
  const [contentTargetId, setContentTargetId] = useState("");
  const [contentAccountId, setContentAccountId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [scopePlatform, setScopePlatform] = useState<PlatformId | "">("");
  const [scopeAccountId, setScopeAccountId] = useState("");
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<PlatformId, boolean>>({ xiaohongshu: true, zhihu: false, wechat: false });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const loadAuth = useCallback(async () => setAuth(await jsonRequest<AuthData>("/api/auth")), []);
  const loadData = useCallback(async () => setData(await jsonRequest<AppData>("/api/app")), []);
  useEffect(() => { fetch("/api/auth").then((response) => response.json() as Promise<AuthData>).then(setAuth).catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { if (auth?.user) jsonRequest<AppData>("/api/app").then(setData).catch((error) => { setData(null); setMessage(error instanceof Error ? error.message : "无法读取团队工作区"); }); }, [auth]);

  async function authSubmit(event: FormEvent<HTMLFormElement>, action: "setup" | "login") {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, name: form.get("name"), username: form.get("username"), password: form.get("password") }) });
      await loadAuth();
    } catch (error) { setMessage(error instanceof Error ? error.message : "登录失败"); }
    finally { setBusy(false); }
  }

  async function logout() {
    setProfileMenuOpen(false);
    await jsonRequest("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setData(null); await loadAuth();
  }

  async function action(payload: Record<string, unknown>, success: string) {
    setBusy(true); setMessage("");
    try {
      await jsonRequest("/api/app", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      await loadData(); setMessage(success);
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  if (!auth) return <div className="loading-page"><span></span><p>正在启动红薯台…</p></div>;
  if (!auth.initialized) return <AuthPage mode="setup" onSubmit={authSubmit} busy={busy} message={message} />;
  if (!auth.user) return <AuthPage mode="login" onSubmit={authSubmit} busy={busy} message={message} />;
  if (!data) return <div className="loading-page"><span></span><p>正在读取团队工作区…</p></div>;

  const messageStartsWithSuccess = /^(已|正文补抓与拆解完成|内容已)/.test(message);
  const messageHasWarning = messageStartsWithSuccess && /(不可用|仍需|已保留|跳过|超时)/.test(message);
  const messageHasError = !messageStartsWithSuccess && /(失败|不能|没有|无法|错误|中断)/.test(message);
  const scopedData: AppData = scopePlatform ? {
    ...data,
    accounts: data.accounts.filter((account) => (account.platform || "xiaohongshu") === scopePlatform && (!scopeAccountId || account.id === scopeAccountId)),
    topics: data.topics.filter((topic) => (topic.platform || "xiaohongshu") === scopePlatform),
    claims: data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === scopePlatform && (!scopeAccountId || claim.account_id === scopeAccountId)),
  } : data;

  function goPlatformView(target: string, platform: PlatformId, accountId = "") {
    setScopePlatform(platform);
    setScopeAccountId(accountId);
    setExpandedPlatforms((current) => ({ ...current, [platform]: true }));
    if (target === "content") {
      setContentAccountId(accountId);
      setContentTargetId("");
    }
    setView(target);
  }

  function openAccount(accountId: string) {
    const account = data?.accounts.find((item) => item.id === accountId);
    setScopePlatform((account?.platform || "xiaohongshu") as PlatformId);
    setScopeAccountId(accountId);
    setSelectedAccountId(accountId);
    setView("account-workspace");
  }

  function openAccountContent(accountId: string, claimId = "") {
    const account = data?.accounts.find((item) => item.id === accountId);
    setScopePlatform((account?.platform || "xiaohongshu") as PlatformId);
    setScopeAccountId(accountId);
    setContentAccountId(accountId);
    setContentTargetId(claimId);
    setView("content");
  }

  function openDashboardClaim(claim: Claim) {
    const platform = (claim.account_platform || "xiaohongshu") as PlatformId;
    setScopePlatform(platform);
    if (["writing", "revision"].includes(claim.status)) {
      setScopeAccountId(claim.account_id);
      setContentAccountId(claim.account_id);
      setContentTargetId(claim.id);
      setView("content");
      return;
    }
    setView(claim.status === "review" ? "review" : "publish");
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><FileText aria-hidden="true" size={23} weight="bold" /></span><div><strong>内容运营台</strong><small>多平台内容运营中台</small></div></div>
        <nav aria-label="主要导航">
          <div className="nav-group"><span className="nav-group-label">总览</span><button className={`nav-item ${view === "dashboard" ? "active" : ""}`} aria-current={view === "dashboard" ? "page" : undefined} onClick={() => { setScopePlatform(""); setScopeAccountId(""); setSelectedAccountId(""); setView("dashboard"); }}><span><House aria-hidden="true" size={18} weight={view === "dashboard" ? "fill" : "regular"} /></span>工作台</button></div>
          <div className="nav-group platform-accordion-group"><span className="nav-group-label">平台选择</span>{(["xiaohongshu", "zhihu", "wechat"] as const).map((platform) => {
            const xhs = platform === "xiaohongshu"; const name = platformLabel(platform); const glyph = xhs ? "小" : platform === "zhihu" ? "知" : "微"; const expanded = expandedPlatforms[platform]; const accounts = data.accounts.filter((account) => (account.platform || "xiaohongshu") === platform); const active = scopePlatform === platform;
            return <div className={`platform-accordion channel-${platform} ${active ? "current" : ""}`} key={platform}><button type="button" className="platform-accordion-trigger" aria-expanded={expanded} onClick={() => setExpandedPlatforms((current) => ({ ...current, [platform]: !current[platform] }))}><span className="platform-mini-mark" aria-hidden="true">{glyph}</span><strong>{name}</strong><small>{accounts.length}</small><CaretDown aria-hidden="true" size={14} className={expanded ? "open" : ""} /></button>{expanded ? <div className="platform-accordion-panel">
              {xhs ? <button className={view === "trends" && active ? "active" : ""} onClick={() => goPlatformView("trends", platform)}><TrendUp aria-hidden="true" size={15} />爆款搜索</button> : null}
              {platform === "zhihu" ? <button className={view === "trends" && active ? "active" : ""} onClick={() => goPlatformView("trends", platform)}><TrendUp aria-hidden="true" size={15} />SEO选题搜索</button> : null}
              <button className={view === "topics" && active ? "active" : ""} onClick={() => goPlatformView("topics", platform)}><Lightbulb aria-hidden="true" size={15} />选题中心</button>
              <button className={view === "content" && active && !scopeAccountId ? "active" : ""} onClick={() => goPlatformView("content", platform)}><FileText aria-hidden="true" size={15} />我的内容</button>
              <button className={view === "review" && active ? "active" : ""} onClick={() => goPlatformView("review", platform)}><CheckCircle aria-hidden="true" size={15} />审核中心{data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === platform && claim.status === "review").length ? <b>{data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === platform && claim.status === "review").length}</b> : null}</button>
              {platform !== "wechat" ? <button className={view === "publish" && active ? "active" : ""} onClick={() => goPlatformView("publish", platform)}><PaperPlaneTilt aria-hidden="true" size={15} />发布列表{data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === platform && ["approved", "queued", "publishing", "failed"].includes(claim.status)).length ? <b>{data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === platform && ["approved", "queued", "publishing", "failed"].includes(claim.status)).length}</b> : null}</button> : <button className="coming" onClick={() => goPlatformView("publish", platform)}><PaperPlaneTilt aria-hidden="true" size={15} />发布设计中<em>规划中</em></button>}
              <div className="sidebar-account-section">
                <button className={`platform-account-heading ${view === "accounts" && active ? "active" : ""}`} onClick={() => goPlatformView("accounts", platform)}><UsersThree aria-hidden="true" size={15} />账号管理{accounts.length ? <b>{accounts.length}</b> : null}</button>
                <div className="platform-account-children" aria-label={`${name}账号`}>
                  {accounts.map((account) => { const displayName = account.external_display_name || account.xhs_nickname || account.name; return <button className={`platform-account-nav ${scopeAccountId === account.id ? "active" : ""}`} key={account.id} onClick={() => openAccount(account.id)}><i style={{ background: account.color }}>{displayName.slice(0, 1)}</i><span>{displayName}</span></button>; })}
                  {!accounts.length ? <button className="platform-manage-link" onClick={() => goPlatformView("accounts", platform)}><Plus aria-hidden="true" size={14} />添加{name}账号</button> : null}
                </div>
              </div>
            </div> : null}</div>;
          })}</div>
          <div className="nav-group"><span className="nav-group-label">团队与系统</span>{navItems.map(([id, NavIcon, label]) => { const active = view === id; return <button key={id} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setView(id)}><span><NavIcon aria-hidden="true" size={18} weight={active ? "fill" : "regular"} /></span>{label}</button>; })}</div>
        </nav>
        <div className="sidebar-bottom">{profileMenuOpen ? <div className="profile-menu" role="menu" aria-label="账户菜单"><div><strong>{data.user.name}</strong><small>@{data.user.username}</small></div><button type="button" role="menuitem" onClick={logout}>退出登录</button></div> : null}<div className="profile"><div className="avatar">{data.user.name.slice(0, 1)}</div><div><strong>{data.user.name}</strong><small>{roleLabel(data.user.roles)}</small></div><button type="button" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-haspopup="menu" aria-label={profileMenuOpen ? "收起账户菜单" : "展开账户菜单"} title="账户菜单"><CaretDown className={profileMenuOpen ? "open" : ""} aria-hidden="true" size={17} weight="bold" /></button></div></div>
      </aside>
      <section className={`workspace view-${view}`} id="main-content" tabIndex={-1}>
        {message ? <div className={`toast ${messageHasError ? "bad" : messageHasWarning ? "warn" : ""}`}><span>{message}</span><button onClick={() => setMessage("")}>×</button></div> : null}
        <div className="workspace-content">
          {view === "dashboard" && <Dashboard data={data} setView={setView} openClaim={openDashboardClaim} />}
          {view === "account-workspace" && <AccountWorkspace accountId={selectedAccountId} data={data} setView={setView} openContent={openAccountContent} />}
          <div className="persistent-view" hidden={view !== "trends"} aria-hidden={view !== "trends"}>
            {scopePlatform === "zhihu" ? <ArticleResearch reloadApp={loadData} notify={setMessage} /> : <Trends reloadApp={loadData} notify={setMessage} />}
          </div>
          {view === "topics" && <Topics platform={scopePlatform || "xiaohongshu"} data={scopedData} action={action} busy={busy} />}
          <div className="persistent-view" hidden={view !== "content"} aria-hidden={view !== "content"}>
            <Content key={`${contentAccountId}:${contentTargetId || "content-default"}`} data={scopedData} action={action} busy={busy} reload={loadData} notify={setMessage} targetClaimId={contentTargetId} initialAccountId={contentAccountId} />
          </div>
          {view === "review" && <Review data={scopedData} action={action} busy={busy} />}
          {view === "publish" && (scopePlatform === "wechat" ? <PlatformPublishPlanning platform="wechat" /> : <Publish data={scopePlatform ? scopedData : { ...data, claims: data.claims.filter((claim) => (claim.account_platform || "xiaohongshu") === "xiaohongshu") }} reload={loadData} notify={setMessage} />)}
          {view === "accounts" && <Accounts platform={scopePlatform || "xiaohongshu"} data={scopePlatform ? { ...data, accounts: data.accounts.filter((account) => (account.platform || "xiaohongshu") === scopePlatform) } : data} action={action} busy={busy} reload={loadData} notify={setMessage} />}
          {view === "logs" && <Logs data={data} />}
          {view === "settings" && <Settings data={data} action={action} busy={busy} />}
        </div>
      </section>
    </main>
  );
}

function AccountWorkspace({ accountId, data, setView, openContent }: { accountId: string; data: AppData; setView: (view: string) => void; openContent: (accountId: string, claimId?: string) => void }) {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) return <section className="panel"><Empty title="没有找到这个账号" text="请从左侧平台选择中重新选择账号。" /></section>;
  const platform = account.platform || "xiaohongshu";
  const xhs = platform === "xiaohongshu";
  const name = platformLabel(platform);
  const claims = data.claims.filter((claim) => claim.account_id === account.id);
  const writingCount = claims.filter((claim) => ["writing", "revision"].includes(claim.status)).length;
  const reviewCount = claims.filter((claim) => claim.status === "review").length;
  const publishedCount = claims.filter((claim) => claim.status === "published").length;
  const accountIdentifier = xhs ? (account.xhs_red_id || account.xhs_user_id || account.external_user_id) : account.external_user_id;
  const identifierLabel = xhs ? "小红书号" : platform === "zhihu" ? "知乎账号标识" : "公众号标识";
  return <div className={`account-workspace channel-${platform} page-stack`}>
    <header className="account-workspace-head"><span className="large-avatar" style={{ background: account.color }}>{name.slice(0, 1)}</span><div><span className="section-kicker">{name}账号</span><h1>{account.external_display_name || account.xhs_nickname || account.name}</h1><p>{account.persona || `这个账号尚未设置内容定位。`}</p></div><div className="account-head-actions"><span className={`account-state ${["online", "auth_configured"].includes(account.status) ? "" : "error"}`}><i></i>{accountStatus[account.status] || account.status}</span><button className="outline compact" onClick={() => setView("accounts")}>管理账号资料</button></div></header>
    <section className="account-overview-grid" aria-label="账号资料与内容概览">
      <article className="panel account-profile-card"><div className="panel-head"><div><h2>账号资料</h2><p>当前账号身份与运营定位</p></div></div><dl className="account-profile-list"><div><dt>所属平台</dt><dd>{name}</dd></div><div><dt>{identifierLabel}</dt><dd>{accountIdentifier || "暂未同步"}</dd></div><div><dt>账号简介</dt><dd>{account.profile_bio || "暂未填写"}</dd></div><div><dt>目标受众</dt><dd>{account.audience || "暂未设置"}</dd></div><div><dt>内容方向</dt><dd>{account.content_pillars?.length ? account.content_pillars.join("、") : "暂未设置"}</dd></div></dl></article>
      <article className="panel account-stat-card"><div className="panel-head"><div><h2>内容概览</h2><p>仅统计当前账号</p></div></div><dl className="account-stat-grid"><div><dt>全部内容</dt><dd>{claims.length}</dd></div><div><dt>制作中</dt><dd>{writingCount}</dd></div><div><dt>待审核</dt><dd>{reviewCount}</dd></div><div><dt>已发布</dt><dd>{publishedCount}</dd></div></dl><div className="account-public-stats"><span>粉丝 <strong>{account.followers_count || "—"}</strong></span><span>互动 <strong>{account.interaction_count || "—"}</strong></span><span>内容 <strong>{account.note_count ?? "—"}</strong></span></div></article>
    </section>
    <section className="panel account-content-section"><div className="panel-head"><div><h2>创作内容</h2><p>点击内容进入对应平台的制作页面</p></div><button onClick={() => openContent(account.id)}>查看全部内容</button></div>{claims.length ? <div className="account-content-list">{claims.map((claim) => <button key={claim.id} onClick={() => openContent(account.id, claim.id)}><FileText aria-hidden="true" size={17} /><span><strong>{claim.title || claim.topic_title}</strong><small>{claim.owner_name} · {dateTime(claim.updated_at)}</small></span><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span><ArrowRight aria-hidden="true" size={15} /></button>)}</div> : <Empty title="这个账号还没有内容" text="从左侧选题中心认领任务后，创作内容会显示在这里。" />}</section>
  </div>;
}

function PlatformPublishPlanning({ platform }: { platform: "wechat" }) {
  const name = platformLabel(platform); const glyph = "微";
  return <div className={`zhihu-publish-planning page-stack channel-${platform}`}>
    <section className="planning-hero"><span className="platform-glyph" aria-hidden="true">{glyph}</span><div><span className="section-kicker">{name}发布 · 设计中</span><h1>审核可以继续，正式发布暂不开放</h1><p>{name}和小红书的编辑器、授权方式、成功判定与内容回执不同，因此不会复用小红书 MCP 发布按钮。</p></div><span className="planning-state">尚未开放</span></section>
    <section className="publish-adapter-grid"><article><strong>当前可用</strong><h2>专栏内容制作与团队审核</h2><p>知乎长文可以生成、修改、提交审核并冻结文本快照。</p></article><article><strong>正在设计</strong><h2>知乎独立发布适配器</h2><p>将单独处理知乎授权、专栏编辑器、发布回执和失败恢复。</p></article><article><strong>开放条件</strong><h2>真实账号完整验收</h2><p>只有成功确认、超时核验与重复发布保护全部通过后，页面才会开放发布按钮。</p></article></section>
    <section className="panel adapter-boundary"><div><span className="section-kicker">发布边界</span><h2>两个平台不会共用发布口子</h2></div><div><span><i className="xhs-dot"></i>小红书<strong>MCP 浏览器发布 · 当前可用</strong></span><span><i className="zhihu-dot"></i>知乎<strong>独立适配器 · 设计与验证中</strong></span></div></section>
  </div>;
}

function AuthPage({ mode, onSubmit, busy, message }: { mode: "setup" | "login"; onSubmit: (event: FormEvent<HTMLFormElement>, mode: "setup" | "login") => void; busy: boolean; message: string }) {
  const setup = mode === "setup";
  return <main className="auth-page"><section className="auth-intro"><div className="brand inverse"><span className="brand-mark">红</span><div><strong>红薯台</strong><small>多平台内容运营中台</small></div></div><div><span className="pill">本机部署 · 团队专用</span><h1>把选题、创作、审核和发布，<br />放进一个清晰的工作台。</h1><p>数据留在你的 Mac mini，团队成员使用独立账号协作。</p></div><small>零新增软件费用 · AI 创作图文稿</small></section><section className="auth-form-wrap"><form className="auth-form" onSubmit={(event) => onSubmit(event, mode)}><span className="auth-kicker">{setup ? "首次启动" : "欢迎回来"}</span><h2>{setup ? "创建管理员账号" : "登录团队工作区"}</h2><p>{setup ? "这位管理员可以继续添加成员和分配权限。" : "使用管理员为你创建的用户名和密码。"}</p>{setup ? <label>显示名称<input name="name" required placeholder="请输入管理员显示名称" autoComplete="nickname" /></label> : null}<label>用户名<input name="username" required placeholder="3-24位字母或数字" autoComplete="username" /></label><label>密码<input name="password" required minLength={8} type="password" placeholder="至少8位" autoComplete={setup ? "new-password" : "current-password"} /></label>{message ? <div className="form-error">{message}</div> : null}<button className="primary auth-submit" disabled={busy}>{busy ? "请稍候…" : setup ? "创建并进入平台" : "登录"}</button><small>账号密码仅保存在本机数据库中，不使用第三方平台账号登录。</small></form></section></main>;
}

function Dashboard({ data, setView, openClaim }: { data: AppData; setView: (view: string) => void; openClaim: (claim: Claim) => void }) {
  const reviews = data.claims.filter((claim) => claim.status === "review").length;
  const mine = data.claims.filter((claim) => claim.owner_id === data.user.id && ["writing", "revision"].includes(claim.status)).length;
  const published = data.claims.filter((claim) => claim.status === "published").length;
  const visibleClaims = data.claims.slice(0, 5);
  return <div className="dashboard-layout">
    <section className="dashboard-main">
      <article className="focus-card"><div><span className="pill">今日重点</span><h2>管理多平台内容，稳稳地发出去。</h2><p>{mine ? `你有 ${mine} 篇内容需要继续处理。` : "当前没有待处理草稿，可以从选题中心认领新任务。"}</p><div className="focus-actions"><button className="light-button" onClick={() => setView(mine ? "content" : "topics")}>{mine ? "继续创作" : "寻找选题"} <span aria-hidden="true">›</span></button><span>团队任务 <strong>{data.claims.length}</strong></span></div></div><div className="progress-ring" style={{ "--progress": `${Math.min(100, published * 10)}%` } as CSSProperties}><div><strong>{Math.min(100, published * 10)}%</strong><span>发布进度</span></div></div></article>
      <section className="metrics" aria-label="工作台快捷入口"><Metric icon={Lightbulb} tone="lavender" label="待认领选题" value={data.topics.filter((t) => t.status === "unclaimed").length} note="进入选题中心" onClick={() => setView("topics")} /><Metric icon={PenNib} tone="blue" label="我的创作" value={mine} note="草稿自动保存" onClick={() => setView("content")} /><Metric icon={CheckCircle} tone="amber" label="等待审核" value={reviews} note="需审核员处理" onClick={() => setView("review")} /><Metric icon={PaperPlaneTilt} tone="mint" label="累计已发布" value={published} note="查看发布记录" onClick={() => setView("publish")} /></section>
      <section className="panel task-panel"><div className="panel-head"><div><h2>内容任务</h2><p>团队最近更新的任务</p></div><button onClick={() => setView("content")}>查看全部</button></div>{visibleClaims.length ? <div className="task-list"><div className="task-table-head" aria-hidden="true"><span>任务标题</span><span>负责人</span><span>状态</span><span>更新时间</span></div>{visibleClaims.map((claim) => <button type="button" className="task-row" key={claim.id} onClick={() => openClaim(claim)} aria-label={`打开${claim.title || claim.topic_title}，当前状态${claim.status_label}`}><div className="task-main"><FileText aria-hidden="true" size={16} /><h3>{claim.title || claim.topic_title}</h3></div><span className="task-owner">{claim.owner_name}</span><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span><time>{dateTime(claim.updated_at)}</time></button>)}</div> : <Empty title="还没有内容任务" text="创建选题并认领后，任务会出现在这里。" />}</section>
    </section>
    <aside className="dashboard-rail">
      <article className="alert-card"><div className="alert-head"><span>账号提醒</span><b><Bell aria-hidden="true" size={17} /></b></div><h3>{data.accounts.length ? data.accounts.find((a) => a.status === "login_expired")?.name || "账号运行正常" : "尚未添加账号"}</h3><p>{!data.accounts.length ? "账号中心只展示你实际添加的平台账号。" : data.accounts.some((a) => a.status === "login_expired") ? "登录状态已失效，相关发布任务将保持暂停。" : "所有账号连接状态正常。"}</p><button onClick={() => setView("accounts")}>{data.accounts.length ? "立即处理" : "添加账号"} →</button></article>
      <section className="panel account-panel"><div className="panel-head"><div><h2>平台运行状态</h2><p>{data.accounts.length} 个账号 · 全局并发上限 2</p></div><button onClick={() => setView("accounts")}>管理</button></div><div className="account-list">{data.accounts.length ? data.accounts.slice(0, 4).map((account) => <AccountRow key={account.id} account={account} />) : <div className="account-mini-empty">暂无已接入账号</div>}</div><button className="account-view-all" onClick={() => setView("accounts")}>查看全部</button></section>
    </aside>
  </div>;
}

function ArticleResearch({ reloadApp, notify }: { reloadApp: () => Promise<void>; notify: (message: string) => void }) {
  const articleSites = [
    ["36kr.com", "36氪"], ["huxiu.com", "虎嗅"], ["csdn.net", "CSDN"], ["juejin.cn", "掘金"],
    ["cnblogs.com", "博客园"], ["sspai.com", "少数派"], ["ithome.com", "IT之家"], ["thepaper.cn", "澎湃新闻"],
  ] as const;
  const [data, setData] = useState<ArticleResearchData | null>(null);
  const [keywords, setKeywords] = useState("");
  const [includeDomains, setIncludeDomains] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState("month");
  const [searching, setSearching] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [editing, setEditing] = useState<ArticleSample | null>(null);
  const [topicTitle, setTopicTitle] = useState("");

  function toggleDomain(domain: string, selected: string[], update: (value: string[]) => void) {
    update(selected.includes(domain) ? selected.filter((item) => item !== domain) : [...selected, domain]);
  }

  const load = useCallback(async () => setData(await jsonRequest<ArticleResearchData>("/api/article-research")), []);
  useEffect(() => {
    jsonRequest<ArticleResearchData>("/api/article-research").then((result) => setData(result))
      .catch((error) => notify(error instanceof Error ? error.message : "无法读取文章研究库"));
  }, [notify]);

  async function runSearch() {
    setSearching(true);
    notify("正在搜索文章并抓取正文；文章数量较多时可能需要几分钟");
    try {
      const result = await jsonRequest<{ discovered: number; fetched: number; errors?: string[] }>("/api/article-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "search", keywords, include_domains: includeDomains, time_range: timeRange }) });
      await load();
      notify(`已发现 ${result.discovered} 条搜索结果，新增抓取 ${result.fetched} 篇正文${result.errors?.length ? `；${result.errors.length} 个关键词搜索异常` : ""}`);
    } catch (error) { notify(error instanceof Error ? error.message : "文章搜索失败"); }
    finally { setSearching(false); }
  }

  async function sampleAction(action: "create_topic" | "archive", sample: ArticleSample, title = "") {
    setWorkingId(sample.id);
    try {
      await jsonRequest("/api/article-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, sample_id: sample.id, title }) });
      await Promise.all([load(), reloadApp()]);
      notify(action === "create_topic" ? "文章已转入知乎选题中心，可继续认领、创作、审核和发布" : "文章样本已归档");
      setEditing(null); setTopicTitle("");
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
    finally { setWorkingId(""); }
  }

  if (!data) return <div className="loading-page"><span></span><p>正在读取知乎SEO文章库…</p></div>;
  const visible = data.samples.filter((sample) => sample.status !== "used");
  return <div className="page-stack article-research-page channel-zhihu">
    <section className="article-research-hero">
      <div><span className="pill">知乎 SEO 选题研究</span><h1>输入筛选关键词，搜索并读取外部文章</h1><p>搜索排名负责发现需求，正文抓取负责提供事实素材；转入选题后继续复用现有认领、AI创作、审核与发布流程。</p></div>
      <div className={`research-connection ${data.configured ? "ready" : "warning"}`}><i aria-hidden="true"></i><div><strong>{data.configured ? "文章搜索服务已连接" : "文章搜索服务未连接"}</strong><span>{data.configured ? "可搜索全网文章并抓取正文" : "请检查本机搜索服务"}</span></div></div>
    </section>
    <section className="panel article-search-form">
      <div className="panel-head"><div><h2>文章筛选条件</h2><p>关键词由用户主动输入；逗号或换行分隔，系统不擅自扩词。</p></div></div>
      <div className="article-filter-grid">
        <label className="wide">筛选关键词<textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="例如：AI副业，普通人做自媒体，职场转型" /></label>
        <label>发布时间<select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}><option value="day">最近一天</option><option value="week">最近一周</option><option value="month">最近一个月</option><option value="year">最近一年</option><option value="">不限</option></select></label>
        <div className="domain-filter"><span>文章来源网站</span><details><summary><span>{includeDomains.length ? `已选 ${includeDomains.length} 个网站` : "全网文章"}</span><CaretDown aria-hidden="true" size={14} /></summary><div className="domain-check-panel"><label className="domain-all"><input type="checkbox" checked={!includeDomains.length} onChange={() => setIncludeDomains([])} />不限网站（全网搜索）</label>{articleSites.map(([domain, name]) => <label key={domain} aria-label={`搜索${name}`}><input type="checkbox" checked={includeDomains.includes(domain)} onChange={() => toggleDomain(domain, includeDomains, setIncludeDomains)} /><span><strong>{name}</strong><small>{domain}</small></span></label>)}</div></details></div>
      </div>
      <div className="article-search-actions"><button className="primary" disabled={searching || !keywords.trim()} onClick={runSearch}>{searching ? "正在搜索并抓取正文…" : "开始搜索文章"}</button><small>全网搜索时每个关键词读取前12条；勾选网站后，每个关键词会分别定向搜索各网站。URL自动去重。</small></div>
    </section>
    <section className="panel article-results">
      <div className="panel-head"><div><h2>外部文章研究库</h2><p>{visible.length} 篇待筛选 · 搜索排名、跨关键词命中和正文完整度共同判断</p></div><span className="count-chip">已转选题 {data.samples.filter((sample) => sample.status === "used").length}</span></div>
      {visible.length ? <div className="article-result-list">{visible.map((sample) => <article key={sample.id}>
        <div className="article-score"><strong>{sample.trend_score}</strong><span>趋势分</span></div>
        <div className="article-result-main"><div className="article-result-title"><div><span>{sample.matched_keywords.map((word) => `#${word}`).join(" · ")}</span><h3>{sample.title}</h3></div><em className={sample.processing_status === "success" ? "success" : "failed"}>{sample.processing_status === "success" ? "正文已读取" : "正文失败"}</em></div>
          <div className="article-result-meta"><span>来源 <strong>{sample.source_domain}</strong></span><span>最佳排名 <strong>{sample.best_rank}</strong></span><span>关键词命中 <strong>{sample.occurrence_count}</strong></span><span>相关度 <strong>{sample.relevance_score}</strong></span>{sample.published_at ? <span>发布时间 <strong>{dateOnly(sample.published_at)}</strong></span> : null}<a href={sample.source_url} target="_blank" rel="noreferrer">查看原文 ↗</a></div>
          <p>{sample.snippet || sample.detail_text.slice(0, 260) || sample.detail_error}</p>
          {sample.detail_text ? <details><summary>查看已抓取正文</summary><div>{sample.detail_text}</div></details> : <div className="article-fetch-error">{sample.detail_error || "没有可用正文"}</div>}
        </div>
        <aside><button className="outline" disabled={sample.processing_status !== "success" || workingId === sample.id} onClick={() => { setEditing(sample); setTopicTitle(sample.title); }}>转入选题中心</button><button className="ghost" disabled={workingId === sample.id} onClick={() => sampleAction("archive", sample)}>忽略</button></aside>
      </article>)}</div> : <Empty title="还没有外部文章样本" text="在上方输入一个或多个筛选关键词，系统会搜索文章网站并抓取正文。" />}
    </section>
    {editing ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); sampleAction("create_topic", editing, topicTitle); }}><span className="section-kicker">转入知乎选题</span><h2>确认用于知乎SEO的选题标题</h2><div className="source-sample"><small>外部来源</small><strong>{editing.title}</strong><span>{editing.source_domain} · 搜索最佳排名 {editing.best_rank}</span></div><label>知乎选题标题<input required value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} /></label><p className="modal-help">来源正文会作为不可信参考材料进入AI创作，系统要求重新组织表达，不复制原文。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)}>取消</button><button className="primary" disabled={workingId === editing.id}>转入正式选题库</button></div></form></div> : null}
  </div>;
}

function Trends({ reloadApp, notify }: { reloadApp: () => Promise<void>; notify: (message: string) => void }) {
  const [data, setData] = useState<TrendData | null>(null);
  const [scanning, setScanning] = useState("");
  const [filter, setFilter] = useState("selected");
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmingSampleDelete, setConfirmingSampleDelete] = useState(false);
  const [topicSample, setTopicSample] = useState<TrendSample | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [requestText, setRequestText] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [searchPlan, setSearchPlan] = useState<SearchPlan | null>(null);
  const [planKeywords, setPlanKeywords] = useState("");
  const taskAbortRef = useRef<AbortController | null>(null);
  const activeScanRef = useRef("");
  const [stoppingTask, setStoppingTask] = useState(false);

  const load = useCallback(async () => {
    const result = await jsonRequest("/api/trends") as TrendData;
    setData(result);
    setTargetAccountId((current) => current || result.settings?.target_account_id || result.accounts[0]?.id || "");
  }, []);
  useEffect(() => {
    jsonRequest<TrendData>("/api/trends").then((result) => {
      setData(result);
      setTargetAccountId((current) => current || result.settings?.target_account_id || result.accounts[0]?.id || "");
    })
      .catch((error) => notify(error instanceof Error ? error.message : "无法读取爆款选题库"));
  }, [notify]);

  async function prepareSearchPlan() {
    if (!requestText.trim()) { notify("请先用一句话描述你想找什么选题"); return; }
    if (!targetAccountId) { notify("请先选择这批选题服务的目标内容账号"); return; }
    setScanning("AI 正在生成垂直搜索计划"); notify("");
    try {
      const plan = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plan_request", request_text: requestText, target_account_id: targetAccountId }) }) as SearchPlan;
      setSearchPlan(plan); setPlanKeywords(plan.keywords.join("，"));
    } catch (error) { notify(error instanceof Error ? error.message : "无法生成搜索计划"); }
    finally { setScanning(""); }
  }

  async function startScan() {
    if (!requestText.trim()) { notify("请先用一句话描述你想找什么选题"); return; }
    const controller = new AbortController();
    taskAbortRef.current = controller;
    if (!searchPlan) { notify("请先生成并确认搜索计划"); return; }
    const editableKeywords = planKeywords.split(/[，,\n]/).map((word) => word.trim()).filter(Boolean);
    if (editableKeywords.length < 3 || editableKeywords.length > 6) { notify("搜索计划需要保留3-6个垂直关键词"); return; }
    let stage = "1/5 正在确认垂直搜索计划";
    setScanning(stage); notify("");
    try {
      const plan = searchPlan;
      stage = `2/5 已确认：${plan.intent_summary}，正在分配主账号 MCP`;
      setScanning(stage);
      const begin = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "begin_scan", request_text: requestText, theme: plan.theme, target_account_id: targetAccountId, keywords: editableKeywords, primary_keyword: plan.primary_keyword, intent_phrase: plan.intent_phrase, scenario_terms: plan.scenario_terms, exclude_keywords: plan.exclude_keywords }) });
      activeScanRef.current = String(begin.scan_id || "");
      if (begin.reused) {
        const resumeWarnings: string[] = [];
        const pendingDetailIds = Array.isArray(begin.detail_sample_ids) ? begin.detail_sample_ids as string[] : [];
        for (let index = 0; index < pendingDetailIds.length; index += 1) {
          stage = `4/5 正在补抓上次未完成的正文 ${index + 1}/${pendingDetailIds.length}`; setScanning(stage);
          const enriched = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: begin.scan_id, sample_id: pendingDetailIds[index] }) });
          if (enriched.warning) resumeWarnings.push(enriched.warning);
          await load();
        }
        if (begin.needs_analysis && begin.scan_id) {
          stage = "最后一步：采集与正文读取已完成，AI 正在拆解并生成原创选题（最长约 5 分钟）"; setScanning(stage);
          const resumed = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: begin.scan_id }) });
          await Promise.all([load(), reloadApp()]); notify(`样本拆解完成：${resumed.core_samples ?? 0} 条核心样本；需要时请手动转入选题中心${resumeWarnings.length ? `；${resumeWarnings.join("；")}` : ""}`); return;
        }
        notify(`${begin.message || "已复用现有样本"}${begin.next_allowed_at ? `，下次可更新：${dateTime(begin.next_allowed_at)}` : ""}`); await load(); return;
      }
      const words = begin.keywords as string[];
      const scanWarnings: string[] = [];
      if (begin.recovered_failed_screen) { stage = "已恢复上次保存的候选，正在继续相关度初筛"; setScanning(stage); }
      for (let index = 0; index < words.length; index += 1) {
        stage = `3/5 正在搜索基础样本 ${index + 1}/${words.length}：${words[index]}`; setScanning(stage);
        const scanned = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "scan_keyword", scan_id: begin.scan_id, keyword: words[index] }) });
        if (scanned.warning) scanWarnings.push(`${words[index]}：${scanned.warning}`);
        await load();
      }
      stage = "4/5 基础样本已入库，正在计算热度"; setScanning(stage);
      const finished = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "finish_scan", scan_id: begin.scan_id }) });
      await load();
      const detailSampleIds = Array.isArray(finished.detail_sample_ids) ? finished.detail_sample_ids as string[] : [];
      for (let index = 0; index < detailSampleIds.length; index += 1) {
        stage = `4/5 已从 ${finished.candidate_count || 0} 条候选选出 ${finished.selected_count || detailSampleIds.length} 条，正在补充详情 ${index + 1}/${detailSampleIds.length}`; setScanning(stage);
        const enriched = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: begin.scan_id, sample_id: detailSampleIds[index] }) });
        if (enriched.warning) scanWarnings.push(enriched.warning);
        await load();
      }
      stage = "最后一步：采集与正文读取已完成，AI 正在聚类、拆解爆点并生成原创选题（最长约 5 分钟）"; setScanning(stage);
      const analysis = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: begin.scan_id }) });
      await Promise.all([load(), reloadApp()]);
      notify(`抓取与拆解完成：${analysis.core_samples ?? 0} 条核心样本；系统未写入选题中心，请人工选择后转入${scanWarnings.length ? `。补充说明：${scanWarnings.join("；")}` : ""}`);
    } catch (error) { if (!controller.signal.aborted) notify(`${stage}失败：${error instanceof Error ? error.message : "采集任务中断"}`); await load().catch(() => undefined); }
    finally { if (taskAbortRef.current === controller) taskAbortRef.current = null; activeScanRef.current = ""; setScanning(""); }
  }

  async function resumePendingDetails() {
    if (!window.confirm("将使用主采集账号补抓所有待处理正文，并在完成后运行 AI 拆解。任务可能需要几分钟，切换到其他页面后仍会继续。是否开始？")) return;
    const controller = new AbortController();
    taskAbortRef.current = controller;
    let stage = "正在读取待补抓样本";
    setScanning(stage); notify("");
    try {
      const resume = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "resume_details", confirmed: true, origin: "manual_backfill_button" }) });
      activeScanRef.current = String(resume.scan_id || "");
      const ids = Array.isArray(resume.detail_sample_ids) ? resume.detail_sample_ids as string[] : [];
      if (!ids.length) { notify("当前没有等待补抓的入选样本"); await load(); return; }
      const warnings: string[] = [];
      for (let index = 0; index < ids.length; index += 1) {
        stage = `正在补抓正文 ${index + 1}/${ids.length}`; setScanning(stage);
        const result = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: resume.scan_id, sample_id: ids[index] }) });
        if (result.warning) warnings.push(result.warning);
        await load();
      }
      stage = "正文补抓已完成，AI 正在生成完整爆款档案（最长约 5 分钟）"; setScanning(stage);
      const analysis = await jsonRequest<TrendActionResult>("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: resume.scan_id }) });
      await Promise.all([load(), reloadApp()]);
      notify(`正文补抓与拆解完成，共 ${analysis.core_samples ?? 0} 条核心样本；请人工选择后转入选题中心${warnings.length ? `；${warnings.length} 条正文仍需稍后重试` : ""}`);
    } catch (error) { if (!controller.signal.aborted) notify(`${stage}失败：${error instanceof Error ? error.message : "任务中断"}`); await load().catch(() => undefined); }
    finally { if (taskAbortRef.current === controller) taskAbortRef.current = null; activeScanRef.current = ""; setScanning(""); }
  }

  async function stopTrendTask() {
    if (!scanning || stoppingTask) return;
    setStoppingTask(true);
    const scanId = activeScanRef.current;
    taskAbortRef.current?.abort();
    try {
      await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel_scan", scan_id: scanId }) });
      notify("爆款研究任务已停止，未完成正文已恢复为可重试状态");
    } catch (error) { notify(error instanceof Error ? error.message : "停止任务失败"); }
    finally { activeScanRef.current = ""; setScanning(""); setStoppingTask(false); await load().catch(() => undefined); }
  }

  async function sampleAction(action: "archive_sample" | "create_topic", sample: TrendSample, title = "") {
    try {
      await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, sample_id: sample.id, title }) });
      await Promise.all([load(), reloadApp()]);
      notify(action === "create_topic" ? "原创选题已加入正式选题库" : "样本已归档");
      if (action === "archive_sample") setSelectedSamples((current) => current.filter((id) => id !== sample.id));
      setTopicSample(null); setTopicTitle("");
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
  }

  async function createTopicsInBatch() {
    const sampleIds = selectedSamples.filter((id) => data?.samples.some((sample) => sample.id === id && canTransferSample(sample)));
    if (!sampleIds.length) return;
    setBatchBusy(true);
    try {
      const result = await jsonRequest("/api/trends", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_topics_bulk", sample_ids: sampleIds }),
      }) as { created: number; skipped: number };
      await Promise.all([load(), reloadApp()]);
      setSelectedSamples([]);
      notify(`已批量加入 ${result.created} 个选题${result.skipped ? `，跳过 ${result.skipped} 个已处理样本` : ""}`);
    } catch (error) { notify(error instanceof Error ? error.message : "批量转入失败"); }
    finally { setBatchBusy(false); }
  }

  async function deleteSamplesInBatch() {
    if (!selectedSamples.length) return;
    setConfirmingSampleDelete(false);
    setBatchBusy(true);
    try {
      const result = await jsonRequest("/api/trends", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive_samples_bulk", sample_ids: selectedSamples }),
      }) as { archived: number };
      await Promise.all([load(), reloadApp()]);
      setSelectedSamples([]);
      notify(`已从样本库删除 ${result.archived} 条记录，正式选题不受影响`);
    } catch (error) { notify(error instanceof Error ? error.message : "批量删除失败"); }
    finally { setBatchBusy(false); }
  }

  if (!data) return <section className="panel"><Empty title="正在读取高表现样本" text="首次进入会初始化本机选题采集设置。" /></section>;
  const selectedAccount = data.accounts.find((account) => account.id === data.settings?.account_id);
  const canTransferSample = (sample: TrendSample) => sample.status === "new" && sample.selection_status === "selected" && ["core", "unrated"].includes(sample.quality_tier) && sample.processing_status === "success" && Boolean(sample.detail_text && sample.content_summary);
  const visible = data.samples.filter((sample) => {
    if (sample.status === "archived") return false;
    if (filter === "selected") return sample.selection_status === "selected" && sample.status === "new";
    if (filter === "signal") return sample.quality_tier === "signal";
    if (filter === "processing") return ["pending", "detail_fetching"].includes(sample.processing_status);
    if (filter === "exceptions") return ["detail_failed", "skipped"].includes(sample.processing_status) || sample.quality_tier === "excluded";
    if (filter === "used") return sample.status === "used";
    return true;
  });
  const selectable = visible;
  const transferableCount = selectedSamples.filter((id) => data.samples.some((sample) => sample.id === id && canTransferSample(sample))).length;
  const alreadyTransferredCount = selectedSamples.filter((id) => data.samples.some((sample) => sample.id === id && sample.status === "used")).length;
  const unavailableTransferCount = Math.max(0, selectedSamples.length - transferableCount - alreadyTransferredCount);
  const allVisibleSelected = Boolean(selectable.length) && selectable.every((sample) => selectedSamples.includes(sample.id));
  const detailedCount = data.samples.filter((sample) => sample.detail_text).length;
  const analyzedCount = data.samples.filter((sample) => sample.content_summary).length;
  const pendingSelectedCount = data.samples.filter((sample) => sample.selection_status === "selected" && ["pending", "detail_failed"].includes(sample.processing_status) && !sample.detail_text).length;
  const isDetailBackfill = Boolean(scanning && (scanning.includes("补抓") || scanning.includes("爆款档案")));
  return <div className="page-stack trend-page">
    <section className="trend-hero"><div className="trend-command-copy"><span className="pill">爆款研究任务</span><h2>先对准账号，再找真正可写的内容。</h2><p>系统先生成可检查的垂直关键词计划，再按相关度筛标题、按正文信息密度分层，热度不再是唯一依据。</p><div className="trend-target-row"><label>目标内容账号<select value={targetAccountId} disabled={Boolean(scanning)} onChange={(event) => { setTargetAccountId(event.target.value); setSearchPlan(null); }}>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.xhs_nickname || account.name}</option>)}</select></label><span>采集账号：{selectedAccount?.xhs_nickname || selectedAccount?.name || "未设置"}</span></div><div className="trend-command"><input value={requestText} onChange={(event) => { setRequestText(event.target.value); setSearchPlan(null); }} aria-describedby="trend-submit-hint" placeholder="例如：最近一周帮助中小团队提升内容效率的AI图文" /><button className="light-button" disabled={Boolean(scanning) || !data.settings?.account_id || !targetAccountId || !requestText.trim()} onClick={prepareSearchPlan}>{scanning ? "处理中…" : searchPlan ? "重新生成计划" : "生成搜索计划"}</button>{searchPlan ? <button className="light-button confirm-plan-button" disabled={Boolean(scanning)} onClick={startScan}>确认并开始采集</button> : null}{scanning ? <button className="stop-task-button" disabled={stoppingTask} onClick={stopTrendTask}>{stoppingTask ? "正在停止…" : "停止任务"}</button> : null}</div>{searchPlan ? <div className="search-plan-card"><div><strong>{searchPlan.intent_summary}</strong><span>主词：{searchPlan.primary_keyword} · 用户意图：{searchPlan.intent_phrase}</span></div><label>可编辑搜索词<input value={planKeywords} onChange={(event) => setPlanKeywords(event.target.value)} /></label><small>场景词：{searchPlan.scenario_terms.join("、") || "无"} · 排除：{searchPlan.exclude_keywords.join("、") || "无"}</small></div> : null}<small id="trend-submit-hint" className="trend-submit-hint">只有点击“确认并开始采集”才会调用 MCP；切换平台页面不会停止已经开始的任务。</small>{scanning ? <div className="workflow-progress"><i></i><span>{isDetailBackfill ? `后台补抓任务：${scanning}` : scanning}</span></div> : null}</div><div className="trend-hero-action"><small>{targetAccountId ? `服务账号：${data.accounts.find((account) => account.id === targetAccountId)?.xhs_nickname || data.accounts.find((account) => account.id === targetAccountId)?.name}` : "尚未选择目标账号"}</small><div className="trend-research-stats"><span><strong>{data.samples.length}</strong><small>真实样本</small></span><span><strong>{detailedCount}</strong><small>已读正文</small></span><span><strong>{analyzedCount}</strong><small>已完成拆解</small></span></div>{data.settings?.last_scanned_at ? <time>上次更新 {dateTime(data.settings.last_scanned_at)}</time> : <time>尚未完成首次研究</time>}</div></section>
    <section className="panel trend-library">
      <div className="panel-head"><div><h2>爆款笔记研究库</h2><p>{data.samples.length} 条真实候选 · 相关度优先 · 正文质量分层 · 笔记 ID 自动去重</p></div><div className="sample-tabs">{pendingSelectedCount ? <button className="retry-details" disabled={Boolean(scanning)} onClick={resumePendingDetails}>补抓正文 {pendingSelectedCount}</button> : null}<button className={filter === "selected" ? "active" : ""} onClick={() => { setFilter("selected"); setSelectedSamples([]); }}>核心样本 {data.samples.filter((item) => item.selection_status === "selected" && item.status === "new").length}</button><button className={filter === "signal" ? "active" : ""} onClick={() => { setFilter("signal"); setSelectedSamples([]); }}>趋势信号 {data.samples.filter((item) => item.quality_tier === "signal").length}</button><button className={filter === "processing" ? "active" : ""} onClick={() => { setFilter("processing"); setSelectedSamples([]); }}>处理中</button><button className={filter === "exceptions" ? "active" : ""} onClick={() => { setFilter("exceptions"); setSelectedSamples([]); }}>失败/排除</button><button className={filter === "used" ? "active" : ""} onClick={() => { setFilter("used"); setSelectedSamples([]); }}>已转选题 {data.samples.filter((item) => item.status === "used").length}</button><button className={filter === "all" ? "active" : ""} onClick={() => { setFilter("all"); setSelectedSamples([]); }}>全部</button></div></div>
      {selectable.length ? <div className="sample-batch-bar">
        <label><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedSamples(allVisibleSelected ? selectedSamples.filter((id) => !selectable.some((sample) => sample.id === id)) : Array.from(new Set([...selectedSamples, ...selectable.map((sample) => sample.id)])))} />全选当前列表</label>
        <span>已选择 {selectedSamples.length} 条 · 可转入 {transferableCount} 条{alreadyTransferredCount ? ` · 已转入 ${alreadyTransferredCount} 条` : ""}{unavailableTransferCount ? ` · 暂不可转 ${unavailableTransferCount} 条` : ""}</span>
        <button className="ghost" disabled={!selectedSamples.length || batchBusy} onClick={() => setSelectedSamples([])}>清空</button>
        <button type="button" className="danger-outline" disabled={!selectedSamples.length || batchBusy} onClick={() => setConfirmingSampleDelete(true)}>{batchBusy ? "正在处理…" : `批量删除${selectedSamples.length ? `（${selectedSamples.length}）` : ""}`}</button>
        <button className="primary" disabled={!transferableCount || batchBusy} onClick={createTopicsInBatch}>{batchBusy ? "正在处理…" : `批量转入选题中心（可转 ${transferableCount}）`}</button>
      </div> : null}
      {confirmingSampleDelete ? <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="sample-delete-title"><span className="section-kicker">批量删除</span><h2 id="sample-delete-title">删除已选择的 {selectedSamples.length} 条样本？</h2><p className="modal-help">记录会从爆款样本库归档；已经转入选题中心的选题不会被删除。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setConfirmingSampleDelete(false)}>取消</button><button type="button" className="danger-confirm" disabled={batchBusy} onClick={deleteSamplesInBatch}>{batchBusy ? "正在删除…" : "确认删除"}</button></div></section></div> : null}
      {visible.length ? <div className="sample-research-list">{visible.map((sample) => <article className={`sample-research-row ${selectedSamples.includes(sample.id) ? "selected" : ""}`} key={sample.id}>
        <label className="research-selector" aria-label={`选择 ${sample.title}`}><input type="checkbox" checked={selectedSamples.includes(sample.id)} onChange={() => setSelectedSamples((current) => current.includes(sample.id) ? current.filter((id) => id !== sample.id) : [...current, sample.id])} /></label>
        <div className="research-score"><strong>{sample.heat_score || "--"}</strong><span>热度</span></div>
        <div className="research-main">
          <div className="research-title"><div><span>{sample.matched_keywords.length ? sample.matched_keywords.map((word) => `#${word}`).join(" · ") : `#${sample.keyword}`}</span><h3>{sample.title}</h3></div><div className="research-state-stack"><span className={`research-state ${sample.quality_tier === "core" ? "ready" : "pending"}`}>{sample.quality_tier === "core" ? "核心样本" : sample.quality_tier === "signal" ? "趋势信号" : sample.quality_tier === "excluded" ? "已排除" : sampleProcessingStatus[sample.processing_status] || sample.processing_status}</span><small>{sampleCaptureOutcome[sample.capture_outcome] || sample.capture_outcome} · 预筛 {sample.prefilter_score || 0} · 终评 {sample.final_quality_score || 0}</small></div></div>
          <div className="research-source"><span>作者 <strong>{sample.author_name || "未知"}</strong></span><span>笔记ID <strong>{sample.feed_id}</strong></span><span>发布时间 <strong>{sample.published_at ? dateOnly(sample.published_at) : "详情未提供"}</strong></span><span>抓取时间 <strong>{dateTime(sample.last_seen_at)}</strong></span>{sample.original_tags.length ? <span>标签 <strong>{sample.original_tags.map((tag) => `#${tag}`).join(" ")}</strong></span> : null}<a href={sample.source_url} target="_blank" rel="noreferrer">查看原文链接</a></div>
          <div className="research-insight"><div><span>内容摘要</span><p>{sample.processing_status === "success" ? sample.content_summary || "正文已读取，等待AI完成摘要与拆解。" : "正文尚未获取成功，只保留标题、作者和真实互动数据；旧AI推断已隐藏。"}</p></div><div><span>爆点拆解</span>{sample.processing_status === "success" && sample.sample_hooks.length ? <ul>{sample.sample_hooks.map((hook) => <li key={hook}>{hook}</li>)}</ul> : <p>{sample.processing_status === "success" ? "等待AI拆解" : "正文成功后才会拆解"}</p>}</div></div>
          {sample.processing_status === "success" ? <details className="research-details"><summary>展开完整爆款档案</summary><div><section><span>标题钩子</span><p>{sample.title_hook || "等待拆解"}</p></section><section><span>视觉亮点</span><p>{sample.visual_highlight || (sample.cover_url ? "已保留封面依据，等待分析" : "未获取封面视觉内容，无法判断")}</p></section><section><span>情绪或痛点</span><p>{sample.emotion_pain || sample.sample_pain_point || "等待拆解"}</p></section><section><span>实用价值</span><p>{sample.practical_value || "等待拆解"}</p></section><section><span>争议与互动点</span><p>{sample.controversy_point || "等待拆解"}</p></section><section><span>内容结构</span><p>{sample.sample_structure.length ? sample.sample_structure.join(" → ") : "等待拆解"}</p></section><section><span>可复用选题方向</span><p>{sample.reusable_directions.length ? sample.reusable_directions.join(" · ") : "等待拆解"}</p></section><section><span>适合自身账号的原创转化</span><p>{sample.account_adaptation || "等待拆解"}</p></section><section><span>综合判断</span><p>{sample.selection_reason || "等待相关度与二创价值判断"}</p><small>相关 {sample.relevance_score || 0} · 意图 {sample.intent_match_score || 0} · 账号匹配 {sample.account_fit_score || 0} · 信息 {sample.information_density_score || 0} · 证据 {sample.visible_proof_score || 0} · 可复现 {sample.reproducibility_score || 0} · 二创 {sample.remix_value_score || 0}</small></section><section className="research-original"><span>原帖正文</span><p>{sample.detail_text}</p></section></div></details> : <div className="research-detail-blocked"><strong>完整爆款档案尚未生成</strong><span>{sample.detail_error || "正文等待补抓，成功后才会显示摘要、钩子、痛点和原创方向。"}</span></div>}
        </div>
        <aside className="research-side"><div><span>点赞<strong>{sample.liked_count}</strong></span><span>收藏<strong>{sample.collected_count}</strong></span><span>评论<strong>{sample.comment_count}</strong></span><span>分享<strong>{sample.shared_count || "未提供"}</strong></span><span>原始热度<strong>{Math.round(sample.raw_heat_score || 0)}</strong></span><span>标准分<strong>{sample.heat_score || "--"}</strong></span></div><button className="outline" disabled={sample.status === "used" || sample.selection_status !== "selected" || sample.processing_status !== "success" || !sample.detail_text || !sample.content_summary} onClick={() => { setTopicSample(sample); setTopicTitle(""); }}>{sample.status === "used" ? "已转入" : sample.selection_status !== "selected" ? "候选未入选" : sample.processing_status !== "success" || !sample.detail_text ? "正文成功后可转入" : !sample.content_summary ? "等待爆点拆解" : "转入选题中心"}</button><button className="ghost" onClick={() => sampleAction("archive_sample", sample)}>忽略</button></aside>
      </article>)}</div> : <Empty title={data.samples.length ? "这个分类暂无样本" : "还没有研究样本"} text={data.samples.length ? "可以切换上方分类查看其他样本。" : "在上方输入研究需求，系统会搜索并拆解重点帖子。"} />}
    </section>
    {topicSample ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); sampleAction("create_topic", topicSample, topicTitle); }}><span className="section-kicker">从样本加入选题</span><h2>直接加入，或修改标题</h2><div className="source-sample"><small>参考样本</small><strong>{topicSample.title}</strong><span>#{topicSample.keyword} · 赞 {topicSample.liked_count} · 藏 {topicSample.collected_count}</span></div><label>选题标题（选填）<input value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="不填写则使用样本标题" /></label><p className="modal-help">留空会使用上方样本标题；填写后则使用你的新标题。选题仍会保留原帖链接和来源记录。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setTopicSample(null)}>取消</button><button className="primary">加入正式选题库</button></div></form></div> : null}
  </div>;
}

function Topics({ platform, data, action, busy }: { platform: PlatformId; data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [claiming, setClaiming] = useState<Topic | null>(null);
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [angle, setAngle] = useState("");
  const [topicFilter, setTopicFilter] = useState("unclaimed");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [confirmingTopicDelete, setConfirmingTopicDelete] = useState(false);
  const canOperate = data.user.roles.some((role) => ["admin", "operator"].includes(role));
  const topicGroups = [
    { id: "all", label: "全部", matches: () => true },
    { id: "unclaimed", label: "待认领", matches: (topic: Topic) => !topic.claim_status },
    { id: "creating", label: "创作中", matches: (topic: Topic) => ["writing", "revision"].includes(topic.claim_status || "") },
    { id: "review", label: "待审核", matches: (topic: Topic) => topic.claim_status === "review" },
    { id: "publishing", label: "待发布", matches: (topic: Topic) => ["approved", "queued", "publishing", "failed"].includes(topic.claim_status || "") },
    { id: "published", label: "已发布", matches: (topic: Topic) => topic.claim_status === "published" },
  ];
  const activeGroup = topicGroups.find((group) => group.id === topicFilter) || topicGroups[0];
  const visibleTopics = data.topics.filter(activeGroup.matches);
  const allVisibleTopicsSelected = Boolean(visibleTopics.length) && visibleTopics.every((topic) => selectedTopics.includes(topic.id));
  const isZhihu = platform === "zhihu";
  const topicCopy = platform === "zhihu" ? {
    glyph: "知", kicker: "知乎选题中心 · 专栏 V1", headline: "沉淀适合知乎长文表达的专栏选题", intro: "当前先支持人工建立专栏选题，后续知乎问题池会使用独立数据来源接入。", state: "人工选题阶段", newKicker: "新建知乎专栏选题", newTitle: "记录一个值得完整回答的主题", titlePlaceholder: "输入专栏文章主题", urlPlaceholder: "知乎问题或参考资料链接（选填）", addLabel: "添加知乎选题", libraryTitle: "知乎专栏选题库", libraryDesc: "管理专栏主题、认领人和内容生产状态，不混入小红书样本数据", itemLabel: "知乎专栏选题", sourceLabel: "参考资料", sourceName: "知乎数据源", summaryFallback: "人工添加的知乎专栏主题，等待认领后形成长文结构。", directionFallback: "认领时补充文章切入角度", footer: "知乎问题池将在后续版本接入", emptyName: "知乎", emptyText: "先在上方添加知乎专栏主题；知乎问题池会在独立数据源接入后开放。",
  } : platform === "wechat" ? {
    glyph: "微", kicker: "公众号选题中心 · 图文文章", headline: "沉淀适合微信公众号持续运营的文章选题", intro: "当前支持人工建立公众号选题，并与小红书、知乎的数据和账号完全分开。", state: "平台框架已接入", newKicker: "新建公众号文章选题", newTitle: "记录一个适合公众号展开的主题", titlePlaceholder: "输入公众号文章主题", urlPlaceholder: "参考文章或资料链接（选填）", addLabel: "添加公众号选题", libraryTitle: "公众号文章选题库", libraryDesc: "管理公众号主题、认领人和内容生产状态，不混入其他平台数据", itemLabel: "公众号文章选题", sourceLabel: "参考资料", sourceName: "公众号数据源", summaryFallback: "人工添加的公众号文章主题，等待认领后形成文章结构。", directionFallback: "认领时补充文章切入角度", footer: "公众号数据源将在后续版本接入", emptyName: "公众号", emptyText: "先在上方添加公众号文章主题；自动选题数据源后续独立接入。",
  } : {
    glyph: "小", kicker: "小红书选题中心 · 图文笔记", headline: "从真实爆款样本沉淀小红书图文选题", intro: "选题来自小红书爆款搜索、正文拆解或人工补充，并保留真实笔记依据。", state: "爆款搜索已接入", newKicker: "补充小红书选题", newTitle: "把一个想法加入小红书选题池", titlePlaceholder: "输入小红书图文选题", urlPlaceholder: "小红书笔记或参考链接（选填）", addLabel: "添加小红书选题", libraryTitle: "小红书图文选题库", libraryDesc: "保留真实笔记来源、互动数据、爆点拆解和认领记录", itemLabel: "小红书图文选题", sourceLabel: "笔记链接", sourceName: "爆款搜索", summaryFallback: "人工添加的小红书选题，暂无自动摘要。", directionFallback: "暂无自动拆解", footer: "", emptyName: "小红书", emptyText: "先去爆款搜索页采集和拆解样本，再人工选择或批量转入选题中心。",
  };

  function toggleTopic(topicId: string) {
    setSelectedTopics((current) => current.includes(topicId) ? current.filter((id) => id !== topicId) : [...current, topicId]);
  }

  function archiveSelectedTopics() {
    if (!selectedTopics.length) return;
    setConfirmingTopicDelete(false);
    action({ action: "archive_topics_bulk", topic_ids: selectedTopics }, `已从选题中心删除 ${selectedTopics.length} 个选题，相关内容任务和历史记录已保留`);
    setSelectedTopics([]);
  }

  return <div className={`page-stack platform-topic-page channel-${platform}`}>
    <header className="platform-topic-head"><span className="platform-glyph" aria-hidden="true">{topicCopy.glyph}</span><div><span className="section-kicker">{topicCopy.kicker}</span><h1>{topicCopy.headline}</h1><p>{topicCopy.intro}</p></div><span className="platform-topic-state">{topicCopy.state}</span></header>
    {canOperate ? <section className="panel creation-strip"><div><span className="section-kicker">{topicCopy.newKicker}</span><h2>{topicCopy.newTitle}</h2></div><form onSubmit={(e) => { e.preventDefault(); action({ action: "create_topic", title, source_url: url, relevance: "中", platform, source_type: "manual" }, `${platformLabel(platform)}选题已创建`); setTitle(""); setUrl(""); }}><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={topicCopy.titlePlaceholder} /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={topicCopy.urlPlaceholder} /><button className="primary" disabled={busy}>{topicCopy.addLabel}</button></form></section> : null}
    <section className="panel data-panel">
      <div className="panel-head"><div><h2>{topicCopy.libraryTitle}</h2><p>{topicCopy.libraryDesc}</p></div><span className="count-chip">{visibleTopics.length} / {data.topics.length} 个选题</span></div>
      <div className="topic-status-tabs" aria-label="按选题状态筛选">{topicGroups.map((group) => { const count = data.topics.filter(group.matches).length; return <button key={group.id} className={topicFilter === group.id ? "active" : ""} onClick={() => setTopicFilter(group.id)}>{group.label}<span>{count}</span></button>; })}</div>
      {canOperate && visibleTopics.length ? <div className="topic-batch-bar"><label><input type="checkbox" checked={allVisibleTopicsSelected} onChange={() => setSelectedTopics(allVisibleTopicsSelected ? selectedTopics.filter((id) => !visibleTopics.some((topic) => topic.id === id)) : Array.from(new Set([...selectedTopics, ...visibleTopics.map((topic) => topic.id)])))} />全选当前分类</label><span>已选择 {selectedTopics.length} 个选题</span><button className="ghost" disabled={!selectedTopics.length || busy} onClick={() => setSelectedTopics([])}>清空</button><button type="button" className="danger-outline" disabled={!selectedTopics.length || busy} onClick={() => setConfirmingTopicDelete(true)}>{busy ? "正在处理…" : `批量删除${selectedTopics.length ? `（${selectedTopics.length}）` : ""}`}</button></div> : null}
      {visibleTopics.length ? <div className="data-list topic-cards">{visibleTopics.map((topic) => <article className={`topic-row ${topic.brief ? "analyzed" : ""} ${selectedTopics.includes(topic.id) ? "selected" : ""}`} key={topic.id}>
        <label className="topic-selector" aria-label={`选择 ${topic.title}`}><input type="checkbox" checked={selectedTopics.includes(topic.id)} onChange={() => toggleTopic(topic.id)} /></label>
        <div className="topic-index">{topic.heat_score || topic.score || topic.title.slice(0, 1)}</div>
        <div className="topic-info"><div className="topic-title-line"><div><span>{topicCopy.itemLabel}</span><h3>{topic.title}</h3></div><span className={`soft-badge ${topic.status}`}>{topic.note_id && !topic.source_detail_verified ? "来源正文未验证" : topic.claim_status ? claimStatus[topic.claim_status] || topic.claim_status : "待认领"}</span></div><div className="topic-source-grid"><div><span>{topicCopy.sourceLabel}</span>{topic.source_url ? <a href={topic.source_url} target="_blank" rel="noreferrer">打开来源 ↗</a> : <strong>人工选题</strong>}</div><div><span>来源方式</span><strong>{topic.source_type === "manual" ? "手动创建" : topic.source_keyword || topicCopy.sourceName}</strong></div><div><span>状态</span><strong>{topic.note_id && !topic.source_detail_verified ? "不可认领" : topic.claim_status ? claimStatus[topic.claim_status] || topic.claim_status : "待认领"}</strong></div><div><span>认领人</span><strong>{topic.claim_owner_name || "未认领"}</strong></div></div><div className="topic-breakdown"><div className="topic-summary"><span>{isZhihu ? "主题说明" : "内容摘要"}</span><p>{topic.note_id && !topic.source_detail_verified ? "该选题由旧逻辑在正文获取失败时生成，拆解内容仅供排查，不应作为创作依据。" : topic.brief || topicCopy.summaryFallback}</p></div><div className="topic-hooks"><span>{isZhihu ? "论述方向" : "创作方向"}</span><p>{topic.note_id && !topic.source_detail_verified ? "等待来源正文验证" : topic.hook_points?.length ? topic.hook_points.join(" · ") : topicCopy.directionFallback}</p></div>{topic.brief && (!topic.note_id || Boolean(topic.source_detail_verified)) ? <dl><div><dt>目标用户</dt><dd>{topic.target_audience}</dd></div><div><dt>核心痛点</dt><dd>{topic.pain_point}</dd></div><div><dt>内容结构</dt><dd>{topic.content_structure?.join(" → ")}</dd></div><div><dt>账号匹配</dt><dd>{topic.account_fit}</dd></div></dl> : null}<small>创建人 {topic.creator_name} · {topicCopy.footer || `参考 ${topic.source_feed_ids?.length || (topic.note_id ? 1 : 0)} 条真实样本`}</small></div></div>
        {canOperate ? <button className="outline topic-claim-button" disabled={!data.accounts.some((account) => (account.platform || "xiaohongshu") === (topic.platform || "xiaohongshu")) || Boolean(topic.note_id && !topic.source_detail_verified)} onClick={() => { setAccountId(data.accounts.find((account) => (account.platform || "xiaohongshu") === (topic.platform || "xiaohongshu"))?.id || ""); setClaiming(topic); }}>{topic.note_id && !topic.source_detail_verified ? "等待正文验证" : topic.claim_status ? "再次认领" : "认领创作"}</button> : null}
      </article>)}</div> : <Empty title={`${activeGroup.label}分类暂无${topicCopy.emptyName}选题`} text={data.topics.length ? "可以切换上方状态查看其他选题。" : topicCopy.emptyText} />}
    </section>
    {confirmingTopicDelete ? <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="topic-delete-title"><span className="section-kicker">批量删除</span><h2 id="topic-delete-title">删除已选择的 {selectedTopics.length} 个选题？</h2><p className="modal-help">选题会从选题中心归档；已有的认领、创作、审核和发布记录会继续保留。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setConfirmingTopicDelete(false)}>取消</button><button type="button" className="danger-confirm" disabled={busy} onClick={archiveSelectedTopics}>{busy ? "正在删除…" : "确认删除"}</button></div></section></div> : null}
    {claiming ? <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); action({ action: "claim_topic", topic_id: claiming.id, account_id: accountId, angle }, `已由 ${data.user.name} 认领，进入团队内容`); setClaiming(null); }}><span className="section-kicker">认领创作 · {platformLabel(claiming.platform)}</span><h2>{claiming.title}</h2>{claiming.brief ? <div className="source-sample"><small>选题拆解</small><strong>{claiming.brief}</strong><span>{claiming.hook_points?.join(" · ")}</span></div> : null}<div className="claim-worker-note"><span>认领工作人员</span><strong>{data.user.name}</strong><small>@{data.user.username} · {roleLabel(data.user.roles)}</small></div><label>发布账号<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{data.accounts.filter((account) => (account.platform || "xiaohongshu") === (claiming.platform || "xiaohongshu")).map((account) => <option key={account.id} value={account.id}>{account.name} · {accountStatus[account.status]}</option>)}</select></label><label>创作角度<textarea value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={claiming.pain_point || "例如：从具体问题和可验证经验切入"} /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setClaiming(null)}>取消</button><button className="primary" disabled={busy || !data.accounts.some((account) => (account.platform || "xiaohongshu") === (claiming.platform || "xiaohongshu") && account.id === accountId)}>确认由我认领</button></div></form></div> : null}
  </div>;
}

function Content({ data, action, busy, reload, notify, targetClaimId, initialAccountId }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean; reload: () => Promise<void>; notify: (message: string) => void; targetClaimId: string; initialAccountId?: string }) {
  const teamClaims = data.claims;
  const initialTarget = teamClaims.find((claim) => claim.id === targetClaimId);
  const [selectedAccountId, setSelectedAccountId] = useState(initialTarget?.account_id ?? initialAccountId ?? "");
  const accountClaims = selectedAccountId ? teamClaims.filter((claim) => claim.account_id === selectedAccountId) : [];
  const [selectedId, setSelectedId] = useState(initialTarget?.id ?? "");
  const [contentLevel, setContentLevel] = useState<"accounts" | "list" | "editor">(initialTarget ? "editor" : initialAccountId ? "list" : "accounts");
  const selected = accountClaims.find((claim) => claim.id === selectedId);
  const [creative, setCreative] = useState<CreativeDraft>(() => blankCreative(selected));
  const [instruction, setInstruction] = useState("");
  const [creating, setCreating] = useState(false);
  const [creationSeconds, setCreationSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [versions, setVersions] = useState<CreativeVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const canOperate = data.user.roles.some((role) => ["admin", "operator"].includes(role));
  const editable = Boolean(canOperate && selected && ["writing", "revision"].includes(selected.status));
  useEffect(() => {
    if (!creating) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setCreationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [creating]);

  function selectTask(claim: Claim) {
    setSelectedId(claim.id);
    setCreative(blankCreative(claim));
    setVersions([]);
    setShowVersions(false);
    setContentLevel("editor");
  }

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    setSelectedId("");
    setCreative(blankCreative());
    setVersions([]);
    setShowVersions(false);
    setContentLevel("list");
  }

  async function creationRequest(payload: Record<string, unknown>, success: string) {
    const result = await jsonRequest("/api/creation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected?.id, ...payload }),
    }) as { creative: CreativeDraft; version: number };
    setCreative(result.creative);
    await reload();
    notify(success + "，当前为 v" + result.version);
    return result;
  }

  async function generate() {
    if (!selected || !editable) return;
    setCreationSeconds(0);
    setCreating(true);
    notify("AI 正在创作标题、正文和整篇配图提示词；切换功能页也不会中断");
    try {
      await creationRequest({ action: "generate", instruction }, "图文稿和配图提示词已生成");
      setInstruction("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI 创作失败");
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!selected || !editable) return false;
    setSaving(true);
    try {
      await creationRequest({ action: "save", creative }, "图文稿已保存");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndSubmit() {
    if (!await save() || !selected) return;
    await action({ action: "submit_review", id: selected.id }, "图文稿已保存并提交审核");
  }

  async function uploadReviewImages(files: FileList | null) {
    if (!selected || !editable || !files?.length) return;
    if (files.length > 9) { notify("每篇内容最多上传9张图片"); return; }
    setUploadingImages(true);
    try {
      const encoded = await Promise.all(Array.from(files).map(async (file) => ({ name: file.name, type: file.type, data: (await fileToDataUrl(file)).split(",")[1] || "" })));
      await jsonRequest("/api/app", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upload_review_images", id: selected.id, files: encoded }) });
      await reload();
      notify(`已上传 ${files.length} 张最终图片，将与正文一起提交审核`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "审核图片上传失败");
    } finally {
      setUploadingImages(false);
    }
  }

  async function loadVersions() {
    if (!selected) return;
    try {
      const result = await jsonRequest("/api/creation?id=" + encodeURIComponent(selected.id)) as { versions: CreativeVersion[] };
      setVersions(result.versions);
      setShowVersions(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法读取历史版本");
    }
  }

  async function restoreVersion(version: number) {
    setSaving(true);
    try {
      await creationRequest({ action: "restore", version_number: version }, "已恢复 v" + version);
      await loadVersions();
    } catch (error) {
      notify(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setSaving(false);
    }
  }

  function updateImagePrompt(index: number, patch: Partial<ImagePrompt>) {
    setCreative((current) => ({ ...current, image_prompts: current.image_prompts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }

  function copyImagePrompts() {
    const text = creative.image_prompts.map((item) => `【${item.label}】\n${item.prompt}`).join("\n\n");
    void navigator.clipboard.writeText(text).then(() => notify("全部图片提示词已复制")).catch(() => notify("复制失败，请手动选择提示词"));
  }

  const selectedAccount = data.accounts.find((account) => account.id === selectedAccountId);
  const longArticle = isZhihuClaim(selected);
  const selectedPlatformName = platformLabel(selectedAccount?.platform);
  const accountValue = (item?: string | number | null) => item === undefined || item === null || item === "" ? "暂无" : item;
  if (!data.accounts.length) return <section className="panel"><Empty title="还没有平台账号" text="先到当前平台的账号管理中添加账号。" /></section>;
  if (contentLevel === "accounts" || !selectedAccountId) return <div className="content-hierarchy-page"><section className="content-page-intro"><span className="section-kicker">我的内容</span><h2>先选择要管理的内容账号</h2><p>查看账号资料与内容进度，进入账号后再选择具体内容进行创作。</p></section><div className="content-account-overview-grid">{data.accounts.map((account) => { const claims = teamClaims.filter((claim) => claim.account_id === account.id); const creatingCount = claims.filter((claim) => ["writing", "revision"].includes(claim.status)).length; const reviewCount = claims.filter((claim) => claim.status === "review").length; const publishCount = claims.filter((claim) => ["approved", "queued", "publishing", "failed"].includes(claim.status)).length; const publishedCount = claims.filter((claim) => claim.status === "published").length; return <button type="button" className="panel content-account-overview-card" key={account.id} onClick={() => selectAccount(account.id)}><div className="account-profile-head"><span className="large-avatar" style={account.avatar_url ? { backgroundImage: `url(${account.avatar_url})` } : { background: account.color }}>{account.avatar_url ? "" : (account.xhs_nickname || account.name).slice(0, 1)}</span><div><h2>{account.xhs_nickname || account.name}</h2><p>{accountIdentitySummary(account)}</p></div><span className={`account-state ${["login_expired", "unknown", "error"].includes(account.status) ? "error" : ""}`}><i></i>{accountStatus[account.status] || account.status}</span></div><p className="account-bio">{account.profile_bio || account.persona || "尚未同步账号简介和内容定位"}</p><div className="xhs-stats"><span><strong>{accountValue(account.following_count)}</strong>关注</span><span><strong>{accountValue(account.followers_count)}</strong>粉丝</span><span><strong>{accountValue(account.interaction_count)}</strong>获赞与收藏</span><span><strong>{accountValue(account.note_count)}</strong>笔记</span></div><div className="content-account-counts"><span><strong>{creatingCount}</strong>创作中</span><span><strong>{reviewCount}</strong>待审核</span><span><strong>{publishCount}</strong>待发布</span><span><strong>{publishedCount}</strong>已发布</span></div><footer><span>共 {claims.length} 条团队内容</span><strong>进入账号 →</strong></footer></button>; })}</div></div>;

  if (contentLevel === "list" || !selected) return <div className="content-hierarchy-page"><div className="content-breadcrumb"><button type="button" onClick={() => { setContentLevel("accounts"); setSelectedAccountId(""); }}>← 返回账号</button><span>我的内容 / {selectedAccount?.xhs_nickname || selectedAccount?.name}</span></div><section className="panel content-account-summary"><div className="account-profile-head"><span className="large-avatar" style={selectedAccount?.avatar_url ? { backgroundImage: `url(${selectedAccount.avatar_url})` } : { background: selectedAccount?.color }}>{selectedAccount?.avatar_url ? "" : (selectedAccount?.xhs_nickname || selectedAccount?.name || "账").slice(0, 1)}</span><div><h2>{selectedAccount?.xhs_nickname || selectedAccount?.name}</h2><p>{selectedAccount?.profile_bio || selectedAccount?.persona || "选择下方内容进入创作页面"}</p></div><span className="count-chip">{accountClaims.length} 条内容</span></div></section>{accountClaims.length ? <div className="content-task-grid">{accountClaims.map((claim) => <button type="button" className="panel content-task-card" onClick={() => selectTask(claim)} key={claim.id}><div><span className={`status ${toneFor(claim.status)}`}>{contentStageLabel(claim)}</span><time>{dateTime(claim.updated_at)}</time></div><h3>{claim.title || claim.topic_title}</h3><p>{claim.body ? claim.body.slice(0, 90) : "尚未生成正文，进入后可使用 AI 一键创作。"}</p><footer><span>负责人 {claim.owner_name}</span><strong>{claim.version_number ? `v${claim.version_number}` : "待创作"} · 进入内容 →</strong></footer></button>)}</div> : <section className="panel content-account-empty"><Empty title={`${selectedAccount?.xhs_nickname || selectedAccount?.name || "这个账号"}还没有认领内容`} text="到选题中心认领选题并指定这个账号后，任务会出现在这里。" /></section>}</div>;

  return <div className="content-hierarchy-page"><div className="content-breadcrumb"><button type="button" onClick={() => { setContentLevel("list"); setSelectedId(""); }}>← 返回内容列表</button><span>{selectedAccount?.xhs_nickname || selectedAccount?.name} / {selected.title || selected.topic_title}</span></div><div className="creative-shell content-editor-shell">
    <section className="creative-main">
      {!editable ? <div className="content-flow-note"><strong>{contentStageLabel(selected)}</strong><span>{selected.status === "review" ? "内容正在审核中心等待处理。" : selected.status === "published" ? "内容已经发布，可到发布列表查看记录。" : "内容已经进入发布流程，请到发布列表继续处理。"}</span></div> : null}
      <section className="creative-command">
        <div><span className="section-kicker">AI 创作 · {platformLabel(selectedAccount?.platform)}</span><h2>{longArticle ? `一句话生成可编辑的${selectedPlatformName}文章` : "一句话生成可编辑的小红书图文稿"}</h2><p>{longArticle ? `由${selectedPlatformName}文章编辑完成长文初稿，再经过 Humanizer 去除模板化表达。` : "由小红书运营专家生成标题、正文、标签和整篇配图提示词；切换功能页不会中断。"}</p></div>
        <div className="creative-command-row">
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="补充要求（选填）：更口语、面向职场新人、配图偏纪实摄影…" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} />
          <button className="primary" disabled={!editable || creating} onClick={generate}>{creating ? `AI 创作中 ${creationSeconds}秒` : creative.image_prompts.length ? "重新生成整篇" : "开始一键创作"}</button>
        </div>
        {creating ? <div className="creation-progress" role="status" aria-live="polite"><i></i><div><strong>{creationSeconds < 20 ? "正在理解选题和账号定位" : creationSeconds < 60 ? "正在生成并润色完整图文稿" : "正在校验正文和整套配图提示词"}</strong><span>已等待 {creationSeconds} 秒，请保持应用运行；切换页面不会中断。</span></div></div> : null}
      </section>

      <section className="panel creative-editor">
        <div className="editor-head"><div><span className={"status " + toneFor(selected.status)}>{selected.status_label}</span><h2>{selected.topic_title}</h2><p>{selected.account_name} · 负责人 {selected.owner_name} · {selected.version_number ? "v" + selected.version_number : "尚未生成"}</p></div><button className="outline" onClick={showVersions ? () => setShowVersions(false) : loadVersions}>历史版本</button></div>
        {selected.review_comment ? <div className="review-note"><strong>审核意见</strong>{selected.review_comment}</div> : null}
        {selected.creation_error ? <div className="creation-error">上次创作失败：{selected.creation_error}</div> : null}
        {showVersions ? <div className="version-list">{versions.length ? versions.map((version) => <button key={version.id} disabled={saving} onClick={() => restoreVersion(version.version_number)}><span>v{version.version_number} · {version.source}</span><small>{version.title || "未命名"} · {dateTime(version.created_at)}</small></button>) : <p>还没有历史版本</p>}</div> : null}
        {creative.title_options.length ? <div className="title-options"><span>AI 备选标题</span><div>{creative.title_options.map((title) => <button key={title} className={creative.title === title ? "active" : ""} onClick={() => setCreative({ ...creative, title })}>{title}</button>)}</div></div> : null}
        <label>{longArticle ? "专栏标题" : "笔记标题"} <span>{creative.title.length}/{longArticle ? 100 : 20}</span><input maxLength={longArticle ? 100 : 20} value={creative.title} onChange={(event) => setCreative(longArticle ? { ...creative, title: event.target.value } : withCoverTitle({ ...creative, title: event.target.value }))} disabled={!editable} placeholder="一键创作后仍可修改" /></label>
        <label>正文 <span>{creative.body.length} 字</span><textarea className="body-editor" value={creative.body} onChange={(event) => setCreative({ ...creative, body: event.target.value })} disabled={!editable} placeholder="AI 会生成完整正文，也可以在这里手工编辑。" /></label>
        <label>标签<input value={creative.tags.join(" ")} onChange={(event) => setCreative({ ...creative, tags: event.target.value.split(/[，,\s]+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean) })} disabled={!editable} placeholder="多个标签用空格分隔" /></label>
        {!longArticle ? <section className="review-image-uploader"><div><strong>最终审核图片</strong><span>上传1-9张最终图片，审核员会同时检查文案和图片；审核通过后不可在发布页替换。</span></div>{selected.publish_images?.length ? <div className="review-image-grid">{selected.publish_images.map((_, index) => <img key={index} src={reviewImageUrl(selected.id, index)} alt={`待审核图片 ${index + 1}`} />)}</div> : <p>尚未上传最终图片</p>}{editable ? <label className="outline upload-button">{uploadingImages ? "图片上传中…" : selected.publish_images?.length ? "重新选择全部图片" : "选择最终图片"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploadingImages || saving || creating} onChange={(event) => { void uploadReviewImages(event.target.files); event.currentTarget.value = ""; }} /></label> : null}</section> : <div className="content-flow-note"><strong>{selectedPlatformName}当前为文本审核</strong><span>正文与标题会进入审核快照；平台图片规范与正式发布能力将在独立适配器验收后接入。</span></div>}
        <div className="editor-actions"><button className="outline" disabled={!editable || saving || creating || !creative.title || !creative.body} onClick={save}>{saving ? "保存中…" : longArticle ? "保存专栏草稿" : "保存图文稿"}</button><button className="primary" disabled={busy || saving || creating || uploadingImages || !editable || !creative.title || !creative.body || (!longArticle && !selected.publish_images?.length)} onClick={saveAndSubmit}>{longArticle ? "保存专栏并提交审核" : "保存图文并提交审核"}</button></div>
      </section>
    </section>

    {!longArticle ? <aside className="panel visual-builder post-image-prompts">
      <div className="visual-builder-head"><div><span className="section-kicker">整篇视觉建议</span><h2>整个帖子的图片提示词</h2></div>{creative.image_prompts.length ? <button className="outline" onClick={copyImagePrompts}>复制全部提示词</button> : null}</div>
      <p className="post-prompts-intro">AI 根据完整标题和正文推荐一组独立成品图。每条提示词都描述整张图片，不是背景图、卡片模板或留字底图。</p>
      {creative.image_prompts.length ? <div className="post-prompt-list">{creative.image_prompts.map((item, index) => <article className="post-prompt-card" key={index + "-" + item.label}>
        <div className="post-prompt-head"><span>图片 {index + 1}</span><button className="ghost" disabled={!item.prompt} onClick={() => void navigator.clipboard.writeText(item.prompt).then(() => notify(item.label + "提示词已复制")).catch(() => notify("复制失败，请手动选择提示词"))}>复制</button></div>
        <label>图片用途<input value={item.label} disabled={!editable} maxLength={20} onChange={(event) => updateImagePrompt(index, { label: event.target.value })} /></label>
        <label>完整图片提示词<textarea value={item.prompt} disabled={!editable} maxLength={1200} onChange={(event) => updateImagePrompt(index, { prompt: event.target.value })} /></label>{index === 0 ? <small className="cover-title-rule">封面主视觉必须包含上方最终标题的逐字文字，并保证手机缩略图可读。</small> : null}
      </article>)}</div> : <div className="visual-empty"><span>✦</span><h3>还没有图片提示词</h3><p>点击“开始一键创作”，AI 会根据整篇内容推荐封面主视觉、核心观点图和场景配图。</p></div>}
    </aside> : null}
  </div></div>;
}

function Review({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [reviewFilter, setReviewFilter] = useState("pending");
  const [comments, setComments] = useState<Record<string, string>>({});
  const canReview = data.user.roles.some((role) => ["admin", "reviewer"].includes(role));
  const passedStatuses = ["approved", "queued", "publishing", "published", "failed"];
  const isRejected = (claim: Claim) => claim.status === "revision" || (claim.status === "writing" && Boolean(claim.review_comment));
  const reviewGroups = [
    { id: "all", label: "全部", matches: (claim: Claim) => claim.status === "review" || passedStatuses.includes(claim.status) || isRejected(claim) },
    { id: "pending", label: "待审核", matches: (claim: Claim) => claim.status === "review" },
    { id: "approved", label: "已通过", matches: (claim: Claim) => passedStatuses.includes(claim.status) },
    { id: "rejected", label: "已退回", matches: isRejected },
  ];
  const activeGroup = reviewGroups.find((group) => group.id === reviewFilter) || reviewGroups[0];
  const reviewHistory = data.claims.filter(reviewGroups[0].matches);
  const items = reviewHistory.filter(activeGroup.matches);

  return <section className="panel data-panel">
    <div className="panel-head"><div><h2>审核中心</h2><p>按审核状态查看待处理内容和历史结果；通过后自动进入发布列表</p></div><span className="count-chip">{items.length} / {reviewHistory.length} 条审核记录</span></div>
    <div className="topic-status-tabs review-status-tabs" aria-label="按审核状态筛选">{reviewGroups.map((group) => { const count = reviewHistory.filter(group.matches).length; return <button key={group.id} className={reviewFilter === group.id ? "active" : ""} onClick={() => setReviewFilter(group.id)}>{group.label}<span>{count}</span></button>; })}</div>
    {items.length ? <div className="review-list">{items.map((claim) => <article className="review-card" key={claim.id}>
      <div className="review-card-head"><span className="account-avatar" style={{ background: claim.account_color }}>{claim.account_name.slice(0, 1)}</span><div><h3>{claim.title || claim.topic_title}</h3><p>{claim.account_name} · {claim.owner_name} · {dateTime(claim.updated_at)}</p></div><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span></div>
      <p className="review-body">{claim.body || "尚未填写正文"}</p>
      {claim.publish_images?.length ? <div className="review-image-grid review-center-images">{claim.publish_images.map((_, index) => <a key={index} href={reviewImageUrl(claim.id, index)} target="_blank" rel="noreferrer"><img src={reviewImageUrl(claim.id, index)} alt={`${claim.title || claim.topic_title} 审核图片 ${index + 1}`} /></a>)}</div> : <div className="review-missing-images">{isZhihuClaim(claim) ? "知乎文章配图为可选项，可直接进行文本审核" : "缺少审核图片，不能通过"}</div>}
      <div className="tag-line">{claim.tags.map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div>
      {claim.status === "review" && canReview ? <div className="review-actions"><input value={comments[claim.id] || ""} onChange={(e) => setComments({ ...comments, [claim.id]: e.target.value })} placeholder="退回原因（通过时可不填）" /><button className="danger-outline" disabled={busy} onClick={() => action({ action: "review", id: claim.id, result: "reject", comment: comments[claim.id] }, "已退回修改")}>退回</button><button className="primary" disabled={busy || (!isZhihuClaim(claim) && !claim.publish_images?.length)} onClick={() => action({ action: "review", id: claim.id, result: "approve", comment: comments[claim.id] }, isZhihuClaim(claim) ? "文章审核已通过，已进入发布列表" : "图文审核已通过，已进入发布列表")}>{isZhihuClaim(claim) ? "通过文章并转入发布" : "通过图文并转入发布"}</button></div> : <div className="queue-note">{claim.status === "review" ? "当前账号只有查看权限，等待审核员处理。" : isRejected(claim) ? `退回意见：${claim.review_comment || "未填写原因"}` : `审核已通过 · 当前进度：${claim.status_label}`}</div>}
    </article>)}</div> : <Empty title={`${activeGroup.label}分类暂无内容`} text={reviewHistory.length ? "可以切换上方状态查看其他审核记录。" : "创作人员提交审核后，内容会出现在这里。"} />}
  </section>;
}

function Publish({ data, reload, notify }: { data: AppData; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [filter, setFilter] = useState<"pending" | "published">("pending");
  const [working, setWorking] = useState("");
  const [viewing, setViewing] = useState<Claim | null>(null);
  const canPublish = data.user.roles.some((role) => ["admin", "publisher"].includes(role));
  const pending = data.claims.filter((claim) => ["approved", "queued", "publishing", "failed"].includes(claim.status));
  const published = data.claims.filter((claim) => claim.status === "published");
  const items = filter === "pending" ? pending : published;

  async function publishNow(claim: Claim) {
    const platform = platformLabel(claim.account_platform);
    if (!window.confirm(`确认执行真实${platform}发布吗？\n\n发布账号：${claim.account_name}\n内容负责人：${claim.owner_name}\n发布操作人：${data.user.name}\n\n${claim.title || claim.topic_title}`)) return;
    setWorking(claim.id); notify("");
    try {
      await jsonRequest("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish_now", claim_id: claim.id }) });
      await reload(); notify(`内容已通过${platform}发布服务发布成功`);
    } catch (error) { await reload(); notify(error instanceof Error ? error.message : "发布失败"); }
    finally { setWorking(""); }
  }

  async function returnForRevision(claim: Claim) {
    const reason = window.prompt("请输入退回修改原因，工作人员会在“我的内容”中看到：", claim.publish_error || "");
    if (reason === null) return;
    if (!reason.trim()) { notify("请填写退回修改原因"); return; }
    setWorking(claim.id); notify("");
    try {
      await jsonRequest("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "return_for_revision", claim_id: claim.id, reason: reason.trim() }) });
      if (viewing?.id === claim.id) setViewing(null);
      await reload(); notify("内容已退回修改，原文案、配图和历史审核记录均已保留");
    } catch (error) { await reload(); notify(error instanceof Error ? error.message : "退回修改失败"); }
    finally { setWorking(""); }
  }

  async function resolveInterrupted(claim: Claim, outcome: "published" | "failed") {
    const label = outcome === "published" ? "已经发布成功" : "确认没有发布";
    const reason = window.prompt(`请先到${platformLabel(claim.account_platform)}核对结果。\n\n当前选择：${label}\n请输入核对说明：`);
    if (reason === null) return;
    if (!reason.trim()) { notify("请填写人工核对说明"); return; }
    if (!window.confirm(`确认将任务标记为“${outcome === "published" ? "已发布" : "发布失败，可重新发布"}”吗？`)) return;
    setWorking(claim.id); notify("");
    try {
      await jsonRequest("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve_interrupted", claim_id: claim.id, outcome, reason: reason.trim() }) });
      await reload(); notify("中断任务已按人工核对结果更新");
    } catch (error) { await reload(); notify(error instanceof Error ? error.message : "中断任务处理失败"); }
    finally { setWorking(""); }
  }

  const frozen = viewing?.publish_snapshot;
  return <>
    <section className="panel data-panel publish-panel">
      <div className="panel-head publish-head"><div><h2>发布列表</h2><p>发布前确认平台账号、内容负责人和实际发布工作人员；每次发布都保留审核快照。</p></div><div className="publish-tabs"><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>未发布 {pending.length}</button><button className={filter === "published" ? "active" : ""} onClick={() => setFilter("published")}>已发布 {published.length}</button></div></div>
      {items.length ? <div className="publish-list">{items.map((claim) => <article className="publish-card" key={claim.id}>
        <div className="publish-card-main"><span className="account-avatar" style={{ background: claim.account_color }}>{claim.account_name.slice(0, 1)}</span><div><h3>{claim.publish_snapshot?.title || claim.title || claim.topic_title}</h3><p>发布账号 {claim.account_name} · 内容负责人 {claim.owner_name}</p><div className="tag-line">{(claim.publish_snapshot?.tags || claim.tags).map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div></div><button className="outline view-content-button" onClick={() => setViewing(claim)}>查看内容</button></div>
        <div className="publish-meta"><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span><span>{platformLabel(claim.account_platform)} · 工作人员 {claim.publisher_name || `${data.user.name}（当前）`}</span><span>{isZhihuClaim(claim) ? "专栏文本审核" : `${claim.publish_images?.length || 0} 张配图`}</span><span>{claim.published_at ? `发布于 ${dateTime(claim.published_at)}` : `更新于 ${dateTime(claim.updated_at)}`}</span>{claim.published_url ? <a href={claim.published_url} target="_blank" rel="noreferrer">查看原文 ↗</a> : null}</div>
        {claim.publish_error ? <div className="publish-error">上次发布失败：{claim.publish_error}</div> : null}
        {filter === "pending" && canPublish ? claim.status === "publishing" && claim.publish_recoverable
          ? <div className="publish-actions"><span>发布已超过8分钟，请先到{platformLabel(claim.account_platform)}核对，避免重复发布。</span><button className="outline" disabled={Boolean(working)} onClick={() => resolveInterrupted(claim, "failed")}>确认未发布，允许重试</button><button className="primary" disabled={Boolean(working)} onClick={() => resolveInterrupted(claim, "published")}>确认已经发布</button></div>
          : <div className="publish-actions"><span>{isZhihuClaim(claim) ? "将通过独立浏览器发布审核冻结的知乎专栏文本" : `将发布审核通过的 ${claim.publish_snapshot?.images?.length || claim.publish_images?.length || 0} 张图片`} · 操作人 {data.user.name}</span><button className="danger-outline" disabled={Boolean(working) || claim.status === "publishing"} onClick={() => returnForRevision(claim)}>退回修改</button><button className="primary" disabled={Boolean(working) || (!isZhihuClaim(claim) && !(claim.publish_snapshot?.images?.length || claim.publish_images?.length)) || claim.status === "publishing"} onClick={() => publishNow(claim)}>{working === claim.id || claim.status === "publishing" ? "发布处理中…" : claim.status === "failed" ? "确认后重新发布" : isZhihuClaim(claim) ? "确认并发布专栏" : "确认并发布审核图文"}</button></div>
          : <div className="published-note">{filter === "pending" ? "当前账号只有查看权限，等待发布员处理。" : `由 ${claim.publisher_name || "工作人员未记录"} 发布；平台保留审核快照、账号和发布时间记录。`}</div>}
      </article>)}</div> : <Empty title={filter === "pending" ? "没有未发布内容" : "还没有已发布内容"} text={filter === "pending" ? "内容审核通过后会自动进入这里。" : "通过本页面成功发布的内容会保留在这里。"} />}
    </section>
    {viewing ? <div className="modal-backdrop"><section className="modal publish-preview-modal" role="dialog" aria-modal="true" aria-label="发布内容预览"><div className="publish-preview-head"><div><span className="section-kicker">审核冻结图文</span><h2>{frozen?.title || viewing.title || viewing.topic_title}</h2></div><button className="ghost" onClick={() => setViewing(null)} aria-label="关闭内容预览">×</button></div><div className="publish-preview-meta"><span>账号 {viewing.account_name}</span><span>负责人 {viewing.owner_name}</span><span>发布人 {viewing.publisher_name || (viewing.status === "published" ? "未记录" : data.user.name)}</span><span>{viewing.status_label}</span><span>{frozen?.images?.length || viewing.publish_images?.length || 0} 张配图</span>{frozen?.approved_at ? <span>审核于 {dateTime(frozen.approved_at)}</span> : null}</div>{(frozen?.images || viewing.publish_images)?.length ? <div className="review-image-grid publish-preview-images">{(frozen?.images || viewing.publish_images || []).map((_, index) => <img key={index} src={reviewImageUrl(viewing.id, index)} alt={`审核通过图片 ${index + 1}`} />)}</div> : null}<div className="publish-preview-body">{frozen?.body || viewing.body || "暂无正文"}</div><div className="tag-line publish-preview-tags">{(frozen?.tags || viewing.tags).map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div><div className="modal-actions"><button className="primary" onClick={() => setViewing(null)}>关闭</button></div></section></div> : null}
  </>;
}

function Accounts({ platform, data, action, busy, reload, notify }: { platform: PlatformId; data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Account | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [qr, setQr] = useState<{ account: Account; image: string; text: string } | null>(null);
  const [zhihuLoginId, setZhihuLoginId] = useState("");

  async function xhs(account: Account, requestAction: "qrcode" | "status" | "profile") {
    setConnecting(account.id); notify("");
    try {
      const result = await jsonRequest<XhsActionResult>("/api/xhs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: requestAction, account_id: account.id }) });
      if (requestAction === "qrcode") setQr({ account, image: result.image, text: result.text });
      else if (requestAction === "profile") { notify(`${account.name} 的账号概览已同步`); await reload(); }
      else { notify(result.unknown ? `${account.name} 的可见浏览器仍未完成页面加载，实时状态暂无法确认` : result.online ? `${account.name} 已登录，身份核验通过` : `${account.name} 尚未登录，请扫码`); await reload(); if (result.online) setQr(null); }
    } catch (error) { notify(error instanceof Error ? error.message : "连接小红书失败"); }
    finally { setConnecting(null); }
  }

  async function zhihuLogin(account: Account) {
    const completing = zhihuLoginId === account.id;
    setConnecting(account.id); notify("");
    try {
      const result = await jsonRequest<{ opened?: boolean; authenticated?: boolean }>("/api/zhihu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: completing ? "browser_login_complete" : "browser_login", account_id: account.id }) });
      if (!completing) { setZhihuLoginId(account.id); notify("知乎登录窗口已打开；完成登录后回到这里点击“我已登录，完成绑定”"); }
      else if (result.authenticated) { setZhihuLoginId(""); notify(`${account.name} 的知乎登录已保存`); await reload(); }
      else notify("尚未检测到知乎登录，请在浏览器窗口完成登录后重试");
    } catch (error) { notify(error instanceof Error ? error.message : "知乎浏览器登录失败"); }
    finally { setConnecting(null); }
  }

  const isAdmin = data.user.roles.includes("admin");
  const currentPlatformName = platformLabel(platform);
  const accountHelp = platform === "xiaohongshu" ? "账号创建后通过独立浏览器扫码绑定，登录凭据只保存在团队主机。" : platform === "zhihu" ? "账号创建后点击“登录知乎”，在独立浏览器窗口完成正常登录；登录态只保存在团队主机。" : "先建立微信公众号账号记录，用于内容归属与团队协作；正式授权和发布适配器后续独立接入。";
  return <div className="page-stack"><div className="accounts-toolbar"><div><span className="section-kicker">真实账号记录</span><h2>{data.accounts.length ? `${data.accounts.length} 个平台账号` : "还没有添加平台账号"}</h2><p>当前仅显示{currentPlatformName}账号；不同平台的登录与发布能力相互隔离。</p></div>{isAdmin ? <button className="primary" onClick={() => setAdding(true)}>＋ 添加{currentPlatformName}账号</button> : null}</div>{data.accounts.length ? <div className="account-grid">{data.accounts.map((account) => <AccountOverview key={account.id} account={account} claims={data.claims.filter((claim) => claim.account_id === account.id)} connecting={connecting === account.id} xhs={xhs} canManage={isAdmin} editStrategy={isAdmin ? () => setEditingStrategy(account) : undefined} loginZhihu={isAdmin ? () => zhihuLogin(account) : undefined} loginPending={zhihuLoginId === account.id} />)}</div> : <section className="panel account-empty"><span>◎</span><h3>账号列表为空</h3><p>添加真实的{currentPlatformName}账号后，才会在工作台和选题认领中出现。</p>{isAdmin ? <button className="primary" onClick={() => setAdding(true)}>添加第一个{currentPlatformName}账号</button> : null}</section>}{adding ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action({ action: "create_account", platform, name: form.get("name") }, currentPlatformName + "账号记录已添加"); setAdding(false); }}><span className="section-kicker">账号中心</span><h2>添加{currentPlatformName}账号</h2><div className="fixed-platform-field"><span>所属平台</span><strong>{currentPlatformName}</strong></div><label>账号备注名称<input name="name" required placeholder="例如：品牌主账号" /></label><p className="modal-help">{accountHelp}</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={busy}>添加{currentPlatformName}账号</button></div></form></div> : null}{editingStrategy ? <div className="modal-backdrop"><form className="modal strategy-modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action({ action: "update_account_strategy", account_id: editingStrategy.id, persona: form.get("persona"), audience: form.get("audience"), content_pillars: form.get("content_pillars"), strategy_keywords: form.get("strategy_keywords"), excluded_topics: form.get("excluded_topics") }, `已更新“${editingStrategy.name}”的内容定位`); setEditingStrategy(null); }}><span className="section-kicker">账号内容定位</span><h2>{editingStrategy.xhs_nickname || editingStrategy.name}</h2><label>账号定位<textarea name="persona" required defaultValue={editingStrategy.persona} placeholder="例如：面向中小团队的AI内容效率顾问" /></label><label>目标受众<textarea name="audience" required defaultValue={editingStrategy.audience} placeholder="例如：内容负责人、运营主管、小团队老板" /></label><label>内容支柱（至少2个，用逗号分隔）<input name="content_pillars" required defaultValue={editingStrategy.content_pillars?.join("，")} placeholder="内容效率，团队流程，AI工具实测" /></label><label>策略关键词（至少3个，用逗号分隔）<input name="strategy_keywords" required defaultValue={editingStrategy.strategy_keywords?.join("，")} placeholder="AI内容工作流，团队提效，小红书运营" /></label><label>排除领域（选填）<input name="excluded_topics" defaultValue={editingStrategy.excluded_topics?.join("，")} placeholder="招聘，游戏，金融行情" /></label><p className="modal-help">内容定位会用于 AI 创作与后续平台选题，不会改变既有小红书爆款搜索规则。</p><div className="modal-actions"><button className="ghost" onClick={() => setEditingStrategy(null)}>取消</button><button className="primary" disabled={busy}>保存内容定位</button></div></form></div> : null}{qr ? <div className="modal-backdrop"><section className="modal qr-modal"><span className="section-kicker">小红书扫码登录</span><h2>{qr.account.name}</h2><p>{qr.text}</p><div className="qr-image" role="img" aria-label={`${qr.account.name}的小红书登录二维码`} style={{ backgroundImage: `url(${qr.image})` }}></div><ol><li>平台会同时打开一个可见的小红书浏览器窗口</li><li>打开手机小红书 App，扫描二维码并确认登录</li><li>请在 5 分钟内点击“我已扫码”</li><li>系统核对用户ID后才会完成绑定</li></ol><div className="modal-actions"><button className="ghost" onClick={() => setQr(null)}>取消</button><button className="primary" disabled={connecting === qr.account.id} onClick={() => xhs(qr.account, "status")}>{connecting ? "核验身份中…" : "我已扫码，核验身份"}</button></div></section></div> : null}</div>;
}

function AccountOverview({ account, claims, connecting, xhs, canManage, editStrategy, loginZhihu, loginPending }: { account: Account; claims: Claim[]; connecting: boolean; xhs: (account: Account, action: "qrcode" | "status" | "profile") => Promise<void>; canManage: boolean; editStrategy?: () => void; loginZhihu?: () => void; loginPending?: boolean }) {
  const inProgress = claims.filter((claim) => ["writing", "revision", "review"].includes(claim.status)).length;
  const waiting = claims.filter((claim) => ["approved", "queued", "publishing"].includes(claim.status)).length;
  const published = claims.filter((claim) => claim.status === "published").length;
  const value = (item?: string | number | null) => item === undefined || item === null || item === "" ? "暂无" : item;
  if (account.platform === "wechat") return <article className="panel account-card"><div className="account-profile-head"><span className="large-avatar" style={{ background: account.color }}>微</span><div><h2>{account.external_display_name || account.name}</h2><p>微信公众号账号记录</p><small>授权与正式发布适配器尚未开放</small></div><span className="account-state error"><i></i>待接入</span></div><p className="account-bio">当前用于区分公众号内容归属、选题、创作和团队审核；不会误调用小红书或知乎的发布能力。</p><div className="account-strategy"><strong>{account.persona || "尚未设置内容定位"}</strong><span>{account.audience ? `受众：${account.audience}` : "设置定位后会用于公众号文章创作"}</span></div><div className="platform-stats"><span>创作中 <strong>{inProgress}</strong></span><span>待发布 <strong>{waiting}</strong></span><span>历史发布 <strong>{published}</strong></span></div>{canManage ? <div className="account-buttons"><button className="outline" onClick={editStrategy}>内容定位</button><button className="primary" disabled>授权设计中</button></div> : <p className="sync-time">只有管理员可以管理公众号授权。</p>}</article>;
  if (account.platform === "zhihu") return <article className="panel account-card"><div className="account-profile-head"><span className="large-avatar" style={{ background: account.color }}>知</span><div><h2>{account.external_display_name || account.name}</h2><p>{account.status === "online" ? "浏览器登录状态已保存" : "尚未登录知乎"}</p><small>{account.status === "online" ? "独立登录状态已保存在团队主机" : "点击下方按钮打开知乎登录窗口"}</small></div><span className={`account-state ${account.status === "online" ? "" : "error"}`}><i></i>{accountStatus[account.status] || account.status}</span></div><p className="account-bio">知乎账号使用独立浏览器登录态；专栏文章可沿用团队创作、文本审核、发布队列和失败核验流程。</p><div className="account-strategy"><strong>{account.persona || "尚未设置内容定位"}</strong><span>{account.audience ? `受众：${account.audience}` : "设置定位后会用于知乎专栏创作"}</span></div><div className="platform-stats"><span>创作中 <strong>{inProgress}</strong></span><span>待发布 <strong>{waiting}</strong></span><span>历史发布 <strong>{published}</strong></span></div>{canManage ? <div className="account-buttons"><button className="outline" onClick={editStrategy}>内容定位</button><button className="primary" disabled={connecting} onClick={loginZhihu}>{connecting ? "正在检测…" : loginPending ? "我已登录，完成绑定" : account.status === "online" ? "重新登录知乎" : "登录知乎"}</button></div> : <p className="sync-time">只有管理员可以登录和管理知乎账号。</p>}</article>;
  return <article className="panel account-card"><div className="account-profile-head"><span className="large-avatar" style={account.avatar_url ? { backgroundImage: `url(${account.avatar_url})` } : { background: account.color }}>{account.avatar_url ? "" : account.name.slice(0, 1)}</span><div><h2>{account.xhs_nickname || account.name}</h2><p>{account.xhs_red_id ? `小红书号 ${account.xhs_red_id}` : account.xhs_user_id ? `用户ID ${account.xhs_user_id}` : "尚未绑定小红书身份"}</p><small>{account.xhs_user_id ? "登录凭据已保存 · 实时状态需核验" : "尚未保存登录凭据"}</small></div><span className={`account-state ${["login_expired", "unknown", "error"].includes(account.status) ? "error" : ""}`}><i></i>{accountStatus[account.status] || account.status}</span></div><p className="account-bio">{account.profile_bio || (account.status === "online" ? "尚未同步账号简介" : "扫码登录后可读取真实账号概览")}</p><div className="account-strategy"><strong>{account.persona || "尚未设置内容定位"}</strong><span>{account.audience ? `受众：${account.audience}` : "设置定位后才能用于垂直选题研究"}</span>{account.strategy_keywords?.length ? <small>{account.strategy_keywords.map((word) => `#${word}`).join(" ")}</small> : null}</div><div className="xhs-stats"><span><strong>{value(account.following_count)}</strong>关注</span><span><strong>{value(account.followers_count)}</strong>粉丝</span><span><strong>{value(account.interaction_count)}</strong>获赞与收藏</span><span><strong>{value(account.note_count)}</strong>笔记</span></div><div className="platform-stats"><span>创作中 <strong>{inProgress}</strong></span><span>待发布 <strong>{waiting}</strong></span><span>已发布 <strong>{published}</strong></span></div><p className="sync-time">{account.profile_synced_at ? `账号数据同步于 ${dateTime(account.profile_synced_at)}` : "账号公开数据尚未同步"}</p>{canManage ? <div className={`account-buttons ${editStrategy ? "four" : "three"}`}>{editStrategy ? <button className="outline" onClick={editStrategy}>内容定位</button> : null}<button className="outline" disabled={connecting} onClick={() => xhs(account, "status")}>{connecting ? "可见核验中…" : "检查登录"}</button><button className="outline" disabled={connecting || account.status !== "online"} onClick={() => xhs(account, "profile")}>{connecting ? "读取中…" : "同步概览"}</button><button className="primary" disabled={connecting} onClick={() => xhs(account, "qrcode")}>{account.status === "online" ? "重新登录" : "扫码登录"}</button></div> : <p className="sync-time">只有管理员可以登录、核验和同步账号。</p>}</article>;
}

function Logs({ data }: { data: AppData }) { return <section className="panel data-panel"><div className="panel-head"><div><h2>操作日志</h2><p>登录、创建、编辑、审核和发布操作全部留痕</p></div></div>{data.logs.length ? <div className="log-list">{data.logs.map((log) => <div key={log.id}><span className="log-dot"></span><div><strong>{log.actor_name} · {log.action}</strong><p>{log.detail || `${log.object_type} / ${log.object_type === "user" ? "工作人员" : log.object_type}`}</p></div><time>{dateTime(log.created_at)}</time></div>)}</div> : <Empty title="暂无操作记录" text="完成一次业务操作后，日志会自动产生。" />}</section>; }

function Settings({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(data.ai_settings.baseUrl);
  const [model, setModel] = useState(data.ai_settings.model);
  const isAdmin = data.user.roles.includes("admin");
  const ai = data.ai_settings;
  const environmentManaged = ai.keySource === "environment";
  function removeMember(member: User) {
    if (!window.confirm(`确认删除团队成员“${member.name}”吗？\n\n该成员会立即退出登录且无法再次登录；其历史创作、审核和发布记录仍会保留。`)) return;
    action({ action: "remove_user", user_id: member.id }, `已删除成员“${member.name}”并撤销其登录权限`);
  }
  return <div className="settings-grid">
    <section className="panel settings-card">
      <div className="settings-title"><div><span className="section-kicker">团队成员</span><h2>{data.users.length} 位工作人员</h2></div>{isAdmin ? <button className="outline" onClick={() => setAdding(true)}>＋ 添加成员</button> : null}</div>
      {data.users.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>@{member.username} · {roleLabel(member.roles)}</small></div>{member.id === data.user.id ? <span className="soft-badge">当前账号</span> : <><span className="soft-badge">启用</span>{isAdmin ? <button className="danger-outline member-delete" disabled={busy} onClick={() => removeMember(member)}>删除成员</button> : null}</>}</div>)}
      <p className="helper">删除成员会立即撤销登录权限，但会保留其历史创作、审核、发布和操作记录。</p>
    </section>
    <section className="panel settings-card"><span className="section-kicker">运行方式</span><h2>本机团队模式</h2><dl><div><dt>数据存储</dt><dd>本机数据库</dd></div><div><dt>AI 创作</dt><dd>{ai.configured ? ai.model : "等待配置"}</dd></div><div><dt>创作规则</dt><dd>平台内置</dd></div><div><dt>发布并发</dt><dd>最多 2 个浏览器</dd></div><div><dt>公网访问</dt><dd>关闭</dd></div></dl></section>
    <section className="panel settings-card ai-settings-card">
      <div className="settings-title"><div><span className="section-kicker">AI 模型</span><h2>连接你自己的 AI 服务</h2></div><span className={`ai-connection-state ${ai.configured && !ai.unavailable ? "ready" : ""}`}>{ai.unavailable ? "运行管理器未连接" : ai.configured ? "已配置" : "待配置"}</span></div>
      <p className="ai-settings-intro">平台通过 OpenAI 兼容接口完成爆款研究、选题拆解和内容创作。API Key 只保存在运行平台的这台主机，不会发送到团队成员的浏览器，也不会进入 Git 仓库。</p>
      <form className="ai-settings-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action({ action: "save_ai_settings", base_url: form.get("base_url"), model: form.get("model"), api_key: apiKey }, "AI 配置已安全保存"); setApiKey(""); }}>
        <label>API 地址<input name="base_url" type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={!isAdmin || environmentManaged} placeholder="https://api.openai.com/v1" /></label>
        <label>模型名称<input name="model" required value={model} onChange={(event) => setModel(event.target.value)} disabled={!isAdmin || environmentManaged} placeholder="例如 gpt-5-mini" /></label>
        <label>API Key<input name="api_key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={!isAdmin || environmentManaged} required={!ai.configured} autoComplete="new-password" placeholder={ai.configured ? "已保存；留空不会替换" : "仅保存到主机本地"} /></label>
        <div className="ai-settings-actions"><small>{environmentManaged ? "当前由主机环境变量管理，页面只读。" : "测试当前输入不会保存；连接成功后再保存配置。"}</small>{isAdmin ? <><button type="button" className="outline" disabled={busy || ai.unavailable || !baseUrl || !model || (!apiKey && !ai.configured)} onClick={() => action({ action: "test_ai_settings", base_url: baseUrl, model, api_key: apiKey }, "AI 连接测试成功，当前输入尚未保存")}>测试当前输入</button><button className="primary" disabled={busy || environmentManaged || ai.unavailable}>保存配置</button></> : null}</div>
      </form>
    </section>
    {adding ? <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); action({ action: "create_user", name: form.get("name"), username: form.get("username"), password: form.get("password"), role: form.get("role") }, "团队成员已添加"); setAdding(false); }}><span className="section-kicker">团队账号</span><h2>添加工作人员</h2><label>姓名<input name="name" required /></label><label>用户名<input name="username" required placeholder="字母、数字、下划线" /></label><label>初始密码<input name="password" type="password" required minLength={8} /></label><label>角色<select name="role"><option value="operator">内容运营</option><option value="reviewer">审核员</option><option value="publisher">发布员</option><option value="readonly">只读成员</option></select></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={busy}>创建账号</button></div></form></div> : null}
  </div>;
}

function Metric({ icon: MetricIcon, tone, label, value, note, onClick }: { icon: Icon; tone: string; label: string; value: number; note: string; onClick: () => void }) { return <button type="button" className={`metric-card metric-${tone}`} onClick={onClick} aria-label={`${label} ${value}，${note}`}><span className={`metric-icon ${tone}`}><MetricIcon aria-hidden="true" size={19} weight="duotone" /></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></button>; }
function AccountRow({ account }: { account: Account }) { const error = account.status === "login_expired"; return <div className="account-row"><span className="account-avatar" style={{ background: account.color }}>{account.name.slice(0, 1)}</span><div><strong>{account.name}</strong><small>{error ? "队列已暂停" : `等待队列 ${account.queue_count}`}</small></div><span className={`account-state ${error ? "error" : ""}`}><i></i>{accountStatus[account.status] || account.status}</span></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><span>○</span><h3>{title}</h3><p>{text}</p></div>; }
function toneFor(status: string) { if (["review"].includes(status)) return "amber"; if (["writing"].includes(status)) return "blue"; if (["approved", "queued", "published"].includes(status)) return "violet"; return "rose"; }
function contentStageLabel(claim: Claim) {
  if (claim.status === "writing") return claim.version_number || claim.body ? "创作中" : "待生成";
  if (claim.status === "revision") return "待修改";
  if (claim.status === "review") return "待审核";
  if (["approved", "queued"].includes(claim.status)) return "待发布";
  if (claim.status === "publishing") return "发布中";
  if (claim.status === "published") return "已发布";
  if (claim.status === "failed") return "发布失败";
  return claim.status_label;
}
function roleLabel(roles: string[]) { if (roles.includes("admin")) return "管理员"; if (roles.includes("reviewer")) return "审核员"; if (roles.includes("publisher")) return "发布员"; if (roles.includes("readonly")) return "只读成员"; return "内容运营"; }
function dateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function dateOnly(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
