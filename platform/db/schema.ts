import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  persona: text("persona").notNull().default(""),
  audience: text("audience").notNull().default(""),
  queueCount: integer("queue_count").notNull().default(0),
  color: text("color").notNull(),
  mcpPort: integer("mcp_port").notNull().default(18060),
  isDemo: integer("is_demo").notNull().default(0),
  xhsUserId: text("xhs_user_id"),
  xhsNickname: text("xhs_nickname"),
  xhsRedId: text("xhs_red_id"),
  profileBio: text("profile_bio"),
  avatarUrl: text("avatar_url"),
  followingCount: text("following_count"),
  followersCount: text("followers_count"),
  interactionCount: text("interaction_count"),
  noteCount: integer("note_count"),
  profileSyncedAt: text("profile_synced_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_accounts_xhs_user_id").on(table.xhsUserId),
]);

export const trendSettings = sqliteTable("trend_settings", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id),
  keywords: text("keywords").notNull().default("[]"),
  excludeKeywords: text("exclude_keywords").notNull().default("[]"),
  publishTime: text("publish_time").notNull().default("一周内"),
  sortBy: text("sort_by").notNull().default("最多点赞"),
  lastScannedAt: text("last_scanned_at"),
  nextAllowedAt: text("next_allowed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const trendScans = sqliteTable("trend_scans", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  keywords: text("keywords").notNull(),
  requestText: text("request_text").notNull().default(""),
  theme: text("theme").notNull().default(""),
  analysisOverview: text("analysis_overview").notNull().default(""),
  publishTime: text("publish_time").notNull(),
  sortBy: text("sort_by").notNull(),
  status: text("status").notNull(),
  completedKeywords: text("completed_keywords").notNull().default("[]"),
  resultCount: integer("result_count").notNull().default(0),
  error: text("error").notNull().default(""),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("idx_trend_scans_started").on(table.startedAt)]);

export const trendSamples = sqliteTable("trend_samples", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").notNull().unique(),
  keyword: text("keyword").notNull(),
  title: text("title").notNull(),
  authorName: text("author_name").notNull().default(""),
  authorId: text("author_id").notNull().default(""),
  noteType: text("note_type").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  sourceUrl: text("source_url").notNull(),
  xsecToken: text("xsec_token").notNull().default(""),
  detailText: text("detail_text").notNull().default(""),
  likedCount: text("liked_count").notNull().default("0"),
  collectedCount: text("collected_count").notNull().default("0"),
  commentCount: text("comment_count").notNull().default("0"),
  heatScore: integer("heat_score").notNull().default(0),
  publishedAt: text("published_at"),
  status: text("status").notNull().default("new"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [index("idx_trend_samples_status_seen").on(table.status, table.lastSeenAt)]);

export const topicInsights = sqliteTable("topic_insights", {
  topicId: text("topic_id").primaryKey(),
  brief: text("brief").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  painPoint: text("pain_point").notNull().default(""),
  hookPoints: text("hook_points").notNull().default("[]"),
  contentStructure: text("content_structure").notNull().default("[]"),
  whyItWorks: text("why_it_works").notNull().default(""),
  accountFit: text("account_fit").notNull().default(""),
  sourceFeedIds: text("source_feed_ids").notNull().default("[]"),
  score: integer("score").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const claimVersions = sqliteTable("claim_versions", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  source: text("source").notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  creativeJson: text("creative_json").notNull().default("{}"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_claim_versions_claim_number").on(table.claimId, table.versionNumber),
]);
