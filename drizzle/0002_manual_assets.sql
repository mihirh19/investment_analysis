CREATE TABLE `market_prices` (
	`key` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`prev_close` real,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`key` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	PRIMARY KEY(`key`, `date`)
);
