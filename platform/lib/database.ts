import { env } from "cloudflare:workers";

export type DbUser = {
  id: string;
  name: string;
  username: string;
  roles: string;
  status: string;
};

export function database(): D1Database {
  if (!env.DB) throw new Error("本地数据库未配置");
  return env.DB;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '["operator"]',
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
    persona TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
    queue_count INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL,
    mcp_port INTEGER NOT NULL DEFAULT 18060, is_demo INTEGER NOT NULL DEFAULT 0,
    xhs_user_id TEXT, xhs_nickname TEXT,
    xhs_red_id TEXT, profile_bio TEXT, avatar_url TEXT,
    following_count TEXT, followers_count TEXT, interaction_count TEXT,
    note_count INTEGER, profile_synced_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '',
    relevance TEXT NOT NULL DEFAULT '中', status TEXT NOT NULL DEFAULT 'unclaimed',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, account_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'writing',
    title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
    review_comment TEXT NOT NULL DEFAULT '', reviewer_id TEXT, snapshot TEXT,
    creative_json TEXT NOT NULL DEFAULT '{}', creation_status TEXT NOT NULL DEFAULT 'idle',
    creation_error TEXT NOT NULL DEFAULT '', creation_prompt TEXT NOT NULL DEFAULT '',
    version_number INTEGER NOT NULL DEFAULT 0, generated_at TEXT,
    publish_images TEXT NOT NULL DEFAULT '[]', publish_error TEXT NOT NULL DEFAULT '', published_at TEXT, publisher_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(topic_id) REFERENCES topics(id), FOREIGN KEY(account_id) REFERENCES accounts(id),
    FOREIGN KEY(owner_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS claim_versions (
    id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, version_number INTEGER NOT NULL,
    source TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]', creative_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(claim_id) REFERENCES claims(id), FOREIGN KEY(created_by) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
    object_type TEXT NOT NULL, object_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trend_settings (
    id TEXT PRIMARY KEY, account_id TEXT,
    keywords TEXT NOT NULL DEFAULT '[]', exclude_keywords TEXT NOT NULL DEFAULT '[]',
    publish_time TEXT NOT NULL DEFAULT '一周内', sort_by TEXT NOT NULL DEFAULT '最多点赞', content_type TEXT NOT NULL DEFAULT 'image',
    last_scanned_at TEXT, next_allowed_at TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS trend_scans (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, keywords TEXT NOT NULL,
    request_text TEXT NOT NULL DEFAULT '', theme TEXT NOT NULL DEFAULT '', analysis_overview TEXT NOT NULL DEFAULT '',
    publish_time TEXT NOT NULL, sort_by TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'image', status TEXT NOT NULL,
    completed_keywords TEXT NOT NULL DEFAULT '[]', result_count INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS trend_samples (
    id TEXT PRIMARY KEY, feed_id TEXT NOT NULL UNIQUE, keyword TEXT NOT NULL,
    title TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '',
    note_type TEXT NOT NULL DEFAULT '', cover_url TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL,
    xsec_token TEXT NOT NULL DEFAULT '', detail_text TEXT NOT NULL DEFAULT '',
    content_summary TEXT NOT NULL DEFAULT '', sample_hooks TEXT NOT NULL DEFAULT '[]',
    sample_pain_point TEXT NOT NULL DEFAULT '', sample_structure TEXT NOT NULL DEFAULT '[]',
    matched_keywords TEXT NOT NULL DEFAULT '[]', original_tags TEXT NOT NULL DEFAULT '[]',
    liked_count TEXT NOT NULL DEFAULT '0', collected_count TEXT NOT NULL DEFAULT '0', comment_count TEXT NOT NULL DEFAULT '0', shared_count TEXT NOT NULL DEFAULT '',
    raw_heat_score REAL NOT NULL DEFAULT 0, heat_score INTEGER NOT NULL DEFAULT 0, published_at TEXT,
    title_hook TEXT NOT NULL DEFAULT '', visual_highlight TEXT NOT NULL DEFAULT '', emotion_pain TEXT NOT NULL DEFAULT '',
    practical_value TEXT NOT NULL DEFAULT '', controversy_point TEXT NOT NULL DEFAULT '', reusable_directions TEXT NOT NULL DEFAULT '[]', account_adaptation TEXT NOT NULL DEFAULT '',
    relevance_score INTEGER NOT NULL DEFAULT 0, information_density_score INTEGER NOT NULL DEFAULT 0, remix_value_score INTEGER NOT NULL DEFAULT 0, selection_reason TEXT NOT NULL DEFAULT '',
    selection_status TEXT NOT NULL DEFAULT 'candidate', processing_status TEXT NOT NULL DEFAULT 'pending', capture_outcome TEXT NOT NULL DEFAULT 'new', detail_error TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS topic_insights (
    topic_id TEXT PRIMARY KEY, brief TEXT NOT NULL DEFAULT '', target_audience TEXT NOT NULL DEFAULT '',
    pain_point TEXT NOT NULL DEFAULT '', hook_points TEXT NOT NULL DEFAULT '[]', content_structure TEXT NOT NULL DEFAULT '[]',
    why_it_works TEXT NOT NULL DEFAULT '', account_fit TEXT NOT NULL DEFAULT '', source_feed_ids TEXT NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    FOREIGN KEY(topic_id) REFERENCES topics(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
  `CREATE INDEX IF NOT EXISTS idx_topics_status_created ON topics(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_owner_status ON claims(owner_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_account_status ON claims(account_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_versions_claim_number ON claim_versions(claim_id, version_number)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_trend_samples_status_seen ON trend_samples(status, last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_trend_scans_started ON trend_scans(started_at)`,
];

let databaseInitialization: Promise<void> | null = null;

async function initializeDatabase() {
  const db = database();
  for (const statement of schemaStatements) await db.prepare(statement).run();
  const portColumn = await db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='mcp_port'").first();
  if (!portColumn) await db.prepare("ALTER TABLE accounts ADD COLUMN mcp_port INTEGER NOT NULL DEFAULT 18060").run();
  const demoColumn = await db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='is_demo'").first();
  if (!demoColumn) await db.prepare("ALTER TABLE accounts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0").run();
  const userIdColumn = await db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='xhs_user_id'").first();
  if (!userIdColumn) await db.prepare("ALTER TABLE accounts ADD COLUMN xhs_user_id TEXT").run();
  const nicknameColumn = await db.prepare("SELECT name FROM pragma_table_info('accounts') WHERE name='xhs_nickname'").first();
  if (!nicknameColumn) await db.prepare("ALTER TABLE accounts ADD COLUMN xhs_nickname TEXT").run();
  const profileColumns = [
    ["xhs_red_id", "TEXT"], ["profile_bio", "TEXT"], ["avatar_url", "TEXT"],
    ["following_count", "TEXT"], ["followers_count", "TEXT"], ["interaction_count", "TEXT"],
    ["note_count", "INTEGER"], ["profile_synced_at", "TEXT"],
  ] as const;
  for (const [name, type] of profileColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('accounts') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`).run();
  }
  const trendSampleColumns = [
    ["xsec_token", "TEXT NOT NULL DEFAULT ''"], ["detail_text", "TEXT NOT NULL DEFAULT ''"],
    ["heat_score", "INTEGER NOT NULL DEFAULT 0"], ["published_at", "TEXT"],
    ["content_summary", "TEXT NOT NULL DEFAULT ''"], ["sample_hooks", "TEXT NOT NULL DEFAULT '[]'"],
    ["sample_pain_point", "TEXT NOT NULL DEFAULT ''"], ["sample_structure", "TEXT NOT NULL DEFAULT '[]'"],
    ["matched_keywords", "TEXT NOT NULL DEFAULT '[]'"], ["original_tags", "TEXT NOT NULL DEFAULT '[]'"],
    ["shared_count", "TEXT NOT NULL DEFAULT ''"], ["raw_heat_score", "REAL NOT NULL DEFAULT 0"],
    ["title_hook", "TEXT NOT NULL DEFAULT ''"], ["visual_highlight", "TEXT NOT NULL DEFAULT ''"],
    ["emotion_pain", "TEXT NOT NULL DEFAULT ''"], ["practical_value", "TEXT NOT NULL DEFAULT ''"],
    ["controversy_point", "TEXT NOT NULL DEFAULT ''"], ["reusable_directions", "TEXT NOT NULL DEFAULT '[]'"],
    ["account_adaptation", "TEXT NOT NULL DEFAULT ''"], ["selection_status", "TEXT NOT NULL DEFAULT 'candidate'"],
    ["relevance_score", "INTEGER NOT NULL DEFAULT 0"], ["information_density_score", "INTEGER NOT NULL DEFAULT 0"],
    ["remix_value_score", "INTEGER NOT NULL DEFAULT 0"], ["selection_reason", "TEXT NOT NULL DEFAULT ''"],
    ["processing_status", "TEXT NOT NULL DEFAULT 'pending'"], ["capture_outcome", "TEXT NOT NULL DEFAULT 'new'"],
    ["detail_error", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, type] of trendSampleColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('trend_samples') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE trend_samples ADD COLUMN ${name} ${type}`).run();
  }
  const legacyTrendSamples = await db.prepare("SELECT id,keyword,detail_text,content_summary,heat_score FROM trend_samples WHERE matched_keywords='[]'").all();
  for (const sample of legacyTrendSamples.results) {
    const hasResearchData = Boolean(sample.detail_text || sample.content_summary || Number(sample.heat_score) > 0);
    await db.prepare("UPDATE trend_samples SET matched_keywords=?,selection_status=?,processing_status=? WHERE id=?")
      .bind(JSON.stringify(sample.keyword ? [String(sample.keyword)] : []), hasResearchData ? "selected" : "candidate", sample.detail_text ? "success" : "pending", sample.id).run();
  }
  const trendSettingsColumns = [["content_type", "TEXT NOT NULL DEFAULT 'image'"]] as const;
  for (const [name, type] of trendSettingsColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('trend_settings') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE trend_settings ADD COLUMN ${name} ${type}`).run();
  }
  const trendScanColumns = [["request_text", "TEXT NOT NULL DEFAULT ''"], ["theme", "TEXT NOT NULL DEFAULT ''"], ["analysis_overview", "TEXT NOT NULL DEFAULT ''"], ["content_type", "TEXT NOT NULL DEFAULT 'image'"]] as const;
  for (const [name, type] of trendScanColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('trend_scans') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE trend_scans ADD COLUMN ${name} ${type}`).run();
  }
  const claimCreativeColumns = [
    ["creative_json", "TEXT NOT NULL DEFAULT '{}'"], ["creation_status", "TEXT NOT NULL DEFAULT 'idle'"],
    ["creation_error", "TEXT NOT NULL DEFAULT ''"], ["creation_prompt", "TEXT NOT NULL DEFAULT ''"],
    ["version_number", "INTEGER NOT NULL DEFAULT 0"], ["generated_at", "TEXT"],
  ] as const;
  for (const [name, type] of claimCreativeColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('claims') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE claims ADD COLUMN ${name} ${type}`).run();
  }
  const claimPublishColumns = [
    ["publish_images", "TEXT NOT NULL DEFAULT '[]'"], ["publish_error", "TEXT NOT NULL DEFAULT ''"], ["published_at", "TEXT"], ["publisher_id", "TEXT"],
  ] as const;
  for (const [name, type] of claimPublishColumns) {
    const column = await db.prepare(`SELECT name FROM pragma_table_info('claims') WHERE name='${name}'`).first();
    if (!column) await db.prepare(`ALTER TABLE claims ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare(`UPDATE claims SET publisher_id=(SELECT actor_id FROM audit_logs
    WHERE object_type='claim' AND object_id=claims.id AND action='通过小红书MCP发布内容'
    ORDER BY created_at DESC LIMIT 1) WHERE publisher_id IS NULL AND status='published'`).run();
  await db.prepare("UPDATE accounts SET is_demo=1 WHERE id IN ('acc-work','acc-home','acc-beauty','acc-city','acc-food')").run();
  await db.prepare("UPDATE accounts SET status='login_expired' WHERE is_demo=0 AND xhs_user_id IS NULL AND status='online'").run();
  await db.prepare("DROP INDEX IF EXISTS idx_accounts_mcp_port_real").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_xhs_user_id ON accounts(xhs_user_id) WHERE xhs_user_id IS NOT NULL").run();
  await db.prepare("INSERT OR IGNORE INTO trend_settings (id,keywords,exclude_keywords,publish_time,sort_by,updated_at) VALUES ('default','[]','[]','一周内','最多点赞',?)")
    .bind(new Date().toISOString()).run();
  await db.prepare(`UPDATE trend_settings SET account_id=(SELECT id FROM accounts WHERE is_demo=0 LIMIT 1)
    WHERE id='default' AND account_id IS NULL AND (SELECT COUNT(*) FROM accounts WHERE is_demo=0)=1`).run();
  await db.prepare("PRAGMA optimize").run();
}

export async function ensureDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = initializeDatabase().catch((error) => {
      databaseInitialization = null;
      throw error;
    });
  }
  return databaseInitialization;
}

export async function audit(actorId: string, action: string, objectType: string, objectId: string, detail = "") {
  await database().prepare("INSERT INTO audit_logs (id,actor_id,action,object_type,object_id,detail,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actorId, action, objectType, objectId, detail, new Date().toISOString()).run();
}
