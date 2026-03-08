CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`provider_message_id` text,
	`internet_message_id` text,
	`from_email` text NOT NULL,
	`to_emails_json` text DEFAULT '[]' NOT NULL,
	`cc_emails_json` text DEFAULT '[]' NOT NULL,
	`bcc_emails_json` text DEFAULT '[]' NOT NULL,
	`subject` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`text_body` text,
	`html_body` text,
	`body_storage_mode` text DEFAULT 'inline' NOT NULL,
	`raw_mime_r2_key` text,
	`oversized_body_r2_key` text,
	`body_size_bytes` integer,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`sent_at` integer,
	`received_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_messages_inbox_id_idx` ON `email_messages` (`inbox_id`);--> statement-breakpoint
CREATE INDEX `email_messages_thread_id_idx` ON `email_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `email_messages_provider_message_id_idx` ON `email_messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `email_messages_internet_message_id_idx` ON `email_messages` (`internet_message_id`);--> statement-breakpoint
CREATE TABLE `email_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`subject_normalized` text NOT NULL,
	`participant_hash` text NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_threads_inbox_id_idx` ON `email_threads` (`inbox_id`);--> statement-breakpoint
CREATE INDEX `email_threads_last_message_at_idx` ON `email_threads` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`default_local_part` text NOT NULL,
	`custom_local_part` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inboxes_user_id_idx` ON `inboxes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_default_local_part_unique` ON `inboxes` (`default_local_part`);--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_custom_local_part_unique` ON `inboxes` (`custom_local_part`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`response_status` integer,
	`next_retry_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_subscription_id_idx` ON `webhook_deliveries` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event_id_idx` ON `webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_next_retry_at_idx` ON `webhook_deliveries` (`next_retry_at`);--> statement-breakpoint
CREATE TABLE `webhook_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inbox_id` text,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`event_types_json` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_subscriptions_user_id_idx` ON `webhook_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `webhook_subscriptions_inbox_id_idx` ON `webhook_subscriptions` (`inbox_id`);--> statement-breakpoint
DROP TABLE `todos`;
