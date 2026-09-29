ALTER TABLE `media_asset` ADD `category` text;--> statement-breakpoint
ALTER TABLE `media_asset` ADD `category_source` text;--> statement-breakpoint
ALTER TABLE `media_asset` ADD `is_sensitive` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media_asset` ADD `ai_skip` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_origin_type` text;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_from_chat_id` integer;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_from_chat_title` text;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_from_chat_username` text;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_sender_user_id` integer;--> statement-breakpoint
ALTER TABLE `telegram_message` ADD `forward_sender_name` text;--> statement-breakpoint
CREATE INDEX `ix_msg_forward_chat` ON `telegram_message` (`forward_origin_type`,`forward_from_chat_id`);