CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`sender` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`text` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_message_request` ON `chat_messages` (`sender`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_message_sender_created` ON `chat_messages` (`sender`,`created`);--> statement-breakpoint
CREATE INDEX `idx_chat_message_created` ON `chat_messages` (`created`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_seen` ON `chat_sessions` (`seen`);