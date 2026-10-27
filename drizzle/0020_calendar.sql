CREATE TABLE `research_actions` (
	`symbol` text NOT NULL,
	`ex_date` text NOT NULL,
	`subject` text NOT NULL,
	`record_date` text,
	`kind` text NOT NULL,
	`amount` real,
	PRIMARY KEY(`symbol`, `ex_date`, `subject`)
);
--> statement-breakpoint
CREATE INDEX `research_actions_ex` ON `research_actions` (`ex_date`);--> statement-breakpoint
CREATE TABLE `research_events` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`purpose` text NOT NULL,
	`company` text NOT NULL,
	`details` text NOT NULL,
	PRIMARY KEY(`symbol`, `date`, `purpose`)
);
--> statement-breakpoint
CREATE INDEX `research_events_date` ON `research_events` (`date`);