CREATE TABLE `explorer_missions` (
	`profile` text NOT NULL,
	`key` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`profile`, `key`)
);
