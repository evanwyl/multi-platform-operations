ALTER TABLE claims ADD COLUMN wechat_theme TEXT NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE claims ADD COLUMN wechat_style TEXT NOT NULL DEFAULT '{}';
