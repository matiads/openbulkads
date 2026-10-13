CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account` text NOT NULL,
	`name` text NOT NULL,
	`configuration` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `presets_owner_account` ON `presets` (`owner`,`account`);