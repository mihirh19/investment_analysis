CREATE TABLE `price_daily` (
	`key` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	PRIMARY KEY(`key`, `date`)
);
