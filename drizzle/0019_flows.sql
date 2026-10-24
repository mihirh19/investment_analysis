CREATE TABLE `flow_cash` (
	`date` text NOT NULL,
	`category` text NOT NULL,
	`buy` real NOT NULL,
	`sell` real NOT NULL,
	`net` real NOT NULL,
	PRIMARY KEY(`date`, `category`)
);
--> statement-breakpoint
CREATE TABLE `flow_deals` (
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`symbol` text NOT NULL,
	`company` text NOT NULL,
	`client` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`price` real NOT NULL,
	PRIMARY KEY(`date`, `kind`, `symbol`, `client`, `side`, `qty`, `price`)
);
--> statement-breakpoint
CREATE INDEX `flow_deals_symbol` ON `flow_deals` (`symbol`);--> statement-breakpoint
CREATE TABLE `flow_fetched` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_fo` (
	`date` text NOT NULL,
	`client` text NOT NULL,
	`data_json` text NOT NULL,
	PRIMARY KEY(`date`, `client`)
);
--> statement-breakpoint
CREATE TABLE `flow_fpi` (
	`month` text PRIMARY KEY NOT NULL,
	`equity` real NOT NULL,
	`debt` real NOT NULL,
	`hybrid` real NOT NULL,
	`mutual_funds` real NOT NULL,
	`aif` real NOT NULL,
	`total` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_mf` (
	`month` text NOT NULL,
	`category` text NOT NULL,
	`grp` text NOT NULL,
	`schemes` integer NOT NULL,
	`folios` integer NOT NULL,
	`raised` real NOT NULL,
	`redeemed` real NOT NULL,
	`net` real NOT NULL,
	`aum` real,
	PRIMARY KEY(`month`, `grp`, `category`)
);
--> statement-breakpoint
CREATE TABLE `flow_stakes` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`symbol` text NOT NULL,
	`company` text NOT NULL,
	`party` text NOT NULL,
	`side` text NOT NULL,
	`shares` real,
	`change_pct` real,
	`after_pct` real,
	`mode` text,
	`promoter` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flow_stakes_date` ON `flow_stakes` (`date`);