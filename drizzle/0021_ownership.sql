CREATE TABLE `research_shp` (
	`symbol` text NOT NULL,
	`as_of` text NOT NULL,
	`promoter` real,
	`url` text,
	`filed_at` text,
	`detail_json` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`symbol`, `as_of`)
);
--> statement-breakpoint
CREATE INDEX `research_shp_filed` ON `research_shp` (`filed_at`);--> statement-breakpoint
CREATE TABLE `research_shp_checked` (
	`symbol` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL
);
