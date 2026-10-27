CREATE TABLE `research_industry` (
	`symbol` text PRIMARY KEY NOT NULL,
	`macro` text,
	`sector` text,
	`industry` text,
	`basic_industry` text,
	`sector_index` text,
	`sector_pe` real,
	`symbol_pe` real,
	`indices_json` text,
	`listed_on` text,
	`checked_at` text NOT NULL
);
