CREATE TABLE `ai_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`user_request` text,
	`status` text NOT NULL,
	`provider` text,
	`model` text,
	`context` text,
	`total_tokens` integer,
	`total_cost` real,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ix_runs_started` ON `ai_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `ai_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_index` integer NOT NULL,
	`type` text NOT NULL,
	`tool_name` text,
	`input` text,
	`output` text,
	`status` text NOT NULL,
	`latency_ms` integer,
	`token_usage` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_step_run_idx` ON `ai_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`media_asset_id` integer,
	`chat_id` integer,
	`actor` text NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_audit_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `ix_audit_asset` ON `audit_events` (`media_asset_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`dedupe_key` text,
	`available_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_jobs_poll` ON `jobs` (`status`,`available_at`,`priority`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_jobs_active` ON `jobs` (`type`,`dedupe_key`) WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE TABLE `media_annotation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_asset_id` integer NOT NULL,
	`user_id` text,
	`raw_text` text NOT NULL,
	`parsed_intent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_ann_asset` ON `media_annotation` (`media_asset_id`);--> statement-breakpoint
CREATE TABLE `media_asset` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_unique_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`canonical_title` text,
	`type` text NOT NULL,
	`mime` text,
	`size` integer NOT NULL,
	`duration_sec` integer,
	`width` integer,
	`height` integer,
	`preferred_message_id` integer,
	`ai_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_asset_file_unique` ON `media_asset` (`file_unique_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_asset_dedupe` ON `media_asset` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ix_asset_created` ON `media_asset` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ix_asset_type_created` ON `media_asset` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_asset_ai_status` ON `media_asset` (`ai_status`);--> statement-breakpoint
CREATE TABLE `media_embedding` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_asset_id` integer NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`content_hash` text NOT NULL,
	`source_doc` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_emb_asset_kind_model` ON `media_embedding` (`media_asset_id`,`kind`,`model`);--> statement-breakpoint
CREATE TABLE `media_metadata` (
	`media_asset_id` integer PRIMARY KEY NOT NULL,
	`file_name` text,
	`year` integer,
	`season` integer,
	`episode` integer,
	`quality` text,
	`codec` text,
	`source` text,
	`audio` text,
	`title_norm` text,
	`description` text,
	`summary` text,
	`extracted_by` text,
	`parser_version` text,
	`raw_parse` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_meta_quality` ON `media_metadata` (`quality`);--> statement-breakpoint
CREATE INDEX `ix_meta_year` ON `media_metadata` (`year`);--> statement-breakpoint
CREATE TABLE `media_search_doc` (
	`doc_id` integer PRIMARY KEY NOT NULL,
	`title` text,
	`filename` text,
	`caption` text,
	`tags` text,
	`summary` text,
	`extra` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_asset_id` integer NOT NULL,
	`tag` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tag_asset_tag_src` ON `media_tag` (`media_asset_id`,`tag`,`source`);--> statement-breakpoint
CREATE INDEX `ix_tag_tag` ON `media_tag` (`tag`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_asset_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`chat_type` text,
	`chat_title` text,
	`media_group_id` text,
	`sender_id` integer,
	`sender_name` text,
	`file_id` text NOT NULL,
	`file_unique_id` text NOT NULL,
	`thumbnail_file_id` text,
	`caption` text,
	`caption_entities` text,
	`message_date` integer NOT NULL,
	`via` text DEFAULT 'bot' NOT NULL,
	`remote_ref` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`raw` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_msg_chat_msg` ON `telegram_message` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `ix_msg_asset` ON `telegram_message` (`media_asset_id`);--> statement-breakpoint
CREATE INDEX `ix_msg_unique` ON `telegram_message` (`file_unique_id`);--> statement-breakpoint
CREATE INDEX `ix_msg_date` ON `telegram_message` (`message_date`);