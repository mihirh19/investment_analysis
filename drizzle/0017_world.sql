CREATE TABLE `world_events` (
	`id` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `world_figures` (
	`metric` text NOT NULL,
	`iso3` text NOT NULL,
	`period` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`metric`, `iso3`, `period`)
);
--> statement-breakpoint
CREATE TABLE `world_freight` (
	`name` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`name`, `date`)
);
--> statement-breakpoint
CREATE TABLE `world_places` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`iso3` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`locode` text,
	`vessels` real
);
--> statement-breakpoint
CREATE TABLE `world_trade` (
	`partner` text NOT NULL,
	`partner_name` text NOT NULL,
	`flow` text NOT NULL,
	`cmd` text NOT NULL,
	`period` text NOT NULL,
	`value` real NOT NULL,
	`weight` real,
	PRIMARY KEY(`partner`, `flow`, `cmd`, `period`)
);
--> statement-breakpoint
CREATE TABLE `world_traffic` (
	`id` text NOT NULL,
	`date` text NOT NULL,
	`total` integer NOT NULL,
	`tanker` integer NOT NULL,
	`container` integer NOT NULL,
	`dry_bulk` integer NOT NULL,
	`imports` real,
	`exports` real,
	PRIMARY KEY(`id`, `date`)
);
