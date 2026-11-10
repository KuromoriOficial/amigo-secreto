CREATE TABLE `prank_event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sender_kind` text NOT NULL,
	`sender_name` text NOT NULL,
	`target_participant_id` text NOT NULL,
	`target_name` text NOT NULL,
	`target_nickname` text,
	`target_session_key` text NOT NULL,
	`target_tab_id` text NOT NULL,
	`target_epoch` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer
);
--> statement-breakpoint
CREATE INDEX `prank_event_delivery_idx` ON `prank_event` (`target_session_key`,`target_tab_id`,`target_epoch`,`claimed_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `prank_event_target_idx` ON `prank_event` (`target_participant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `prank_event_sender_idx` ON `prank_event` (`sender_kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `prank_offer` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_participant_id` text NOT NULL,
	`source_session_key` text NOT NULL,
	`source_tab_id` text NOT NULL,
	`source_epoch` integer NOT NULL,
	`target_participant_id` text NOT NULL,
	`target_session_key` text NOT NULL,
	`target_tab_id` text NOT NULL,
	`target_epoch` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prank_offer_source_idx` ON `prank_offer` (`source_participant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `prank_presence` (
	`session_key` text NOT NULL,
	`tab_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`epoch` integer NOT NULL,
	`visible` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `tab_id`)
);
--> statement-breakpoint
CREATE INDEX `prank_presence_live_idx` ON `prank_presence` (`visible`,`expires_at`);