CREATE TABLE `world_runs` (
	`code` text PRIMARY KEY NOT NULL,
	`nights` integer NOT NULL,
	`won` integer DEFAULT 0 NOT NULL,
	`team` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `world_runs_rank` ON `world_runs` (`won`, `nights`, `duration_ms`);
