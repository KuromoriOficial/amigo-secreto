CREATE TABLE `event` (
	`id` integer PRIMARY KEY NOT NULL,
	`drawn` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`photo` text NOT NULL,
	`position` integer NOT NULL,
	`code` text,
	`recipient_id` text,
	`unavailable_days` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_code_unique` ON `participant` (`code`);