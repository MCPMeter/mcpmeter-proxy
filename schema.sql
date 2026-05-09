-- mcpmeter-proxy · schema snapshot
-- Generated from the canonical Laravel migrations. Do NOT edit by hand —
-- regenerate from the upstream mcpmeter app whenever a migration lands.
--
-- To bootstrap a local DB for the proxy:
--   mysql -u root -p -e "CREATE DATABASE mcpmeter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
--   mysql -u root -p mcpmeter < schema.sql
--
-- Tables (proxy reads/writes only the columns documented in lib/db.js):
--   users               · credit balance + auth ownership
--   api_keys            · SHA-256 hashed bearer keys
--   projects            · spend buckets with monthly caps
--   mcps                · listing config (slug, upstream, transport, limits)
--   mcp_tools           · auto-discovered tools per listing
--   pricing_rules       · per-call price (µ¢)
--   usage_events        · append-only call ledger
--   credit_transactions · append-only credit ledger
--   mcp_consumer_usage  · per-(MCP, consumer, month) free-tier counters

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'consumer',
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remember_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_customer_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_connect_account_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `credit_micro_cents` bigint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `users_stripe_customer_id_index` (`stripe_customer_id`),
  KEY `users_stripe_connect_account_id_index` (`stripe_connect_account_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `api_keys` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `project_id` bigint unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `key_prefix` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `env` enum('live','test') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'live',
  `last_used_at` timestamp NULL DEFAULT NULL,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_keys_key_hash_unique` (`key_hash`),
  KEY `api_keys_user_id_foreign` (`user_id`),
  KEY `api_keys_project_id_foreign` (`project_id`),
  KEY `api_keys_key_prefix_index` (`key_prefix`),
  KEY `api_keys_revoked_at_index` (`revoked_at`),
  CONSTRAINT `api_keys_project_id_foreign` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `api_keys_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `projects` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spending_cap_cents_per_month` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `projects_slug_unique` (`slug`),
  KEY `projects_user_id_index` (`user_id`),
  CONSTRAINT `projects_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `mcps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `publisher_id` bigint unsigned NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `readme_md` longtext COLLATE utf8mb4_unicode_ci,
  `repo_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `homepage_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `upstream_url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transport` enum('http','sse','streamable') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'streamable',
  `status` enum('draft','review','live','paused','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `last_status_code` smallint unsigned DEFAULT NULL,
  `consecutive_failures` int unsigned NOT NULL DEFAULT '0',
  `license` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `free_calls_per_consumer` smallint unsigned NOT NULL DEFAULT '0',
  `rate_limit_per_minute` int unsigned DEFAULT NULL,
  `rate_limit_per_day` int unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mcps_slug_unique` (`slug`),
  KEY `mcps_publisher_id_foreign` (`publisher_id`),
  KEY `mcps_category_index` (`category`),
  KEY `mcps_status_index` (`status`),
  CONSTRAINT `mcps_publisher_id_foreign` FOREIGN KEY (`publisher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `mcp_tools` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mcp_id` bigint unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `input_schema` json DEFAULT NULL,
  `kind` enum('read','write') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'read',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mcp_tools_mcp_id_name_unique` (`mcp_id`,`name`),
  CONSTRAINT `mcp_tools_mcp_id_foreign` FOREIGN KEY (`mcp_id`) REFERENCES `mcps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `pricing_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mcp_id` bigint unsigned NOT NULL,
  `tool_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model` enum('per_call','tiered','free') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'per_call',
  `price_micro_cents` bigint unsigned NOT NULL DEFAULT '0',
  `tier_config` json DEFAULT NULL,
  `currency` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USD',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pricing_rules_mcp_id_tool_name_unique` (`mcp_id`,`tool_name`),
  CONSTRAINT `pricing_rules_mcp_id_foreign` FOREIGN KEY (`mcp_id`) REFERENCES `mcps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `usage_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `project_id` bigint unsigned NOT NULL,
  `mcp_id` bigint unsigned NOT NULL,
  `api_key_id` bigint unsigned DEFAULT NULL,
  `tool_name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `called_at` timestamp NOT NULL,
  `duration_ms` int unsigned NOT NULL,
  `status` smallint unsigned NOT NULL,
  `billed_micro_cents` bigint unsigned NOT NULL DEFAULT '0',
  `publisher_payout_micro_cents` bigint unsigned NOT NULL DEFAULT '0',
  `platform_fee_micro_cents` bigint unsigned NOT NULL DEFAULT '0',
  `request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `aggregated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `usage_events_project_id_called_at_index` (`project_id`,`called_at`),
  KEY `usage_events_mcp_id_called_at_index` (`mcp_id`,`called_at`),
  KEY `usage_events_project_id_index` (`project_id`),
  KEY `usage_events_mcp_id_index` (`mcp_id`),
  KEY `usage_events_called_at_index` (`called_at`),
  KEY `usage_events_aggregated_at_index` (`aggregated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `credit_transactions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `amount_micro_cents` bigint NOT NULL,
  `type` enum('signup_bonus','topup','usage','refund','adjustment','expiry','promo') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_id` bigint unsigned DEFAULT NULL,
  `balance_after_micro_cents` bigint NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `credit_transactions_user_id_created_at_index` (`user_id`,`created_at`),
  KEY `credit_transactions_reference_type_reference_id_index` (`reference_type`,`reference_id`),
  KEY `credit_transactions_type_index` (`type`),
  CONSTRAINT `credit_transactions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `mcp_consumer_usage` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mcp_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `free_calls_used` int unsigned NOT NULL DEFAULT '0',
  `period_year_month` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billable_calls` bigint unsigned NOT NULL DEFAULT '0',
  `first_called_at` timestamp NULL DEFAULT NULL,
  `last_called_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mcp_consumer_usage_mcp_id_user_id_unique` (`mcp_id`,`user_id`),
  KEY `mcp_consumer_usage_user_id_index` (`user_id`),
  KEY `mcp_consumer_usage_mcp_id_period_year_month_index` (`mcp_id`,`period_year_month`),
  CONSTRAINT `mcp_consumer_usage_mcp_id_foreign` FOREIGN KEY (`mcp_id`) REFERENCES `mcps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `mcp_consumer_usage_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
