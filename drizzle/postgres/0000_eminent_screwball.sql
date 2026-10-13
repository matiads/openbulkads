CREATE TABLE "connections" (
	"owner" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"name" text NOT NULL,
	"cooldown" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"state" text NOT NULL,
	"status" text NOT NULL,
	"created" bigint NOT NULL,
	"updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"account" text NOT NULL,
	"name" text NOT NULL,
	"configuration" text NOT NULL,
	"created" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"owner" text PRIMARY KEY NOT NULL,
	"app_id" text,
	"app_secret" text,
	"selected_accounts" text,
	"token_metadata" text
);
--> statement-breakpoint
CREATE INDEX "jobs_owner_created" ON "jobs" USING btree ("owner","created");--> statement-breakpoint
CREATE INDEX "presets_owner_account" ON "presets" USING btree ("owner","account");