CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`vendorId` text NOT NULL,
	`amountCents` integer NOT NULL,
	`paidCents` integer NOT NULL,
	`dueDate` text NOT NULL,
	`feeKind` text NOT NULL,
	`feeValue` integer NOT NULL,
	`criticality` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `ledger_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entryId` text NOT NULL,
	`scenarioId` text NOT NULL,
	`account` text NOT NULL,
	`amountCents` integer NOT NULL,
	`receiptId` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`from` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`receivedAt` text NOT NULL,
	`untrusted` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`vendorId` text NOT NULL,
	`recipientId` text NOT NULL,
	`amountCents` integer NOT NULL,
	`currency` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`capabilityId` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_idempotencyKey_unique` ON `receipts` (`idempotencyKey`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`today` text NOT NULL,
	`reserveCents` integer NOT NULL,
	`holdAboveCents` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `used_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`usedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`name` text NOT NULL,
	`recipientId` text NOT NULL,
	`approved` integer NOT NULL
);
