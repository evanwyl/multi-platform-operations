CREATE TABLE `trend_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`keyword` text NOT NULL,
	`title` text NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`author_id` text DEFAULT '' NOT NULL,
	`note_type` text DEFAULT '' NOT NULL,
	`cover_url` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`liked_count` text DEFAULT '0' NOT NULL,
	`collected_count` text DEFAULT '0' NOT NULL,
	`comment_count` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trend_samples_feed_id_unique` ON `trend_samples` (`feed_id`);--> statement-breakpoint
CREATE INDEX `idx_trend_samples_status_seen` ON `trend_samples` (`status`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `trend_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`keywords` text NOT NULL,
	`publish_time` text NOT NULL,
	`sort_by` text NOT NULL,
	`status` text NOT NULL,
	`completed_keywords` text DEFAULT '[]' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_trend_scans_started` ON `trend_scans` (`started_at`);--> statement-breakpoint
CREATE TABLE `trend_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`keywords` text DEFAULT '[]' NOT NULL,
	`exclude_keywords` text DEFAULT '[]' NOT NULL,
	`publish_time` text DEFAULT '一周内' NOT NULL,
	`sort_by` text DEFAULT '最多点赞' NOT NULL,
	`last_scanned_at` text,
	`next_allowed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
