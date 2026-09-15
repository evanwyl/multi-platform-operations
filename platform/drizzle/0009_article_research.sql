CREATE TABLE `article_research_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`source_url` text NOT NULL,
	`source_domain` text DEFAULT '' NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`matched_keywords` text DEFAULT '[]' NOT NULL,
	`search_engines` text DEFAULT '[]' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`detail_text` text DEFAULT '' NOT NULL,
	`published_at` text,
	`best_rank` integer DEFAULT 999 NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`trend_score` integer DEFAULT 0 NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`detail_error` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_research_samples_canonical_url_unique` ON `article_research_samples` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `idx_article_research_status_seen` ON `article_research_samples` (`status`,`last_seen_at`);
