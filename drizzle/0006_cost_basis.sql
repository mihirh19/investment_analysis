CREATE TABLE `cost_basis` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`account_id` integer DEFAULT 0 NOT NULL,
	`instrument_id` integer NOT NULL,
	`avg_cost` real NOT NULL,
	`quantity` real,
	`as_of` text NOT NULL,
	`source` text NOT NULL,
	`import_batch_id` integer,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_basis_unique` ON `cost_basis` (`person_id`,`account_id`,`instrument_id`,`source`);