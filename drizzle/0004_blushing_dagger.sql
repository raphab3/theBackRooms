CREATE TABLE `campaign_leaderboard` (
	`profile` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`milliseconds` integer NOT NULL,
	`level` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_leaderboard_time` ON `campaign_leaderboard` (`milliseconds`,`updated_at`);