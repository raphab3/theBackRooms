CREATE TABLE `players` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventories` (
	`key_hash` text NOT NULL,
	`item` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key_hash`, `item`)
);
--> statement-breakpoint
CREATE TABLE `expeditions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`level` text NOT NULL,
	`result` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`loot` text NOT NULL,
	`created_at` integer NOT NULL
);
