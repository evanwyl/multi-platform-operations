ALTER TABLE `accounts` ADD `platform` text DEFAULT 'xiaohongshu' NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `external_user_id` text;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `external_display_name` text;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `auth_method` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `identity_verified_at` text;
--> statement-breakpoint
ALTER TABLE `topics` ADD `platform` text DEFAULT 'xiaohongshu' NOT NULL;
--> statement-breakpoint
ALTER TABLE `topics` ADD `source_type` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `topics` ADD `source_external_id` text;
--> statement-breakpoint
ALTER TABLE `claims` ADD `content_type` text DEFAULT 'xiaohongshu_note' NOT NULL;
--> statement-breakpoint
ALTER TABLE `claims` ADD `external_content_id` text;
--> statement-breakpoint
ALTER TABLE `claims` ADD `published_url` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_platform_external_user` ON `accounts` (`platform`,`external_user_id`);
