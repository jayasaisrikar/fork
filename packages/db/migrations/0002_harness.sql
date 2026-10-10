CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branchId` text NOT NULL,
	`approvedPlanHash` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`revokedAt` text
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`runId` integer,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`refs` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branch_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branchId` text NOT NULL,
	`stepIndex` integer NOT NULL,
	`tool` text NOT NULL,
	`kind` text NOT NULL,
	`args` text NOT NULL,
	`capability` text
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` integer NOT NULL,
	`parentId` text,
	`version` integer NOT NULL,
	`label` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`source` text NOT NULL,
	`baseSnapshotHash` text NOT NULL,
	`actions` text NOT NULL,
	`projection` text,
	`feasibility` text,
	`risk` text,
	`approvedPlanHash` text,
	`status` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` text NOT NULL,
	`runId` integer NOT NULL,
	`branchId` text NOT NULL,
	`stepIndex` integer,
	`origin` text NOT NULL,
	`tool` text NOT NULL,
	`kind` text NOT NULL,
	`args` text NOT NULL,
	`requestedArgsHash` text NOT NULL,
	`verdict` text,
	`source` text,
	`errorClass` text,
	`message` text,
	`delegationId` text,
	`receiptId` text,
	`latencyMs` integer,
	`status` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` integer NOT NULL,
	`branchId` text NOT NULL,
	`kind` text NOT NULL,
	`approvedPlanHash` text NOT NULL,
	`armorPlanId` text NOT NULL,
	`armorPlanHash` text NOT NULL,
	`merkleRoot` text NOT NULL,
	`tokenId` text NOT NULL,
	`expiresAt` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`scenarioId` text NOT NULL,
	`baseSnapshotId` text NOT NULL,
	`actor` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`csrfToken` text NOT NULL,
	`expiresAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`hash` text NOT NULL,
	`state` text NOT NULL,
	`createdAt` text NOT NULL
);
