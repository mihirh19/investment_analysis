CREATE TABLE `company_notes` (
	`symbol` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_bar_days` (
	`date` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`rows` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_bars` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real NOT NULL,
	`prev_close` real,
	`volume` real,
	`deliv_pct` real,
	PRIMARY KEY(`symbol`, `date`)
);
--> statement-breakpoint
CREATE INDEX `research_bars_date` ON `research_bars` (`date`);--> statement-breakpoint
CREATE TABLE `research_technicals` (
	`symbol` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`symbols_json` text DEFAULT '[]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
