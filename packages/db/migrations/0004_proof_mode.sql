CREATE TABLE `proof_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attack` text NOT NULL,
	`startedAt` text NOT NULL,
	`finishedAt` text,
	`result` text,
	`integrityFailure` integer DEFAULT false NOT NULL,
	`clearedAt` text
);
--> statement-breakpoint
ALTER TABLE `approvals` ADD `origin` text DEFAULT 'human' NOT NULL;