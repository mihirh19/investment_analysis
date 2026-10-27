CREATE TABLE `alert_events` (
	`key` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`symbol` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alert_events_at` ON `alert_events` (`at`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`note` text,
	`active` integer DEFAULT true NOT NULL,
	`fired_at` text,
	`created_at` text NOT NULL
);
