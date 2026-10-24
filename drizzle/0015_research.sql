CREATE TABLE `research_companies` (
	`symbol` text PRIMARY KEY NOT NULL,
	`checked_at` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `research_filings` (
	`symbol` text NOT NULL,
	`period_end` text NOT NULL,
	`basis` text NOT NULL,
	`url` text NOT NULL,
	`filed_at` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`data_json` text,
	PRIMARY KEY(`symbol`, `period_end`, `basis`)
);
--> statement-breakpoint
CREATE INDEX `research_filings_status` ON `research_filings` (`status`);--> statement-breakpoint
CREATE TABLE `research_quotes` (
	`symbol` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real NOT NULL,
	`prev_close` real,
	`high_52` real,
	`low_52` real,
	`volume` real,
	`mcap` real,
	`pe` real
);
