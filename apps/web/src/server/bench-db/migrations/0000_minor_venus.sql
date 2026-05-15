CREATE TABLE `recalls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`turn_id` integer NOT NULL,
	`engine` text NOT NULL,
	`query` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`fragments_json` text NOT NULL,
	`raw_json` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recalls_engine_idx` ON `recalls` (`engine`);--> statement-breakpoint
CREATE TABLE `retains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`turn_id` integer NOT NULL,
	`engine` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`raw_json` text NOT NULL,
	`error` text,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `retains_engine_idx` ON `retains` (`engine`);--> statement-breakpoint
CREATE TABLE `session_meta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`model_chat` text NOT NULL,
	`model_extraction` text NOT NULL,
	`active_engine_locked` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`turn_id` integer NOT NULL,
	`engine` text NOT NULL,
	`kind` text DEFAULT 'post' NOT NULL,
	`taken_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`data_json` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshots_engine_idx` ON `snapshots` (`engine`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`user_content` text NOT NULL,
	`assistant_content` text NOT NULL,
	`active_engine` text NOT NULL
);
