CREATE TABLE `spend_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`kind` text NOT NULL,
	`institution` text NOT NULL,
	`name` text NOT NULL,
	`last4` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spend_txns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`statement_id` integer NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`merchant` text,
	`amount` real NOT NULL,
	`category` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`is_emi` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `spend_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statement_id`) REFERENCES `statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `spend_txns_account_date` ON `spend_txns` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`period_from` text,
	`period_to` text,
	`statement_date` text,
	`due_date` text,
	`total_due` real,
	`minimum_due` real,
	`credit_limit` real,
	`opening_balance` real,
	`closing_balance` real,
	`reward_points` real,
	`source` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `spend_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statements_fingerprint` ON `statements` (`fingerprint`);