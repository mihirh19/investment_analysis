CREATE TABLE `farm_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`cost_kind` text,
	`quantity_qtl` real,
	`rate` real,
	`amount` real DEFAULT 0 NOT NULL,
	`charges` real,
	`mandi` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `farm_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `farm_entries_season` ON `farm_entries` (`season_id`);--> statement-breakpoint
CREATE TABLE `farm_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`crop` text NOT NULL,
	`season` text NOT NULL,
	`year` integer NOT NULL,
	`field` text,
	`area_acres` real,
	`sown_on` text,
	`expected_qtl` real,
	`status` text NOT NULL,
	`market` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
