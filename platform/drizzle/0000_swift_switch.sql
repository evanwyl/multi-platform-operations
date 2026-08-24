CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`queue_count` integer DEFAULT 0 NOT NULL,
	`color` text NOT NULL,
	`mcp_port` integer DEFAULT 18060 NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
