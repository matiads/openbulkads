CREATE TABLE `settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`app_secret` text,
	`selected_accounts` text,
	`token_metadata` text
);
