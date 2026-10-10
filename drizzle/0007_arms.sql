CREATE TABLE `arms` (
	`key_hash` text NOT NULL,
	`element` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`upgrade_id` text,
	PRIMARY KEY(`key_hash`, `element`)
);
