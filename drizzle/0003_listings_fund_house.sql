CREATE TABLE `nse_listings` (
	`isin` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`kind` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `instruments` ADD `fund_house` text;