CREATE TABLE `research_fundamentals` (
	`symbol` text PRIMARY KEY NOT NULL,
	`filings` integer NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_indices` (
	`name` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	`prev_close` real,
	`high_52` real,
	`low_52` real
);
