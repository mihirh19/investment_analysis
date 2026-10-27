CREATE TABLE `farm_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`scheme` text NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`note` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
