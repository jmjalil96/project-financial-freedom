CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK("app_settings"."id" = 1),
	CONSTRAINT "app_settings_currency_length" CHECK(length("app_settings"."base_currency") = 3)
);
