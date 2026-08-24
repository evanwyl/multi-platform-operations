CREATE TABLE `topic_insights` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`target_audience` text DEFAULT '' NOT NULL,
	`pain_point` text DEFAULT '' NOT NULL,
	`hook_points` text DEFAULT '[]' NOT NULL,
	`content_structure` text DEFAULT '[]' NOT NULL,
	`why_it_works` text DEFAULT '' NOT NULL,
	`account_fit` text DEFAULT '' NOT NULL,
	`source_feed_ids` text DEFAULT '[]' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `trend_samples` ADD `xsec_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trend_samples` ADD `detail_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trend_scans` ADD `request_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trend_scans` ADD `theme` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trend_scans` ADD `analysis_overview` text DEFAULT '' NOT NULL;