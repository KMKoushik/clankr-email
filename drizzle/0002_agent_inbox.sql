CREATE TABLE `inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`canonical_local_part` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_canonical_local_part_unique` ON `inbox` (`canonical_local_part`);
--> statement-breakpoint
CREATE INDEX `inbox_user_id_idx` ON `inbox` (`user_id`);
--> statement-breakpoint
CREATE TABLE `inbox_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`local_part` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_alias_local_part_unique` ON `inbox_alias` (`local_part`);
--> statement-breakpoint
CREATE INDEX `inbox_alias_inbox_id_idx` ON `inbox_alias` (`inbox_id`);
--> statement-breakpoint
CREATE TABLE `email_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`subject` text NOT NULL,
	`normalized_subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_thread_inbox_id_idx` ON `email_thread` (`inbox_id`);
--> statement-breakpoint
CREATE INDEX `email_thread_last_message_at_idx` ON `email_thread` (`last_message_at`);
--> statement-breakpoint
CREATE INDEX `email_thread_normalized_subject_idx` ON `email_thread` (`normalized_subject`);
--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`direction` text NOT NULL,
	`provider_message_id` text,
	`internet_message_id` text,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`cc_addresses` text DEFAULT '[]' NOT NULL,
	`bcc_addresses` text DEFAULT '[]' NOT NULL,
	`subject` text NOT NULL,
	`text_body` text,
	`html_body` text,
	`snippet` text DEFAULT '' NOT NULL,
	`in_reply_to` text,
	`references` text DEFAULT '[]' NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`raw_email_r2_key` text,
	`raw_size` integer DEFAULT 0 NOT NULL,
	`delivery_status` text DEFAULT 'received' NOT NULL,
	`sent_at` integer,
	`received_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_message_thread_id_idx` ON `email_message` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `email_message_inbox_id_idx` ON `email_message` (`inbox_id`);
--> statement-breakpoint
CREATE INDEX `email_message_created_at_idx` ON `email_message` (`created_at`);
--> statement-breakpoint
CREATE INDEX `email_message_internet_message_id_idx` ON `email_message` (`internet_message_id`);
--> statement-breakpoint
CREATE TABLE `email_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`disposition` text DEFAULT 'attachment' NOT NULL,
	`content_id` text,
	`r2_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_attachment_message_id_idx` ON `email_attachment` (`message_id`);
--> statement-breakpoint
CREATE INDEX `email_attachment_inbox_id_idx` ON `email_attachment` (`inbox_id`);
--> statement-breakpoint
CREATE TABLE `webhook_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inbox_id` text,
	`target_url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '["*"]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_subscription_user_id_idx` ON `webhook_subscription` (`user_id`);
--> statement-breakpoint
CREATE INDEX `webhook_subscription_inbox_id_idx` ON `webhook_subscription` (`inbox_id`);
--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_response_status` integer,
	`last_error` text,
	`next_attempt_at` integer,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscription`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_subscription_id_idx` ON `webhook_delivery` (`subscription_id`);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_next_attempt_at_idx` ON `webhook_delivery` (`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_status_idx` ON `webhook_delivery` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_subscription_event_unique` ON `webhook_delivery` (`subscription_id`,`event_id`);
--> statement-breakpoint
CREATE TABLE `email_event` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text,
	`thread_id` text,
	`message_id` text,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_event_inbox_id_idx` ON `email_event` (`inbox_id`);
--> statement-breakpoint
CREATE INDEX `email_event_event_type_idx` ON `email_event` (`event_type`);
--> statement-breakpoint
CREATE INDEX `email_event_created_at_idx` ON `email_event` (`created_at`);
--> statement-breakpoint
CREATE TABLE `suppression_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_entry_email_unique` ON `suppression_entry` (`email`);
