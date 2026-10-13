CREATE TABLE `market_caps` (
	`isin` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`rank` integer,
	`avg_cap_cr` real,
	`period` text NOT NULL,
	`updated_at` text NOT NULL
);
