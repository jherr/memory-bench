CREATE TABLE `tanmemory_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`superseded_by` integer
);
--> statement-breakpoint
CREATE INDEX `tanmemory_memories_active_idx` ON `tanmemory_memories` (`superseded_by`);