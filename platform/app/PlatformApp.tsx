"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type User = { id: string; name: string; username: string; roles: string[] };
type Account = { id: string; name: string; status: string; color: string; queue_count: number; xhs_user_id?: string; xhs_nickname?: string; xhs_red_id?: string; profile_bio?: string; avatar_url?: string; following_count?: string; followers_count?: string; interaction_count?: string; note_count?: number; profile_synced_at?: string };
type Topic = { id: string; title: string; source_url: string; relevance: string; status: string; creator_name: string; created_at: string; brief?: string; target_audience?: string; pain_point?: string; hook_points?: string[]; content_structure?: string[]; why_it_works?: string; account_fit?: string; source_feed_ids?: string[]; score?: number; source_author?: string; source_keyword?: string; liked_count?: string; collected_count?: string; comment_count?: string; heat_score?: number; captured_at?: string; note_published_at?: string; note_id?: string; source_processing_status?: string; source_detail_verified?: number; claim_status?: string; claim_owner_name?: string };
type ImagePrompt = { label: string; prompt: string };
type CreativeDraft = { title_options: string[]; title: string; body: string; tags: string[]; image_prompts: ImagePrompt[]; creative_note: string };
type CreativeVersion = { id: string; version_number: number; source: string; title: string; created_at: string };
type Claim = { id: string; topic_id: string; topic_title: string; account_id: string; account_name: string; account_color: string; owner_id: string; owner_name: string; angle: string; status: string; status_label: string; title: string; body: string; tags: string[]; review_comment: string; updated_at: string; creative?: Partial<CreativeDraft>; creation_status?: string; creation_error?: string; version_number?: number; generated_at?: string; publish_images?: string[]; publish_error?: string; published_at?: string; publisher_id?: string; publisher_name?: string; publish_snapshot?: { title?: string; body?: string; tags?: string[]; approved_at?: string } | null };
type Log = { id: string; actor_name: string; action: string; object_type: string; detail: string; created_at: string };
type AppData = { user: User; accounts: Account[]; topics: Topic[]; claims: Claim[]; logs: Log[]; users: User[] };
type TrendSettings = { account_id?: string; keywords: string[]; exclude_keywords: string[]; publish_time: string; sort_by: string; content_type?: "image" | "video" | "all"; last_scanned_at?: string; next_allowed_at?: string };
type TrendSample = { id: string; feed_id: string; keyword: string; matched_keywords: string[]; title: string; author_name: string; note_type: string; source_url: string; cover_url: string; detail_text: string; original_tags: string[]; content_summary: string; sample_hooks: string[]; title_hook: string; visual_highlight: string; sample_pain_point: string; emotion_pain: string; practical_value: string; controversy_point: string; sample_structure: string[]; reusable_directions: string[]; account_adaptation: string; relevance_score: number; information_density_score: number; remix_value_score: number; selection_reason: string; liked_count: string; collected_count: string; comment_count: string; shared_count: string; raw_heat_score: number; heat_score: number; published_at?: string; selection_status: string; processing_status: string; capture_outcome: string; detail_error: string; status: string; first_seen_at: string; last_seen_at: string };
type TrendScan = { id: string; keywords: string[]; completed_keywords: string[]; status: string; result_count: number; error: string; started_at: string; completed_at?: string };
type TrendData = { settings: TrendSettings; samples: TrendSample[]; scans: TrendScan[]; accounts: Account[] };

const navItems = [
  ["dashboard", "⌂", "工作台"], ["trends", "⌕", "爆款选题"], ["topics", "⌁", "选题中心"], ["content", "▤", "我的内容"],
  ["review", "✓", "审核中心"], ["publish", "↗", "发布列表"], ["accounts", "◎", "账号中心"], ["logs", "≡", "日志中心"], ["settings", "⚙", "系统设置"],
];

const navGroups = [
  { label: "内容运营", ids: ["dashboard", "trends", "topics", "content"] },
  { label: "审核发布", ids: ["review", "publish"] },
  { label: "平台管理", ids: ["accounts", "logs", "settings"] },
];

const viewDescriptions: Record<string, string> = {
  dashboard: "查看团队今天需要推进的内容和账号状态",
  trends: "从真实高表现帖子中持续沉淀团队选题",
  topics: "统一管理选题来源、拆解结果和认领进度",
  content: "按账号查看已认领内容并完成 AI 创作",
  review: "集中处理待审核内容并保留审核记录",
  publish: "确认账号、人员和素材后执行真实发布",
  accounts: "管理团队正在使用的小红书账号",
  logs: "查看关键操作和平台运行记录",
  settings: "管理成员权限与本机运行参数",
};

const accountStatus: Record<string, string> = { online: "在线", busy: "发布中", login_expired: "登录失效", unknown: "状态未知", paused: "已暂停", error: "异常" };
const claimStatus: Record<string, string> = { writing: "创作中", review: "待审核", revision: "待修改", approved: "待发布", queued: "发布队列", publishing: "发布中", published: "已发布", failed: "发布失败" };
const sampleProcessingStatus: Record<string, string> = { pending: "等待处理", detail_fetching: "正在获取详情", success: "成功", skipped: "跳过", detail_failed: "详情获取失败" };
const sampleCaptureOutcome: Record<string, string> = { new: "新发现", duplicate: "已存在/重复" };

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function blankCreative(claim?: Claim): CreativeDraft {
  const saved = (claim?.creative ?? {}) as Partial<CreativeDraft>;
  const currentPrompts = Array.isArray(saved.image_prompts) ? saved.image_prompts
    .map((item) => ({ label: String(item.label ?? "配图建议"), prompt: String(item.prompt ?? "") }))
    .filter((item) => item.prompt) : [];
  return {
    title_options: Array.isArray(saved?.title_options) ? saved.title_options : [],
    title: saved?.title ?? claim?.title ?? "",
    body: saved?.body ?? claim?.body ?? "",
    tags: Array.isArray(saved?.tags) ? saved.tags : claim?.tags ?? [],
    image_prompts: currentPrompts.slice(0, 6),
    creative_note: saved?.creative_note ?? "",
  };
}

export default function PlatformApp() {
  const [auth, setAuth] = useState<{ initialized: boolean; user: User | null } | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState("dashboard");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAuth = useCallback(async () => setAuth(await jsonRequest("/api/auth")), []);
  const loadData = useCallback(async () => setData(await jsonRequest("/api/app")), []);
  useEffect(() => { fetch("/api/auth").then((response) => response.json()).then(setAuth).catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { if (auth?.user) jsonRequest("/api/app").then(setData).catch((error) => { setData(null); setMessage(error instanceof Error ? error.message : "无法读取团队工作区"); }); }, [auth]);

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

  const pendingReview = data.claims.filter((claim) => claim.status === "review").length;
  const pendingPublish = data.claims.filter((claim) => ["approved", "queued", "publishing", "failed"].includes(claim.status)).length;
  const unclaimed = data.topics.filter((topic) => topic.status === "unclaimed").length;
  const currentLabel = navItems.find(([id]) => id === view)?.[2];
  const messageStartsWithSuccess = /^(已|正文补抓与拆解完成|内容已)/.test(message);
  const messageHasWarning = messageStartsWithSuccess && /(不可用|仍需|已保留|跳过|超时)/.test(message);
  const messageHasError = !messageStartsWithSuccess && /(失败|不能|没有|无法|错误|中断)/.test(message);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">红</span><div><strong>红薯台</strong><small>内容运营中台</small></div></div>
        <nav aria-label="主要导航">
          {navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.ids.map((id) => { const item = navItems.find(([itemId]) => itemId === id); if (!item) return null; const [, icon, label] = item; return <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}><span>{icon}</span>{label}{id === "topics" && unclaimed > 0 ? <b>{unclaimed}</b> : null}{id === "review" && pendingReview > 0 ? <b>{pendingReview}</b> : null}{id === "publish" && pendingPublish > 0 ? <b>{pendingPublish}</b> : null}</button>; })}</div>)}
        </nav>
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">{data.user.name.slice(0, 1)}</div><div><strong>{data.user.name}</strong><small>{roleLabel(data.user.roles)}</small></div><button onClick={logout}>退出</button></div></div>
      </aside>
      <section className={`workspace view-${view}`}>
        <header className="topbar"><div className="topbar-copy"><h1>{view === "dashboard" ? `下午好，${data.user.name}` : currentLabel}</h1><p className="page-description">{viewDescriptions[view]}</p></div><div className="topbar-actions"><span className="workspace-date">{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span><button className="primary" onClick={() => setView("topics")}>新建选题</button></div></header>
        {message ? <div className={`toast ${messageHasError ? "bad" : messageHasWarning ? "warn" : ""}`}><span>{message}</span><button onClick={() => setMessage("")}>×</button></div> : null}
        <div className="workspace-content">
          {view === "dashboard" && <Dashboard data={data} setView={setView} />}
          <div className="persistent-view" hidden={view !== "trends"} aria-hidden={view !== "trends"}>
            <Trends reloadApp={loadData} notify={setMessage} />
          </div>
          {view === "topics" && <Topics data={data} action={action} busy={busy} />}
          <div className="persistent-view" hidden={view !== "content"} aria-hidden={view !== "content"}>
            <Content data={data} action={action} busy={busy} reload={loadData} notify={setMessage} />
          </div>
          {view === "review" && <Review data={data} action={action} busy={busy} />}
          {view === "publish" && <Publish data={data} reload={loadData} notify={setMessage} />}
          {view === "accounts" && <Accounts data={data} action={action} busy={busy} reload={loadData} notify={setMessage} />}
          {view === "logs" && <Logs data={data} />}
          {view === "settings" && <Settings data={data} action={action} busy={busy} />}
        </div>
      </section>
    </main>
  );
}

function AuthPage({ mode, onSubmit, busy, message }: { mode: "setup" | "login"; onSubmit: (event: FormEvent<HTMLFormElement>, mode: "setup" | "login") => void; busy: boolean; message: string }) {
  const setup = mode === "setup";
  return <main className="auth-page"><section className="auth-intro"><div className="brand inverse"><span className="brand-mark">红</span><div><strong>红薯台</strong><small>内容运营中台</small></div></div><div><span className="pill">本机部署 · 团队专用</span><h1>把选题、创作、审核和发布，<br />放进一个清晰的工作台。</h1><p>数据留在你的 Mac mini，团队成员使用独立账号协作。</p></div><small>零新增软件费用 · AI 创作图文稿</small></section><section className="auth-form-wrap"><form className="auth-form" onSubmit={(event) => onSubmit(event, mode)}><span className="auth-kicker">{setup ? "首次启动" : "欢迎回来"}</span><h2>{setup ? "创建管理员账号" : "登录团队工作区"}</h2><p>{setup ? "这位管理员可以继续添加成员和分配权限。" : "使用管理员为你创建的用户名和密码。"}</p>{setup ? <label>姓名<input name="name" required placeholder="例如：万勇龙" autoComplete="name" /></label> : null}<label>用户名<input name="username" required placeholder="3-24位字母或数字" autoComplete="username" /></label><label>密码<input name="password" required minLength={8} type="password" placeholder="至少8位" autoComplete={setup ? "new-password" : "current-password"} /></label>{message ? <div className="form-error">{message}</div> : null}<button className="primary auth-submit" disabled={busy}>{busy ? "请稍候…" : setup ? "创建并进入平台" : "登录"}</button><small>账号密码仅保存在本机数据库中，不使用飞书或小红书登录。</small></form></section></main>;
}

function Dashboard({ data, setView }: { data: AppData; setView: (view: string) => void }) {
  const reviews = data.claims.filter((claim) => claim.status === "review").length;
  const mine = data.claims.filter((claim) => claim.owner_id === data.user.id && ["writing", "revision"].includes(claim.status)).length;
  const published = data.claims.filter((claim) => claim.status === "published").length;
  const visibleClaims = data.claims.slice(0, 5);
  return <div className="dashboard-layout">
    <section className="dashboard-main">
      <article className="focus-card"><div><span className="pill">今日重点</span><h2>把好内容，稳稳地发出去。</h2><p>{mine ? `你有 ${mine} 篇内容需要继续处理。` : "当前没有待处理草稿，可以从选题中心认领新任务。"}</p><div className="focus-actions"><button className="light-button" onClick={() => setView(mine ? "content" : "topics")}>{mine ? "继续创作" : "寻找选题"}</button><span>团队任务 <strong>{data.claims.length}</strong></span></div></div><div className="progress-ring"><div><strong>{Math.min(100, published * 10)}%</strong><span>发布进度</span></div></div></article>
      <section className="metrics"><Metric icon="⌁" tone="lavender" label="待认领选题" value={data.topics.filter((t) => t.status === "unclaimed").length} note="进入选题中心" /><Metric icon="✎" tone="blue" label="我的创作" value={mine} note="草稿自动保存" /><Metric icon="✓" tone="amber" label="等待审核" value={reviews} note="需审核员处理" /><Metric icon="↗" tone="mint" label="累计已发布" value={published} note="本机记录" /></section>
      <section className="panel task-panel"><div className="panel-head"><div><h2>内容任务</h2><p>团队最近更新的任务</p></div><button onClick={() => setView("content")}>查看全部</button></div>{visibleClaims.length ? <div className="task-list">{visibleClaims.map((claim) => <article className="task-row" key={claim.id}><div className={`status-dot ${toneFor(claim.status)}`}></div><div className="task-main"><h3>{claim.title || claim.topic_title}</h3><p><span>{claim.account_name}</span> · 负责人 {claim.owner_name}</p></div><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span></article>)}</div> : <Empty title="还没有内容任务" text="创建选题并认领后，任务会出现在这里。" />}</section>
    </section>
    <aside className="dashboard-rail">
      <article className="alert-card"><div className="alert-head"><span>账号提醒</span><b>!</b></div><h3>{data.accounts.length ? data.accounts.find((a) => a.status === "login_expired")?.name || "账号运行正常" : "尚未添加账号"}</h3><p>{!data.accounts.length ? "账号中心只展示你实际添加的小红书账号。" : data.accounts.some((a) => a.status === "login_expired") ? "登录状态已失效，相关发布任务将保持暂停。" : "所有账号连接状态正常。"}</p><button onClick={() => setView("accounts")}>{data.accounts.length ? "立即处理" : "添加账号"} →</button></article>
      <section className="panel account-panel"><div className="panel-head"><div><h2>账号运行状态</h2><p>{data.accounts.length} 个账号 · 全局并发上限 2</p></div><button onClick={() => setView("accounts")}>管理</button></div><div className="account-list">{data.accounts.map((account) => <AccountRow key={account.id} account={account} />)}</div></section>
    </aside>
  </div>;
}

function Trends({ reloadApp, notify }: { reloadApp: () => Promise<void>; notify: (message: string) => void }) {
  const [data, setData] = useState<TrendData | null>(null);
  const [scanning, setScanning] = useState("");
  const [filter, setFilter] = useState("selected");
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [topicSample, setTopicSample] = useState<TrendSample | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [requestText, setRequestText] = useState("");
  const taskAbortRef = useRef<AbortController | null>(null);
  const activeScanRef = useRef("");
  const [stoppingTask, setStoppingTask] = useState(false);

  const load = useCallback(async () => {
    const result = await jsonRequest("/api/trends") as TrendData;
    setData(result);
  }, []);
  useEffect(() => {
    jsonRequest("/api/trends").then((result: TrendData) => setData(result))
      .catch((error) => notify(error instanceof Error ? error.message : "无法读取爆款选题库"));
  }, [notify]);

  async function startScan() {
    if (!requestText.trim()) { notify("请先用一句话描述你想找什么选题"); return; }
    const controller = new AbortController();
    taskAbortRef.current = controller;
    let stage = "1/5 AI 正在理解你的需求";
    setScanning(stage); notify("");
    try {
      const plan = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "plan_request", request_text: requestText }) });
      stage = `2/5 已理解：${plan.intent_summary}，正在分配主账号 MCP`;
      setScanning(stage);
      const begin = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "begin_scan", request_text: requestText, theme: plan.theme }) });
      activeScanRef.current = String(begin.scan_id || "");
      if (begin.reused) {
        const resumeWarnings: string[] = [];
        const pendingDetailIds = Array.isArray(begin.detail_sample_ids) ? begin.detail_sample_ids as string[] : [];
        for (let index = 0; index < pendingDetailIds.length; index += 1) {
          stage = `4/5 正在补抓上次未完成的正文 ${index + 1}/${pendingDetailIds.length}`; setScanning(stage);
          const enriched = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: begin.scan_id, sample_id: pendingDetailIds[index] }) });
          if (enriched.warning) resumeWarnings.push(enriched.warning);
          await load();
        }
        if (begin.needs_analysis && begin.scan_id) {
          stage = "最后一步：采集与正文读取已完成，AI 正在拆解并生成原创选题（最长约 5 分钟）"; setScanning(stage);
          const resumed = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: begin.scan_id }) });
          await Promise.all([load(), reloadApp()]); notify(`已从正文成功的样本整理出 ${resumed.created} 个可领取选题${resumeWarnings.length ? `；${resumeWarnings.join("；")}` : ""}`); return;
        }
        notify(`${begin.message}，下次可更新：${dateTime(begin.next_allowed_at)}`); await load(); return;
      }
      const words = begin.keywords as string[];
      const scanWarnings: string[] = [];
      for (let index = 0; index < words.length; index += 1) {
        stage = `3/5 正在搜索基础样本 ${index + 1}/${words.length}：${words[index]}`; setScanning(stage);
        const scanned = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "scan_keyword", scan_id: begin.scan_id, keyword: words[index] }) });
        if (scanned.warning) scanWarnings.push(`${words[index]}：${scanned.warning}`);
        await load();
      }
      stage = "4/5 基础样本已入库，正在计算热度"; setScanning(stage);
      const finished = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "finish_scan", scan_id: begin.scan_id }) });
      await load();
      const detailSampleIds = Array.isArray(finished.detail_sample_ids) ? finished.detail_sample_ids as string[] : [];
      for (let index = 0; index < detailSampleIds.length; index += 1) {
        stage = `4/5 已从 ${finished.candidate_count || 0} 条候选选出 ${finished.selected_count || detailSampleIds.length} 条，正在补充详情 ${index + 1}/${detailSampleIds.length}`; setScanning(stage);
        const enriched = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: begin.scan_id, sample_id: detailSampleIds[index] }) });
        if (enriched.warning) scanWarnings.push(enriched.warning);
        await load();
      }
      stage = "最后一步：采集与正文读取已完成，AI 正在聚类、拆解爆点并生成原创选题（最长约 5 分钟）"; setScanning(stage);
      const analysis = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: begin.scan_id }) });
      await Promise.all([load(), reloadApp()]);
      notify(`已自动整理出 ${analysis.created} 个可领取选题${scanWarnings.length ? `。补充说明：${scanWarnings.join("；")}` : ""}`);
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
      const resume = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "resume_details", confirmed: true, origin: "manual_backfill_button" }) });
      activeScanRef.current = String(resume.scan_id || "");
      const ids = Array.isArray(resume.detail_sample_ids) ? resume.detail_sample_ids as string[] : [];
      if (!ids.length) { notify("当前没有等待补抓的入选样本"); await load(); return; }
      const warnings: string[] = [];
      for (let index = 0; index < ids.length; index += 1) {
        stage = `正在补抓正文 ${index + 1}/${ids.length}`; setScanning(stage);
        const result = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "enrich_sample", scan_id: resume.scan_id, sample_id: ids[index] }) });
        if (result.warning) warnings.push(result.warning);
        await load();
      }
      stage = "正文补抓已完成，AI 正在生成完整爆款档案（最长约 5 分钟）"; setScanning(stage);
      const analysis = await jsonRequest("/api/trends", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "analyze_scan", scan_id: resume.scan_id }) });
      await Promise.all([load(), reloadApp()]);
      notify(`正文补抓与拆解完成，已生成 ${analysis.created ?? 0} 个原创选题${warnings.length ? `；${warnings.length} 条正文仍需稍后重试` : ""}`);
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
    const sampleIds = selectedSamples.filter((id) => data?.samples.some((sample) => sample.id === id && sample.status === "new" && sample.selection_status === "selected" && sample.processing_status === "success" && sample.detail_text && sample.content_summary));
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
    const confirmed = window.confirm(`确认从爆款选题样本库删除已选择的 ${selectedSamples.length} 条记录吗？\n\n已经转入选题中心的选题不会被删除。`);
    if (!confirmed) return;
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
  const canTransferSample = (sample: TrendSample) => sample.status === "new" && sample.selection_status === "selected" && sample.processing_status === "success" && Boolean(sample.detail_text && sample.content_summary);
  const visible = data.samples.filter((sample) => {
    if (sample.status === "archived") return false;
    if (filter === "selected") return sample.selection_status === "selected" && sample.status === "new";
    if (filter === "processing") return ["pending", "detail_fetching"].includes(sample.processing_status);
    if (filter === "exceptions") return ["detail_failed", "skipped"].includes(sample.processing_status);
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
  const isAiAnalysis = Boolean(scanning && scanning.includes("AI 正在"));
  return <div className="page-stack trend-page">
    <section className="trend-hero"><div className="trend-command-copy"><span className="pill">爆款研究任务</span><h2>用一句话建立可写的选题参考。</h2><p>先展示标题、作者与互动数据，再按热度补充正文，最后整理摘要、痛点、爆点与内容结构。</p><div className="trend-command"><input value={requestText} onChange={(event) => setRequestText(event.target.value)} aria-describedby="trend-submit-hint" placeholder="例如：最近一周高互动的AI效率工具图文，整理成团队选题" /><button className="light-button" disabled={Boolean(scanning) || !data.settings?.account_id || !requestText.trim()} onClick={startScan}>{scanning ? isAiAnalysis ? "AI 分析中…" : isDetailBackfill ? "补抓处理中…" : "正在采集…" : "开始采集并拆解"}</button>{scanning ? <button className="stop-task-button" disabled={stoppingTask} onClick={stopTrendTask}>{stoppingTask ? "正在停止…" : "停止任务"}</button> : null}</div><small id="trend-submit-hint" className="trend-submit-hint">采集与补抓只会在你点击对应按钮并确认后开始；切换平台页面不会停止已经开始的任务。</small>{scanning ? <div className="workflow-progress"><i></i><span>{isDetailBackfill ? `后台补抓任务：${scanning}` : scanning}</span></div> : null}</div><div className="trend-hero-action"><small>{selectedAccount ? `研究账号：${selectedAccount.xhs_nickname || selectedAccount.name}` : "尚未设置研究账号"}</small><div className="trend-research-stats"><span><strong>{data.samples.length}</strong><small>真实样本</small></span><span><strong>{detailedCount}</strong><small>已读正文</small></span><span><strong>{analyzedCount}</strong><small>已完成拆解</small></span></div>{data.settings?.last_scanned_at ? <time>上次更新 {dateTime(data.settings.last_scanned_at)}</time> : <time>尚未完成首次研究</time>}</div></section>
    <section className="panel trend-library">
      <div className="panel-head"><div><h2>爆款笔记研究库</h2><p>{data.samples.length} 条真实候选 · 扩大候选池后按热度筛选 · 笔记 ID 自动去重</p></div><div className="sample-tabs">{pendingSelectedCount ? <button className="retry-details" disabled={Boolean(scanning)} onClick={resumePendingDetails}>补抓正文 {pendingSelectedCount}</button> : null}<button className={filter === "selected" ? "active" : ""} onClick={() => { setFilter("selected"); setSelectedSamples([]); }}>入选待转入 {data.samples.filter((item) => item.selection_status === "selected" && item.status === "new").length}</button><button className={filter === "processing" ? "active" : ""} onClick={() => { setFilter("processing"); setSelectedSamples([]); }}>处理中</button><button className={filter === "exceptions" ? "active" : ""} onClick={() => { setFilter("exceptions"); setSelectedSamples([]); }}>失败/跳过</button><button className={filter === "used" ? "active" : ""} onClick={() => { setFilter("used"); setSelectedSamples([]); }}>已转选题 {data.samples.filter((item) => item.status === "used").length}</button><button className={filter === "all" ? "active" : ""} onClick={() => { setFilter("all"); setSelectedSamples([]); }}>全部</button></div></div>
      {selectable.length ? <div className="sample-batch-bar">
        <label><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedSamples(allVisibleSelected ? selectedSamples.filter((id) => !selectable.some((sample) => sample.id === id)) : Array.from(new Set([...selectedSamples, ...selectable.map((sample) => sample.id)])))} />全选当前列表</label>
        <span>已选择 {selectedSamples.length} 条 · 可转入 {transferableCount} 条{alreadyTransferredCount ? ` · 已转入 ${alreadyTransferredCount} 条` : ""}{unavailableTransferCount ? ` · 暂不可转 ${unavailableTransferCount} 条` : ""}</span>
        <button className="ghost" disabled={!selectedSamples.length || batchBusy} onClick={() => setSelectedSamples([])}>清空</button>
        <button className="danger-outline" disabled={!selectedSamples.length || batchBusy} onClick={deleteSamplesInBatch}>{batchBusy ? "正在处理…" : `批量删除${selectedSamples.length ? `（${selectedSamples.length}）` : ""}`}</button>
        <button className="primary" disabled={!transferableCount || batchBusy} onClick={createTopicsInBatch}>{batchBusy ? "正在处理…" : `批量转入选题中心（可转 ${transferableCount}）`}</button>
      </div> : null}
      {visible.length ? <div className="sample-research-list">{visible.map((sample) => <article className={`sample-research-row ${selectedSamples.includes(sample.id) ? "selected" : ""}`} key={sample.id}>
        <label className="research-selector" aria-label={`选择 ${sample.title}`}><input type="checkbox" checked={selectedSamples.includes(sample.id)} onChange={() => setSelectedSamples((current) => current.includes(sample.id) ? current.filter((id) => id !== sample.id) : [...current, sample.id])} /></label>
        <div className="research-score"><strong>{sample.heat_score || "--"}</strong><span>热度</span></div>
        <div className="research-main">
          <div className="research-title"><div><span>{sample.matched_keywords.length ? sample.matched_keywords.map((word) => `#${word}`).join(" · ") : `#${sample.keyword}`}</span><h3>{sample.title}</h3></div><div className="research-state-stack"><span className={`research-state ${sample.processing_status === "success" ? "ready" : "pending"}`}>{sampleProcessingStatus[sample.processing_status] || sample.processing_status}</span><small>{sampleCaptureOutcome[sample.capture_outcome] || sample.capture_outcome} · {sample.selection_status === "selected" ? "入选爆款" : "候选未入选"}</small></div></div>
          <div className="research-source"><span>作者 <strong>{sample.author_name || "未知"}</strong></span><span>笔记ID <strong>{sample.feed_id}</strong></span><span>发布时间 <strong>{sample.published_at ? dateOnly(sample.published_at) : "详情未提供"}</strong></span><span>抓取时间 <strong>{dateTime(sample.last_seen_at)}</strong></span>{sample.original_tags.length ? <span>标签 <strong>{sample.original_tags.map((tag) => `#${tag}`).join(" ")}</strong></span> : null}<a href={sample.source_url} target="_blank" rel="noreferrer">查看原文链接</a></div>
          <div className="research-insight"><div><span>内容摘要</span><p>{sample.processing_status === "success" ? sample.content_summary || "正文已读取，等待AI完成摘要与拆解。" : "正文尚未获取成功，只保留标题、作者和真实互动数据；旧AI推断已隐藏。"}</p></div><div><span>爆点拆解</span>{sample.processing_status === "success" && sample.sample_hooks.length ? <ul>{sample.sample_hooks.map((hook) => <li key={hook}>{hook}</li>)}</ul> : <p>{sample.processing_status === "success" ? "等待AI拆解" : "正文成功后才会拆解"}</p>}</div></div>
          {sample.processing_status === "success" ? <details className="research-details"><summary>展开完整爆款档案</summary><div><section><span>标题钩子</span><p>{sample.title_hook || "等待拆解"}</p></section><section><span>视觉亮点</span><p>{sample.visual_highlight || (sample.cover_url ? "已保留封面依据，等待分析" : "未获取封面视觉内容，无法判断")}</p></section><section><span>情绪或痛点</span><p>{sample.emotion_pain || sample.sample_pain_point || "等待拆解"}</p></section><section><span>实用价值</span><p>{sample.practical_value || "等待拆解"}</p></section><section><span>争议与互动点</span><p>{sample.controversy_point || "等待拆解"}</p></section><section><span>内容结构</span><p>{sample.sample_structure.length ? sample.sample_structure.join(" → ") : "等待拆解"}</p></section><section><span>可复用选题方向</span><p>{sample.reusable_directions.length ? sample.reusable_directions.join(" · ") : "等待拆解"}</p></section><section><span>适合自身账号的原创转化</span><p>{sample.account_adaptation || "等待拆解"}</p></section><section><span>综合判断</span><p>{sample.selection_reason || "等待相关度与二创价值判断"}</p><small>行业相关 {sample.relevance_score || 0} · 信息密度 {sample.information_density_score || 0} · 二创价值 {sample.remix_value_score || 0}</small></section><section className="research-original"><span>原帖正文</span><p>{sample.detail_text}</p></section></div></details> : <div className="research-detail-blocked"><strong>完整爆款档案尚未生成</strong><span>{sample.detail_error || "正文等待补抓，成功后才会显示摘要、钩子、痛点和原创方向。"}</span></div>}
        </div>
        <aside className="research-side"><div><span>点赞<strong>{sample.liked_count}</strong></span><span>收藏<strong>{sample.collected_count}</strong></span><span>评论<strong>{sample.comment_count}</strong></span><span>分享<strong>{sample.shared_count || "未提供"}</strong></span><span>原始热度<strong>{Math.round(sample.raw_heat_score || 0)}</strong></span><span>标准分<strong>{sample.heat_score || "--"}</strong></span></div><button className="outline" disabled={sample.status === "used" || sample.selection_status !== "selected" || sample.processing_status !== "success" || !sample.detail_text || !sample.content_summary} onClick={() => { setTopicSample(sample); setTopicTitle(""); }}>{sample.status === "used" ? "已转入" : sample.selection_status !== "selected" ? "候选未入选" : sample.processing_status !== "success" || !sample.detail_text ? "正文成功后可转入" : !sample.content_summary ? "等待爆点拆解" : "转入选题中心"}</button><button className="ghost" onClick={() => sampleAction("archive_sample", sample)}>忽略</button></aside>
      </article>)}</div> : <Empty title={data.samples.length ? "这个分类暂无样本" : "还没有研究样本"} text={data.samples.length ? "可以切换上方分类查看其他样本。" : "在上方输入研究需求，系统会搜索并拆解重点帖子。"} />}
    </section>
    {topicSample ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); sampleAction("create_topic", topicSample, topicTitle); }}><span className="section-kicker">从样本加入选题</span><h2>直接加入，或修改标题</h2><div className="source-sample"><small>参考样本</small><strong>{topicSample.title}</strong><span>#{topicSample.keyword} · 赞 {topicSample.liked_count} · 藏 {topicSample.collected_count}</span></div><label>选题标题（选填）<input value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="不填写则使用样本标题" /></label><p className="modal-help">留空会使用上方样本标题；填写后则使用你的新标题。选题仍会保留原帖链接和来源记录。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setTopicSample(null)}>取消</button><button className="primary">加入正式选题库</button></div></form></div> : null}
  </div>;
}

function Topics({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [claiming, setClaiming] = useState<Topic | null>(null);
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [angle, setAngle] = useState("");
  const [topicFilter, setTopicFilter] = useState("unclaimed");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
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

  function toggleTopic(topicId: string) {
    setSelectedTopics((current) => current.includes(topicId) ? current.filter((id) => id !== topicId) : [...current, topicId]);
  }

  function archiveSelectedTopics() {
    if (!selectedTopics.length) return;
    if (!window.confirm(`确定从选题中心删除选中的 ${selectedTopics.length} 个选题吗？\n\n已有的认领、创作、审核和发布记录会继续保留。`)) return;
    action({ action: "archive_topics_bulk", topic_ids: selectedTopics }, `已从选题中心删除 ${selectedTopics.length} 个选题，相关内容任务和历史记录已保留`);
    setSelectedTopics([]);
  }

  return <div className="page-stack">
    <section className="panel creation-strip"><div><span className="section-kicker">快速创建</span><h2>把一个想法加入团队选题池</h2></div><form onSubmit={(e) => { e.preventDefault(); action({ action: "create_topic", title, source_url: url, relevance: "中" }, "选题已创建"); setTitle(""); setUrl(""); }}><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="输入选题标题" /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="来源链接（选填）" /><button className="primary" disabled={busy}>添加选题</button></form></section>
    <section className="panel data-panel">
      <div className="panel-head"><div><h2>团队选题库</h2><p>每个选题都保留真实来源、互动数据、拆解和认领记录</p></div><span className="count-chip">{visibleTopics.length} / {data.topics.length} 个选题</span></div>
      <div className="topic-status-tabs" aria-label="按选题状态筛选">{topicGroups.map((group) => { const count = data.topics.filter(group.matches).length; return <button key={group.id} className={topicFilter === group.id ? "active" : ""} onClick={() => setTopicFilter(group.id)}>{group.label}<span>{count}</span></button>; })}</div>
      {visibleTopics.length ? <div className="topic-batch-bar"><label><input type="checkbox" checked={allVisibleTopicsSelected} onChange={() => setSelectedTopics(allVisibleTopicsSelected ? selectedTopics.filter((id) => !visibleTopics.some((topic) => topic.id === id)) : Array.from(new Set([...selectedTopics, ...visibleTopics.map((topic) => topic.id)])))} />全选当前分类</label><span>已选择 {selectedTopics.length} 个选题</span><button className="ghost" disabled={!selectedTopics.length || busy} onClick={() => setSelectedTopics([])}>清空</button><button className="danger-outline" disabled={!selectedTopics.length || busy} onClick={archiveSelectedTopics}>{busy ? "正在处理…" : `批量删除${selectedTopics.length ? `（${selectedTopics.length}）` : ""}`}</button></div> : null}
      {visibleTopics.length ? <div className="data-list topic-cards">{visibleTopics.map((topic) => <article className={`topic-row ${topic.brief ? "analyzed" : ""} ${selectedTopics.includes(topic.id) ? "selected" : ""}`} key={topic.id}>
        <label className="topic-selector" aria-label={`选择 ${topic.title}`}><input type="checkbox" checked={selectedTopics.includes(topic.id)} onChange={() => toggleTopic(topic.id)} /></label>
        <div className="topic-index">{topic.heat_score || topic.score || topic.title.slice(0, 1)}</div>
        <div className="topic-info"><div className="topic-title-line"><div><span>选题标题</span><h3>{topic.title}</h3></div><span className={`soft-badge ${topic.status}`}>{topic.note_id && !topic.source_detail_verified ? "来源正文未验证" : topic.claim_status ? claimStatus[topic.claim_status] || topic.claim_status : "待认领"}</span></div><div className="topic-source-grid"><div><span>链接</span>{topic.source_url ? <a href={topic.source_url} target="_blank" rel="noreferrer">打开原笔记 ↗</a> : <strong>暂无</strong>}</div><div><span>作者</span><strong>{topic.source_author || "暂无"}</strong></div><div><span>关键词</span><strong>{topic.source_keyword ? `#${topic.source_keyword}` : "暂无"}</strong></div><div><span>点赞</span><strong>{topic.liked_count || "暂无"}</strong></div><div><span>收藏</span><strong>{topic.collected_count || "暂无"}</strong></div><div><span>评论</span><strong>{topic.comment_count || "暂无"}</strong></div><div><span>热度分</span><strong>{topic.heat_score ?? "暂无"}</strong></div><div><span>状态</span><strong>{topic.note_id && !topic.source_detail_verified ? "不可认领" : topic.claim_status ? claimStatus[topic.claim_status] || topic.claim_status : "待认领"}</strong></div><div><span>认领人</span><strong>{topic.claim_owner_name || "未认领"}</strong></div><div><span>抓取日期</span><strong>{topic.captured_at ? dateTime(topic.captured_at) : "暂无"}</strong></div><div><span>笔记日期</span><strong>{topic.note_published_at ? dateOnly(topic.note_published_at) : "暂无"}</strong></div><div><span>笔记ID</span><strong className="note-id">{topic.note_id || "暂无"}</strong></div></div><div className="topic-breakdown"><div className="topic-summary"><span>内容摘要</span><p>{topic.note_id && !topic.source_detail_verified ? "该选题由旧逻辑在正文获取失败时生成，拆解内容仅供排查，不应作为创作依据。" : topic.brief || "人工添加的选题，暂无自动摘要。"}</p></div><div className="topic-hooks"><span>爆点拆解</span><p>{topic.note_id && !topic.source_detail_verified ? "等待来源正文验证" : topic.hook_points?.length ? topic.hook_points.join(" · ") : "暂无自动拆解"}</p></div>{topic.brief && (!topic.note_id || Boolean(topic.source_detail_verified)) ? <dl><div><dt>目标用户</dt><dd>{topic.target_audience}</dd></div><div><dt>核心痛点</dt><dd>{topic.pain_point}</dd></div><div><dt>内容结构</dt><dd>{topic.content_structure?.join(" → ")}</dd></div><div><dt>账号匹配</dt><dd>{topic.account_fit}</dd></div></dl> : null}<small>创建人 {topic.creator_name} · 参考 {topic.source_feed_ids?.length || (topic.note_id ? 1 : 0)} 条真实样本</small></div></div>
        <button className="outline topic-claim-button" disabled={!data.accounts.length || Boolean(topic.note_id && !topic.source_detail_verified)} onClick={() => setClaiming(topic)}>{topic.note_id && !topic.source_detail_verified ? "等待正文验证" : topic.claim_status ? "再次认领" : "认领创作"}</button>
      </article>)}</div> : <Empty title={`${activeGroup.label}分类暂无选题`} text={data.topics.length ? "可以切换上方状态查看其他选题。" : "去爆款选题页说一句话，系统会自动采集、拆解并生成选题。"} />}
    </section>
    {claiming ? <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); action({ action: "claim_topic", topic_id: claiming.id, account_id: accountId, angle }, `已由 ${data.user.name} 认领，进入团队内容`); setClaiming(null); }}><span className="section-kicker">认领创作</span><h2>{claiming.title}</h2>{claiming.brief ? <div className="source-sample"><small>选题拆解</small><strong>{claiming.brief}</strong><span>{claiming.hook_points?.join(" · ")}</span></div> : null}<div className="claim-worker-note"><span>认领工作人员</span><strong>{data.user.name}</strong><small>@{data.user.username} · {roleLabel(data.user.roles)}</small></div><label>发布账号<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {accountStatus[account.status]}</option>)}</select></label><label>创作角度<textarea value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={claiming.pain_point || "例如：从普通上班族的真实体验切入"} /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setClaiming(null)}>取消</button><button className="primary" disabled={busy}>确认由我认领</button></div></form></div> : null}
  </div>;
}

// Kept temporarily for migration comparison while existing drafts are upgraded.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyContent({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const mine = data.claims.filter((claim) => claim.owner_id === data.user.id || data.user.roles.includes("admin"));
  const [selectedId, setSelectedId] = useState(mine[0]?.id ?? ""); const selected = mine.find((claim) => claim.id === selectedId) ?? mine[0];
  const [draft, setDraft] = useState({ title: selected?.title ?? "", body: selected?.body ?? "", tags: selected?.tags.join(" ") ?? "" });
  const [codexText, setCodexText] = useState("");
  const prompt = selected ? `你是小红书内容编辑。请围绕选题「${selected.topic_title}」，为账号「${selected.account_name}」创作一篇图文笔记。创作角度：${selected.angle || "结合账号定位自然展开"}。请返回JSON：{"title":"标题","body":"正文","tags":["标签1","标签2"]}。不要虚构数据，不使用绝对化承诺。` : "";
  function importCodex() { try { const parsed = JSON.parse(codexText); setDraft({ title: parsed.title || "", body: parsed.body || "", tags: Array.isArray(parsed.tags) ? parsed.tags.join(" ") : parsed.tags || "" }); action({ action: "import_codex", id: selected.id, title: parsed.title, body: parsed.body, tags: parsed.tags }, "Codex 结果已导入并保存"); setCodexText(""); } catch { alert("请粘贴 Codex 返回的标准 JSON 内容"); } }
  if (!selected) return <section className="panel"><Empty title="还没有属于你的内容" text="先去选题中心认领一个选题。" /></section>;
  return <div className="editor-layout"><aside className="panel editor-list"><div className="panel-head"><div><h2>我的内容</h2><p>{mine.length} 个任务</p></div></div>{mine.map((claim) => <button className={selected.id === claim.id ? "selected" : ""} onClick={() => { setSelectedId(claim.id); setDraft({ title: claim.title, body: claim.body, tags: claim.tags.join(" ") }); }} key={claim.id}><span style={{ background: claim.account_color }}>{claim.account_name.slice(0, 1)}</span><div><strong>{claim.title || claim.topic_title}</strong><small>{claim.account_name} · {claim.status_label}</small></div></button>)}</aside><section className="panel editor"><div className="editor-head"><div><span className={`status ${toneFor(selected.status)}`}>{selected.status_label}</span><h2>{selected.topic_title}</h2><p>{selected.account_name} · 负责人 {selected.owner_name}</p></div><button className="outline" onClick={() => navigator.clipboard.writeText(prompt)}>复制 Codex 提示词</button></div>{selected.review_comment ? <div className="review-note"><strong>审核意见</strong>{selected.review_comment}</div> : null}<label>笔记标题 <span>{draft.title.length}/20</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} disabled={!(["writing", "revision"].includes(selected.status))} /></label><label>正文 <span>{draft.body.length} 字</span><textarea className="body-editor" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} disabled={!(["writing", "revision"].includes(selected.status))} placeholder="在这里撰写正文，或从右侧导入 Codex 结果…" /></label><label>标签<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} disabled={!(["writing", "revision"].includes(selected.status))} placeholder="多个标签用空格分隔" /></label><div className="editor-actions"><button className="outline" disabled={busy || !["writing", "revision"].includes(selected.status)} onClick={() => action({ action: "save_draft", id: selected.id, ...draft }, "草稿已保存")}>保存草稿</button><button className="primary" disabled={busy || !["writing", "revision"].includes(selected.status)} onClick={() => action({ action: "submit_review", id: selected.id }, "已提交审核")}>提交审核</button></div></section><aside className="panel codex-panel"><span className="section-kicker">Codex 手工模式</span><h2>AI 创作助手</h2><p>复制提示词到 Codex，生成后把 JSON 结果粘贴回来。</p><div className="prompt-box">{prompt}</div><button className="outline full" onClick={() => navigator.clipboard.writeText(prompt)}>复制提示词</button><textarea value={codexText} onChange={(e) => setCodexText(e.target.value)} placeholder={'粘贴结果：\n{"title":"...","body":"...","tags":["..."]}'} /><button className="primary full" disabled={!codexText || busy} onClick={importCodex}>导入并保存</button></aside></div>;
}

function Content({ data, action, busy, reload, notify }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean; reload: () => Promise<void>; notify: (message: string) => void }) {
  const teamClaims = data.claims;
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const accountClaims = selectedAccountId ? teamClaims.filter((claim) => claim.account_id === selectedAccountId) : [];
  const [selectedId, setSelectedId] = useState("");
  const selected = accountClaims.find((claim) => claim.id === selectedId) ?? accountClaims[0];
  const [creative, setCreative] = useState<CreativeDraft>(() => blankCreative(selected));
  const [instruction, setInstruction] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<CreativeVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const editable = Boolean(selected && ["writing", "revision"].includes(selected.status));

  function selectTask(claim: Claim) {
    setSelectedId(claim.id);
    setCreative(blankCreative(claim));
    setVersions([]);
    setShowVersions(false);
  }

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    const first = teamClaims.find((claim) => claim.account_id === accountId);
    if (first) selectTask(first);
    else {
      setSelectedId("");
      setCreative(blankCreative());
      setVersions([]);
      setShowVersions(false);
    }
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
  const accountSelector = <section className="panel content-account-selector"><div><span className="section-kicker">团队共享内容 · 选择账号</span><h2>查看团队在各账号下的全部内容</h2><p>所有成员看到同一批已认领内容，可以共同生成、编辑和提交；原负责人信息继续保留。</p></div><div className="content-account-grid">{data.accounts.map((account) => { const claims = teamClaims.filter((claim) => claim.account_id === account.id); const active = claims.filter((claim) => ["writing", "revision"].includes(claim.status)).length; return <button key={account.id} className={selectedAccountId === account.id ? "selected" : ""} onClick={() => selectAccount(account.id)}><span className="account-avatar" style={account.avatar_url ? { backgroundImage: `url(${account.avatar_url})` } : { background: account.color }}>{account.avatar_url ? "" : (account.xhs_nickname || account.name).slice(0, 1)}</span><div><strong>{account.xhs_nickname || account.name}</strong><small>{claims.length} 个团队内容 · {active} 个待创作</small></div><i>{selectedAccountId === account.id ? "已选择" : "选择"}</i></button>; })}</div></section>;

  if (!data.accounts.length) return <section className="panel"><Empty title="还没有小红书账号" text="先到账号中心添加并登录一个真实账号。" /></section>;
  if (!selectedAccountId) return <div className="content-account-page">{accountSelector}<section className="panel content-account-empty"><Empty title="请选择一个账号" text="选择账号后，才会显示对应账号认领的内容任务。" /></section></div>;
  if (!selected) return <div className="content-account-page">{accountSelector}<section className="panel content-account-empty"><Empty title={`${selectedAccount?.xhs_nickname || selectedAccount?.name || "这个账号"}还没有认领内容`} text="到选题中心认领选题并指定这个账号后，任务会出现在这里。" /></section></div>;
  return <div className="content-account-page">{accountSelector}<div className="creative-shell">
    <aside className="panel editor-list creative-task-list">
      <div className="panel-head"><div><h2>{selectedAccount?.xhs_nickname || selectedAccount?.name}</h2><p>{accountClaims.length} 个从选题中心认领的内容</p></div></div>
      {accountClaims.map((claim) => <button className={selected.id === claim.id ? "selected" : ""} onClick={() => selectTask(claim)} key={claim.id}>
        <span style={{ background: claim.account_color }}>{claim.version_number ? "稿" : "题"}</span>
        <div><strong>{claim.title || claim.topic_title}</strong><small>{contentStageLabel(claim)} · {claim.owner_name}</small></div>
      </button>)}
    </aside>

    <section className="creative-main">
      {!editable ? <div className="content-flow-note"><strong>{contentStageLabel(selected)}</strong><span>{selected.status === "review" ? "内容正在审核中心等待处理。" : selected.status === "published" ? "内容已经发布，可到发布列表查看记录。" : "内容已经进入发布流程，请到发布列表继续处理。"}</span></div> : null}
      <section className="creative-command">
        <div><span className="section-kicker">AI 创作</span><h2>一句话生成可编辑的小红书图文稿</h2><p>由小红书运营专家生成标题、正文、标签和整篇配图提示词；切换功能页不会中断。</p></div>
        <div className="creative-command-row">
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="补充要求（选填）：更口语、面向职场新人、配图偏纪实摄影…" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} />
          <button className="primary" disabled={!editable || creating} onClick={generate}>{creating ? "AI 创作中…" : creative.image_prompts.length ? "重新生成整篇" : "开始一键创作"}</button>
        </div>
      </section>

      <section className="panel creative-editor">
        <div className="editor-head"><div><span className={"status " + toneFor(selected.status)}>{selected.status_label}</span><h2>{selected.topic_title}</h2><p>{selected.account_name} · 负责人 {selected.owner_name} · {selected.version_number ? "v" + selected.version_number : "尚未生成"}</p></div><button className="outline" onClick={showVersions ? () => setShowVersions(false) : loadVersions}>历史版本</button></div>
        {selected.review_comment ? <div className="review-note"><strong>审核意见</strong>{selected.review_comment}</div> : null}
        {selected.creation_error ? <div className="creation-error">上次创作失败：{selected.creation_error}</div> : null}
        {showVersions ? <div className="version-list">{versions.length ? versions.map((version) => <button key={version.id} disabled={saving} onClick={() => restoreVersion(version.version_number)}><span>v{version.version_number} · {version.source}</span><small>{version.title || "未命名"} · {dateTime(version.created_at)}</small></button>) : <p>还没有历史版本</p>}</div> : null}
        {creative.title_options.length ? <div className="title-options"><span>AI 备选标题</span><div>{creative.title_options.map((title) => <button key={title} className={creative.title === title ? "active" : ""} onClick={() => setCreative({ ...creative, title })}>{title}</button>)}</div></div> : null}
        <label>笔记标题 <span>{creative.title.length}/20</span><input value={creative.title} onChange={(event) => setCreative({ ...creative, title: event.target.value })} disabled={!editable} placeholder="一键创作后仍可修改" /></label>
        <label>正文 <span>{creative.body.length} 字</span><textarea className="body-editor" value={creative.body} onChange={(event) => setCreative({ ...creative, body: event.target.value })} disabled={!editable} placeholder="AI 会生成完整正文，也可以在这里手工编辑。" /></label>
        <label>标签<input value={creative.tags.join(" ")} onChange={(event) => setCreative({ ...creative, tags: event.target.value.split(/[，,\s]+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean) })} disabled={!editable} placeholder="多个标签用空格分隔" /></label>
        <div className="editor-actions"><button className="outline" disabled={!editable || saving || creating || !creative.title || !creative.body} onClick={save}>{saving ? "保存中…" : "保存图文稿"}</button><button className="primary" disabled={busy || saving || creating || !editable || !creative.title || !creative.body} onClick={saveAndSubmit}>保存并提交审核</button></div>
      </section>
    </section>

    <aside className="panel visual-builder post-image-prompts">
      <div className="visual-builder-head"><div><span className="section-kicker">整篇视觉建议</span><h2>整个帖子的图片提示词</h2></div>{creative.image_prompts.length ? <button className="outline" onClick={copyImagePrompts}>复制全部提示词</button> : null}</div>
      <p className="post-prompts-intro">AI 根据完整标题和正文推荐一组独立成品图。每条提示词都描述整张图片，不是背景图、卡片模板或留字底图。</p>
      {creative.image_prompts.length ? <div className="post-prompt-list">{creative.image_prompts.map((item, index) => <article className="post-prompt-card" key={index + "-" + item.label}>
        <div className="post-prompt-head"><span>图片 {index + 1}</span><button className="ghost" disabled={!item.prompt} onClick={() => void navigator.clipboard.writeText(item.prompt).then(() => notify(item.label + "提示词已复制")).catch(() => notify("复制失败，请手动选择提示词"))}>复制</button></div>
        <label>图片用途<input value={item.label} disabled={!editable} maxLength={20} onChange={(event) => updateImagePrompt(index, { label: event.target.value })} /></label>
        <label>完整图片提示词<textarea value={item.prompt} disabled={!editable} maxLength={1200} onChange={(event) => updateImagePrompt(index, { prompt: event.target.value })} /></label>
      </article>)}</div> : <div className="visual-empty"><span>✦</span><h3>还没有图片提示词</h3><p>点击“开始一键创作”，AI 会根据整篇内容推荐封面主视觉、核心观点图和场景配图。</p></div>}
    </aside>
  </div></div>;
}

function Review({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [reviewFilter, setReviewFilter] = useState("pending");
  const [comments, setComments] = useState<Record<string, string>>({});
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
      <div className="tag-line">{claim.tags.map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div>
      {claim.status === "review" ? <div className="review-actions"><input value={comments[claim.id] || ""} onChange={(e) => setComments({ ...comments, [claim.id]: e.target.value })} placeholder="退回原因（通过时可不填）" /><button className="danger-outline" disabled={busy} onClick={() => action({ action: "review", id: claim.id, result: "reject", comment: comments[claim.id] }, "已退回修改")}>退回</button><button className="primary" disabled={busy} onClick={() => action({ action: "review", id: claim.id, result: "approve", comment: comments[claim.id] }, "审核已通过，已进入发布列表")}>通过并转入发布</button></div> : <div className="queue-note">{isRejected(claim) ? `退回意见：${claim.review_comment || "未填写原因"}` : `审核已通过 · 当前进度：${claim.status_label}`}</div>}
    </article>)}</div> : <Empty title={`${activeGroup.label}分类暂无内容`} text={reviewHistory.length ? "可以切换上方状态查看其他审核记录。" : "创作人员提交审核后，内容会出现在这里。"} />}
  </section>;
}

function Publish({ data, reload, notify }: { data: AppData; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [filter, setFilter] = useState<"pending" | "published">("pending");
  const [working, setWorking] = useState("");
  const [viewing, setViewing] = useState<Claim | null>(null);
  const pending = data.claims.filter((claim) => ["approved", "queued", "publishing", "failed"].includes(claim.status));
  const published = data.claims.filter((claim) => claim.status === "published");
  const items = filter === "pending" ? pending : published;

  async function uploadImages(claim: Claim, files: FileList | null) {
    if (!files?.length) return;
    if (files.length > 9) { notify("每篇笔记最多选择9张图片"); return; }
    setWorking(claim.id); notify("");
    try {
      const encoded = await Promise.all(Array.from(files).map(async (file) => ({ name: file.name, type: file.type, data: (await fileToDataUrl(file)).split(",")[1] || "" })));
      await jsonRequest("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upload_images", claim_id: claim.id, files: encoded }) });
      await reload(); notify(`已为“${claim.title || claim.topic_title}”准备 ${files.length} 张发布图片`);
    } catch (error) { notify(error instanceof Error ? error.message : "图片准备失败"); }
    finally { setWorking(""); }
  }

  async function publishNow(claim: Claim) {
    if (!window.confirm(`确认执行真实发布吗？\n\n发布账号：${claim.account_name}\n内容负责人：${claim.owner_name}\n发布操作人：${data.user.name}\n\n${claim.title || claim.topic_title}`)) return;
    setWorking(claim.id); notify("");
    try {
      await jsonRequest("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish_now", claim_id: claim.id }) });
      await reload(); notify("内容已通过小红书 MCP 发布成功");
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

  const frozen = viewing?.publish_snapshot;
  return <>
    <section className="panel data-panel publish-panel">
      <div className="panel-head publish-head"><div><h2>发布列表</h2><p>发布前同时确认小红书账号、内容负责人和实际发布工作人员</p></div><div className="publish-tabs"><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>未发布 {pending.length}</button><button className={filter === "published" ? "active" : ""} onClick={() => setFilter("published")}>已发布 {published.length}</button></div></div>
      {items.length ? <div className="publish-list">{items.map((claim) => <article className="publish-card" key={claim.id}>
        <div className="publish-card-main"><span className="account-avatar" style={{ background: claim.account_color }}>{claim.account_name.slice(0, 1)}</span><div><h3>{claim.publish_snapshot?.title || claim.title || claim.topic_title}</h3><p>发布账号 {claim.account_name} · 内容负责人 {claim.owner_name}</p><div className="tag-line">{(claim.publish_snapshot?.tags || claim.tags).map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div></div><button className="outline view-content-button" onClick={() => setViewing(claim)}>查看内容</button></div>
        <div className="publish-meta"><span className={`status ${toneFor(claim.status)}`}>{claim.status_label}</span><span>工作人员 {claim.publisher_name || `${data.user.name}（当前）`}</span><span>{claim.publish_images?.length || 0} 张配图</span><span>{claim.published_at ? `发布于 ${dateTime(claim.published_at)}` : `更新于 ${dateTime(claim.updated_at)}`}</span></div>
        {claim.publish_error ? <div className="publish-error">上次发布失败：{claim.publish_error}</div> : null}
        {filter === "pending" ? <div className="publish-actions"><span>本次发布操作人：{data.user.name}</span><button className="danger-outline" disabled={Boolean(working) || claim.status === "publishing"} onClick={() => returnForRevision(claim)}>退回修改</button><label className="outline upload-button">{working === claim.id ? "处理中…" : claim.publish_images?.length ? "重新选择图片" : "选择发布图片"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={Boolean(working)} onChange={(event) => { void uploadImages(claim, event.target.files); event.currentTarget.value = ""; }} /></label><button className="primary" disabled={Boolean(working) || !claim.publish_images?.length || claim.status === "publishing"} onClick={() => publishNow(claim)}>{working === claim.id || claim.status === "publishing" ? "发布处理中…" : claim.status === "failed" ? "确认后重新发布" : "确认并发布到小红书"}</button></div> : <div className="published-note">由 {claim.publisher_name || "工作人员未记录"} 发布；平台保留审核快照、账号和发布时间记录。</div>}
      </article>)}</div> : <Empty title={filter === "pending" ? "没有未发布内容" : "还没有已发布内容"} text={filter === "pending" ? "内容审核通过后会自动进入这里。" : "通过本页面成功发布的内容会保留在这里。"} />}
    </section>
    {viewing ? <div className="modal-backdrop"><section className="modal publish-preview-modal" role="dialog" aria-modal="true" aria-label="发布内容预览"><div className="publish-preview-head"><div><span className="section-kicker">审核冻结内容</span><h2>{frozen?.title || viewing.title || viewing.topic_title}</h2></div><button className="ghost" onClick={() => setViewing(null)} aria-label="关闭内容预览">×</button></div><div className="publish-preview-meta"><span>账号 {viewing.account_name}</span><span>负责人 {viewing.owner_name}</span><span>发布人 {viewing.publisher_name || (viewing.status === "published" ? "未记录" : data.user.name)}</span><span>{viewing.status_label}</span><span>{viewing.publish_images?.length || 0} 张配图</span>{frozen?.approved_at ? <span>审核于 {dateTime(frozen.approved_at)}</span> : null}</div><div className="publish-preview-body">{frozen?.body || viewing.body || "暂无正文"}</div><div className="tag-line publish-preview-tags">{(frozen?.tags || viewing.tags).map((tag) => <span key={tag}>#{tag.replace(/^#/, "")}</span>)}</div><div className="modal-actions"><button className="primary" onClick={() => setViewing(null)}>关闭</button></div></section></div> : null}
  </>;
}

function Accounts({ data, action, busy, reload, notify }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [qr, setQr] = useState<{ account: Account; image: string; text: string } | null>(null);

  async function xhs(account: Account, requestAction: "qrcode" | "status" | "profile") {
    setConnecting(account.id); notify("");
    try {
      const result = await jsonRequest("/api/xhs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: requestAction, account_id: account.id }) });
      if (requestAction === "qrcode") setQr({ account, image: result.image, text: result.text });
      else if (requestAction === "profile") { notify(`${account.name} 的账号概览已同步`); await reload(); }
      else { notify(result.unknown ? `${account.name} 的可见浏览器仍未完成页面加载，实时状态暂无法确认` : result.online ? `${account.name} 已登录，身份核验通过` : `${account.name} 尚未登录，请扫码`); await reload(); if (result.online) setQr(null); }
    } catch (error) { notify(error instanceof Error ? error.message : "连接小红书失败"); }
    finally { setConnecting(null); }
  }

  return <div className="page-stack"><div className="accounts-toolbar"><div><span className="section-kicker">真实账号记录</span><h2>{data.accounts.length ? `${data.accounts.length} 个小红书账号` : "还没有添加小红书账号"}</h2><p>登录和身份核验使用独立可见浏览器；爆款采集使用后台 MCP 运行槽，两者不会混用账号。</p></div>{data.user.roles.includes("admin") ? <button className="primary" onClick={() => setAdding(true)}>＋ 添加小红书账号</button> : null}</div>{data.accounts.length ? <div className="account-grid">{data.accounts.map((account) => <AccountOverview key={account.id} account={account} claims={data.claims.filter((claim) => claim.account_id === account.id)} connecting={connecting === account.id} xhs={xhs} />)}</div> : <section className="panel account-empty"><span>◎</span><h3>账号列表为空</h3><p>添加真实的小红书账号记录后，才会在工作台和选题认领中出现。</p>{data.user.roles.includes("admin") ? <button className="primary" onClick={() => setAdding(true)}>添加第一个账号</button> : null}</section>}{adding ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action({ action: "create_account", name: form.get("name") }, "小红书账号记录已添加"); setAdding(false); }}><span className="section-kicker">账号中心</span><h2>添加小红书账号</h2><label>账号备注名称<input name="name" required placeholder="例如：品牌主账号" /></label><p className="modal-help">无需填写端口。每个账号使用独立 Cookie；登录验证串行排队，后台采集使用两个共享槽位。</p><div className="modal-actions"><button type="button" className="ghost" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={busy}>添加账号</button></div></form></div> : null}{qr ? <div className="modal-backdrop"><section className="modal qr-modal"><span className="section-kicker">小红书扫码登录</span><h2>{qr.account.name}</h2><p>{qr.text}</p><div className="qr-image" role="img" aria-label={`${qr.account.name}的小红书登录二维码`} style={{ backgroundImage: `url(${qr.image})` }}></div><ol><li>平台会同时打开一个可见的小红书浏览器窗口</li><li>打开手机小红书 App，扫描二维码并确认登录</li><li>请在 5 分钟内点击“我已扫码”</li><li>系统核对用户ID后才会完成绑定</li></ol><div className="modal-actions"><button className="ghost" onClick={() => setQr(null)}>取消</button><button className="primary" disabled={connecting === qr.account.id} onClick={() => xhs(qr.account, "status")}>{connecting ? "核验身份中…" : "我已扫码，核验身份"}</button></div></section></div> : null}</div>;
}

function AccountOverview({ account, claims, connecting, xhs }: { account: Account; claims: Claim[]; connecting: boolean; xhs: (account: Account, action: "qrcode" | "status" | "profile") => Promise<void> }) {
  const inProgress = claims.filter((claim) => ["writing", "revision", "review"].includes(claim.status)).length;
  const waiting = claims.filter((claim) => ["approved", "queued", "publishing"].includes(claim.status)).length;
  const published = claims.filter((claim) => claim.status === "published").length;
  const value = (item?: string | number | null) => item === undefined || item === null || item === "" ? "暂无" : item;
  return <article className="panel account-card"><div className="account-profile-head"><span className="large-avatar" style={account.avatar_url ? { backgroundImage: `url(${account.avatar_url})` } : { background: account.color }}>{account.avatar_url ? "" : account.name.slice(0, 1)}</span><div><h2>{account.xhs_nickname || account.name}</h2><p>{account.xhs_red_id ? `小红书号 ${account.xhs_red_id}` : account.xhs_user_id ? `用户ID ${account.xhs_user_id}` : "尚未绑定小红书身份"}</p><small>{account.xhs_user_id ? "登录凭据已保存 · 实时状态需核验" : "尚未保存登录凭据"}</small></div><span className={`account-state ${["login_expired", "unknown", "error"].includes(account.status) ? "error" : ""}`}><i></i>{accountStatus[account.status] || account.status}</span></div><p className="account-bio">{account.profile_bio || (account.status === "online" ? "尚未同步账号简介" : "扫码登录后可读取真实账号概览")}</p><div className="xhs-stats"><span><strong>{value(account.following_count)}</strong>关注</span><span><strong>{value(account.followers_count)}</strong>粉丝</span><span><strong>{value(account.interaction_count)}</strong>获赞与收藏</span><span><strong>{value(account.note_count)}</strong>笔记</span></div><div className="platform-stats"><span>创作中 <strong>{inProgress}</strong></span><span>待发布 <strong>{waiting}</strong></span><span>已发布 <strong>{published}</strong></span></div><p className="sync-time">{account.profile_synced_at ? `账号数据同步于 ${dateTime(account.profile_synced_at)}` : "账号公开数据尚未同步"}</p><div className="account-buttons three"><button className="outline" disabled={connecting} onClick={() => xhs(account, "status")}>{connecting ? "可见核验中…" : "检查登录"}</button><button className="outline" disabled={connecting || account.status !== "online"} onClick={() => xhs(account, "profile")}>{connecting ? "读取中…" : "同步概览"}</button><button className="primary" disabled={connecting} onClick={() => xhs(account, "qrcode")}>{account.status === "online" ? "重新登录" : "扫码登录"}</button></div></article>;
}

function Logs({ data }: { data: AppData }) { return <section className="panel data-panel"><div className="panel-head"><div><h2>操作日志</h2><p>登录、创建、编辑、审核和发布操作全部留痕</p></div></div>{data.logs.length ? <div className="log-list">{data.logs.map((log) => <div key={log.id}><span className="log-dot"></span><div><strong>{log.actor_name} · {log.action}</strong><p>{log.detail || `${log.object_type} / ${log.object_type === "user" ? "工作人员" : log.object_type}`}</p></div><time>{dateTime(log.created_at)}</time></div>)}</div> : <Empty title="暂无操作记录" text="完成一次业务操作后，日志会自动产生。" />}</section>; }

function Settings({ data, action, busy }: { data: AppData; action: (payload: Record<string, unknown>, success: string) => void; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const isAdmin = data.user.roles.includes("admin");
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
    <section className="panel settings-card"><span className="section-kicker">运行方式</span><h2>本机团队模式</h2><dl><div><dt>数据存储</dt><dd>Mac mini 本地数据库</dd></div><div><dt>AI 创作</dt><dd>内置小红书运营专家</dd></div><div><dt>图卡导出</dt><dd>浏览器本地 PNG</dd></div><div><dt>发布并发</dt><dd>最多 2 个浏览器</dd></div><div><dt>公网访问</dt><dd>关闭</dd></div></dl></section>
    {adding ? <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); action({ action: "create_user", name: form.get("name"), username: form.get("username"), password: form.get("password"), role: form.get("role") }, "团队成员已添加"); setAdding(false); }}><span className="section-kicker">团队账号</span><h2>添加工作人员</h2><label>姓名<input name="name" required /></label><label>用户名<input name="username" required placeholder="字母、数字、下划线" /></label><label>初始密码<input name="password" type="password" required minLength={8} /></label><label>角色<select name="role"><option value="operator">内容运营</option><option value="reviewer">审核员</option><option value="publisher">发布员</option><option value="readonly">只读成员</option></select></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={busy}>创建账号</button></div></form></div> : null}
  </div>;
}

function Metric({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: number; note: string }) { return <article className={`metric-card metric-${tone}`}><span className={`metric-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></article>; }
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
function roleLabel(roles: string[]) { if (roles.includes("admin")) return "管理员"; if (roles.includes("reviewer")) return "审核员"; return "内容运营"; }
function dateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function dateOnly(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
