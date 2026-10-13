CREATE TABLE `dividends` (
	`instrument_id` integer NOT NULL,
	`ex_date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`instrument_id`, `ex_date`),
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fund_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund_instrument_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`isin` text,
	`sector` text,
	`industry_raw` text,
	`asset_type` text NOT NULL,
	`country` text,
	`weight` real NOT NULL,
	`import_batch_id` integer,
	FOREIGN KEY (`fund_instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fund_holdings_fund` ON `fund_holdings` (`fund_instrument_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `fx_history` (
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`rate` real NOT NULL,
	PRIMARY KEY(`pair`, `date`)
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`pair` text PRIMARY KEY NOT NULL,
	`rate` real NOT NULL,
	`prev_close` real,
	`as_of` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`instrument_id` integer PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`prev_close` real,
	`currency` text NOT NULL,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sector_map` (
	`isin` text PRIMARY KEY NOT NULL,
	`symbol` text,
	`name` text,
	`industry` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `meta_json` text;--> statement-breakpoint
ALTER TABLE `instruments` ADD `yahoo_symbol` text;--> statement-breakpoint
ALTER TABLE `instruments` ADD `nps_code` text;--> statement-breakpoint
ALTER TABLE `instruments` ADD `mf_category` text;--> statement-breakpoint
ALTER TABLE `instruments` ADD `meta_updated_at` text;