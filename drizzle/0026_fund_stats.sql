CREATE TABLE `fund_stats` (
	`code` text PRIMARY KEY NOT NULL,
	`metrics_json` text,
	`months_json` text NOT NULL,
	`index_symbol` text,
	`computed_at` text NOT NULL,
	`error` text
);
