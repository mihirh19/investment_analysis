CREATE TABLE `research_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`company` text NOT NULL,
	`at` text NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`text` text NOT NULL,
	`url` text
);
--> statement-breakpoint
CREATE INDEX `research_ann_symbol` ON `research_announcements` (`symbol`,`at`);--> statement-breakpoint
CREATE INDEX `research_ann_at` ON `research_announcements` (`at`);