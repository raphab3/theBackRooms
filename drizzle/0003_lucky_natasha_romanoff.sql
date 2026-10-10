CREATE TABLE `leaderboard` (
	`profile` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`milliseconds` integer NOT NULL,
	`level` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_leaderboard_time` ON `leaderboard` (`milliseconds`,`updated_at`);