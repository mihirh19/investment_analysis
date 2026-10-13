CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`external_id` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_person_platform_kind_ext` ON `accounts` (`person_id`,`platform`,`kind`,`external_id`);--> statement-breakpoint
CREATE TABLE `holding_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`instrument_id` integer NOT NULL,
	`date` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real,
	`value` real,
	`cost` real,
	`source` text NOT NULL,
	`import_batch_id` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_unique` ON `holding_snapshots` (`account_id`,`instrument_id`,`date`,`source`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`person_id` integer NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL,
	`summary_json` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`isin` text,
	`name` text NOT NULL,
	`asset_class` text NOT NULL,
	`symbol_nse` text,
	`symbol_bse` text,
	`ticker_us` text,
	`amfi_code` text,
	`mf_type` text,
	`sector` text,
	`industry` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_isin` ON `instruments` (`isin`);--> statement-breakpoint
CREATE INDEX `instruments_symbol_nse` ON `instruments` (`symbol_nse`);--> statement-breakpoint
CREATE INDEX `instruments_ticker_us` ON `instruments` (`ticker_us`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`instrument_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`price` real,
	`amount` real DEFAULT 0 NOT NULL,
	`fees` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`external_id` text,
	`import_batch_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe` ON `transactions` (`account_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_instrument` ON `transactions` (`account_id`,`instrument_id`,`date`);