CREATE TABLE `article_research_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`sample_id` text NOT NULL,
	`platform` text NOT NULL,
	`matched_keywords` text DEFAULT '[]' NOT NULL,
	`search_engines` text DEFAULT '[]' NOT NULL,
	`best_rank` integer DEFAULT 999 NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`trend_score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`sample_id`) REFERENCES `article_research_samples`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_research_entries_sample_platform_unique` ON `article_research_entries` (`sample_id`,`platform`);
--> statement-breakpoint
CREATE INDEX `idx_article_research_entries_platform_status` ON `article_research_entries` (`platform`,`status`,`last_seen_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `article_research_entries`
(`id`,`sample_id`,`platform`,`matched_keywords`,`search_engines`,`best_rank`,`occurrence_count`,`relevance_score`,`trend_score`,`status`,`first_seen_at`,`last_seen_at`)
SELECT 'zhihu:' || `id`,`id`,'zhihu',`matched_keywords`,`search_engines`,`best_rank`,`occurrence_count`,`relevance_score`,`trend_score`,`status`,`first_seen_at`,`last_seen_at`
FROM `article_research_samples`;
