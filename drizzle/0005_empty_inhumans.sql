CREATE TABLE `custom_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`author` text NOT NULL,
	`data` text NOT NULL,
	`published_data` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_custom_maps_owner` ON `custom_maps` (`owner`);--> statement-breakpoint
CREATE INDEX `idx_custom_maps_updated` ON `custom_maps` (`updated_at`);