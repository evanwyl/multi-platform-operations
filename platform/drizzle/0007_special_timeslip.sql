CREATE TABLE `claim_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`source` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`creative_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_claim_versions_claim_number` ON `claim_versions` (`claim_id`,`version_number`);