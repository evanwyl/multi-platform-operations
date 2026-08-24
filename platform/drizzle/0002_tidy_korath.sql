DROP INDEX `idx_accounts_mcp_port_real`;--> statement-breakpoint
ALTER TABLE `accounts` ADD `xhs_user_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `xhs_nickname` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_xhs_user_id` ON `accounts` (`xhs_user_id`);