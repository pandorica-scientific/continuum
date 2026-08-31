-- GENERATED FILE — DO NOT EDIT.
--
-- Written by `npm run db:baseline` from the Drizzle schema in
-- src/lib/server/db/schema/. Everything above the appendix below is drizzle-kit's
-- output; everything in the appendix is exported from those same modules,
-- because drizzle-kit models tables, columns, indexes and foreign keys and
-- nothing else.
--
-- Change the schema in TypeScript and re-run the script. Editing this file by
-- hand puts it out of step with the modules, and
-- tests/unit/baseline-composition.test.ts fails when that happens.

CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"exponent" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rate" (
	"code" text NOT NULL,
	"day" date NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	CONSTRAINT "currency_rate_code_day_pk" PRIMARY KEY("code","day")
);
--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credential" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"auth_generation" integer NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrollment_token" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "enrollment_token_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"birth_year" integer,
	"password_hash" text,
	"auth_generation" integer DEFAULT 0 NOT NULL,
	"deactivated_at" timestamp with time zone,
	"overview_layout" jsonb,
	"tax_view" jsonb,
	"theme" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"auth_generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_claim" (
	"claimed" boolean PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"person_id" uuid,
	"auth_generation" integer,
	"auth_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"photo" text,
	"organisation" text,
	"job_title" text,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shelf_id" uuid NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"note" text,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"stored_name" text,
	"ext" text DEFAULT 'PDF' NOT NULL,
	"added_on" date NOT NULL,
	"expires_on" date,
	"expiry_verb" text DEFAULT 'expires' NOT NULL,
	"period_on" date,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "document_identity" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"country" text,
	"number" text,
	"issued_on" date,
	"issuer" text
);
--> statement-breakpoint
CREATE TABLE "document_identity_number" (
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "document_identity_number_document_id_ordinal_pk" PRIMARY KEY("document_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "document_text" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"engine" text NOT NULL,
	"engine_version" text NOT NULL,
	"languages" text NOT NULL,
	"mean_confidence" real,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"complete" boolean DEFAULT true NOT NULL,
	"pages_extracted" integer
);
--> statement-breakpoint
CREATE TABLE "document_text_chunk" (
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page_no" integer,
	"source" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_text_chunk_document_id_ordinal_pk" PRIMARY KEY("document_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "document_type" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shelf" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text DEFAULT '🗂️' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shelf_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "shelf_type" (
	"shelf_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "shelf_type_shelf_id_type_pk" PRIMARY KEY("shelf_id","type")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏠' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"active_from" date,
	"active_to" date,
	CONSTRAINT "subject_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_normalised_name_unique" UNIQUE("normalised_name")
);
--> statement-breakpoint
CREATE TABLE "contact_link" (
	"contact_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "contact_link_contact_id_target_id_pk" PRIMARY KEY("contact_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "document_link" (
	"document_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "document_link_document_id_target_id_pk" PRIMARY KEY("document_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_link" (
	"tag_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "tag_link_tag_id_target_id_pk" PRIMARY KEY("tag_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏦' NOT NULL,
	"bank" text NOT NULL,
	"kind" text DEFAULT 'current' NOT NULL,
	"currency" text NOT NULL,
	"owner_person_id" uuid,
	"numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"balance_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"emoji" text DEFAULT '🏦' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"group_key" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color_token" text NOT NULL,
	"role" text DEFAULT 'expense' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"bank" text NOT NULL,
	"format" text NOT NULL,
	"account_id" uuid,
	"content_hash" text NOT NULL,
	"stored_name" text,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_added" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"rows_paired" integer DEFAULT 0 NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"source_method" text NOT NULL,
	"proof_class" text NOT NULL,
	"ledger_model" text,
	"currency" text NOT NULL,
	"opening_balance_minor" bigint,
	"closing_balance_minor" bigint,
	"stated_credit_total_minor" bigint,
	"stated_debit_total_minor" bigint,
	"stated_row_count" integer,
	"reconciliation" jsonb,
	"document_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_file_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "import_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"source" text NOT NULL,
	"encoding" text,
	"delimiter" text,
	"signature" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"filename_pattern" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provenance" text DEFAULT 'learned' NOT NULL,
	"conditions" jsonb NOT NULL,
	"category_id" text,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"corrected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_tag" (
	"rule_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "rule_tag_rule_id_tag_id_pk" PRIMARY KEY("rule_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"value_on" date,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint,
	"currency" text NOT NULL,
	"balance_after_minor" bigint,
	"original_amount_minor" bigint,
	"original_currency" text,
	"counterparty" text,
	"counterparty_account" text,
	"variable_symbol" text,
	"constant_symbol" text,
	"specific_symbol" text,
	"description" text,
	"bank_ref" text,
	"dedup_fingerprint" text NOT NULL,
	"fingerprint_version" integer DEFAULT 1 NOT NULL,
	"category_id" text,
	"suggested_category_id" text,
	"review_state" text DEFAULT 'needs_review' NOT NULL,
	"review_reason" text,
	"import_file_id" uuid,
	"source_method" text,
	"proof_class" text,
	"transfer_to_account_id" uuid,
	"transfer_pair_id" uuid
);
--> statement-breakpoint
CREATE TABLE "transaction_fingerprint_alias" (
	"account_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "transaction_fingerprint_alias_account_id_fingerprint_pk" PRIMARY KEY("account_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "transaction_split" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"category_id" text,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_pair" (
	"id" uuid PRIMARY KEY NOT NULL,
	"out_transaction_id" uuid NOT NULL,
	"in_transaction_id" uuid NOT NULL,
	"state" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_pair_leg" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"pair_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"valued_on" date,
	"money_in_minor" bigint DEFAULT 0 NOT NULL,
	"bought_year" integer,
	"owner_person_id" uuid,
	"images" jsonb DEFAULT '{"photos":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_bill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "property_opening" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"purchased_on" date,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"costs_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_valuation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"valued_on" date NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"source" text DEFAULT 'estimate' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"tenant_name" text NOT NULL,
	"rent_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"renewal_notice_on" date
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lender" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'mortgage' NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"principal_minor" bigint NOT NULL,
	"owed_minor" bigint NOT NULL,
	"owed_on" date,
	"owner_person_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"regime" text DEFAULT 'fixed_period' NOT NULL,
	"day_count" text DEFAULT '30/360' NOT NULL,
	"accrual_style" text DEFAULT 'payment' NOT NULL,
	"payment_day" integer,
	"interest_deductible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" uuid NOT NULL,
	"happened_on" date NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"interest_minor" bigint,
	"note" text,
	"transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "loan_fixation_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"annual_rate_pct" numeric(6, 3) NOT NULL,
	"payment_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_property" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"share_pct" numeric(6, 3)
);
--> statement-breakpoint
CREATE TABLE "broker_import_state" (
	"id" text PRIMARY KEY NOT NULL,
	"latest_generated_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"ticker" text,
	"happened_at" timestamp with time zone NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"comment" text,
	"position_id" text
);
--> statement-breakpoint
CREATE TABLE "broker_position" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"purchase_value_minor" bigint,
	"sale_value_minor" bigint,
	"currency" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'STOCK' NOT NULL,
	"units" numeric(18, 6) NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"net_profit_pct" numeric(9, 2),
	"valued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshot" (
	"day" date PRIMARY KEY NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshot" (
	"day" date PRIMARY KEY NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"remote_cal_id" text,
	"remote_cal_name" text,
	"credential" text NOT NULL,
	"cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_conflict" (
	"id" uuid PRIMARY KEY NOT NULL,
	"local_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ours" jsonb NOT NULL,
	"theirs" jsonb NOT NULL,
	"resolution" text NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"category" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"rrule" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_event_exception" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"recurrence_id" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"title" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"notes" text,
	"category" text,
	"all_day" boolean,
	"tz" text
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_link" (
	"local_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"remote_id" text NOT NULL,
	"remote_etag" text,
	"pushed_hash" text,
	"seen_hash" text,
	"suppressed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "calendar_sync_link_local_key_account_id_pk" PRIMARY KEY("local_key","account_id")
);
--> statement-breakpoint
CREATE TABLE "salary_attribution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_key" text NOT NULL,
	"person_id" uuid NOT NULL,
	"account_id" uuid,
	"created_on" date DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"period_month" text NOT NULL,
	"gross_minor" bigint,
	"net_minor" bigint,
	"bonus_minor" bigint,
	"currency" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"document_id" uuid,
	"transaction_id" uuid,
	"amount_overridden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_statement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"gross_income_minor" bigint NOT NULL,
	"tax_paid_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_statement_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"state" text DEFAULT 'queued' NOT NULL,
	"filename" text,
	"blob" text,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "currency_rate" ADD CONSTRAINT "currency_rate_code_currency_code_fk" FOREIGN KEY ("code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD CONSTRAINT "webauthn_challenge_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_shelf_id_shelf_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelf"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_type_document_type_key_fk" FOREIGN KEY ("type") REFERENCES "public"."document_type"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_identity" ADD CONSTRAINT "document_identity_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_identity_number" ADD CONSTRAINT "document_identity_number_document_id_document_identity_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_identity"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_text" ADD CONSTRAINT "document_text_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_text_chunk" ADD CONSTRAINT "document_text_chunk_document_id_document_text_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_text"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_type" ADD CONSTRAINT "shelf_type_shelf_id_shelf_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_type" ADD CONSTRAINT "shelf_type_type_document_type_key_fk" FOREIGN KEY ("type") REFERENCES "public"."document_type"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_link" ADD CONSTRAINT "tag_link_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_link" ADD CONSTRAINT "tag_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_group_key_category_group_key_fk" FOREIGN KEY ("group_key") REFERENCES "public"."category_group"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_original_currency_currency_code_fk" FOREIGN KEY ("original_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_suggested_category_id_category_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_import_file_id_import_file_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_to_account_id_account_id_fk" FOREIGN KEY ("transfer_to_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fingerprint_alias" ADD CONSTRAINT "transaction_fingerprint_alias_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fingerprint_alias" ADD CONSTRAINT "transaction_fingerprint_alias_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_out_transaction_id_transaction_id_fk" FOREIGN KEY ("out_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_in_transaction_id_transaction_id_fk" FOREIGN KEY ("in_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair_leg" ADD CONSTRAINT "transfer_pair_leg_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair_leg" ADD CONSTRAINT "transfer_pair_leg_pair_id_transfer_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."transfer_pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_bill" ADD CONSTRAINT "property_bill_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_bill" ADD CONSTRAINT "property_bill_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_opening" ADD CONSTRAINT "property_opening_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_opening" ADD CONSTRAINT "property_opening_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_valuation" ADD CONSTRAINT "property_valuation_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_valuation" ADD CONSTRAINT "property_valuation_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy" ADD CONSTRAINT "tenancy_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_fixation_period" ADD CONSTRAINT "loan_fixation_period_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_property" ADD CONSTRAINT "loan_property_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_property" ADD CONSTRAINT "loan_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_import_state" ADD CONSTRAINT "broker_import_state_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_operation" ADD CONSTRAINT "broker_operation_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_operation" ADD CONSTRAINT "broker_operation_position_id_broker_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."broker_position"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_position" ADD CONSTRAINT "broker_position_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshot" ADD CONSTRAINT "net_worth_snapshot_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_conflict" ADD CONSTRAINT "calendar_conflict_account_id_calendar_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_link" ADD CONSTRAINT "calendar_sync_link_account_id_calendar_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_attribution" ADD CONSTRAINT "salary_attribution_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_attribution" ADD CONSTRAINT "salary_attribution_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement_line" ADD CONSTRAINT "tax_statement_line_statement_id_tax_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."tax_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_person_idx" ON "credential" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "session_person_idx" ON "session" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_expires_idx" ON "webauthn_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_address_created_idx" ON "webauthn_challenge" USING btree ("address","created_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_person_idx" ON "webauthn_challenge" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "document_shelf_id_idx" ON "document" USING btree ("shelf_id");--> statement-breakpoint
CREATE INDEX "document_type_idx" ON "document" USING btree ("type");--> statement-breakpoint
CREATE INDEX "document_content_hash_idx" ON "document" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "dtc_document_idx" ON "document_text_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "shelf_type_type_idx" ON "shelf_type" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_name_ci_idx" ON "subject" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "contact_link_target_idx" ON "contact_link" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "document_link_target_idx" ON "document_link" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_id_kind_key" ON "entity" USING btree ("id","kind");--> statement-breakpoint
CREATE INDEX "entity_kind_idx" ON "entity" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tag_link_target_idx" ON "tag_link" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "account_currency_idx" ON "account" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "account_owner_person_idx" ON "account" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "category_group_key_idx" ON "category" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "import_file_currency_idx" ON "import_file" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "import_file_account_idx" ON "import_file" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_file_document_idx" ON "import_file" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "rule_category_idx" ON "rule" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "rule_tag_tag_idx" ON "rule_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transaction_currency_idx" ON "transaction" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "transaction_original_currency_idx" ON "transaction" USING btree ("original_currency");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_dedup_idx" ON "transaction" USING btree ("account_id","dedup_fingerprint");--> statement-breakpoint
CREATE INDEX "transaction_booked_on_idx" ON "transaction" USING btree ("booked_on");--> statement-breakpoint
CREATE INDEX "transaction_review_idx" ON "transaction" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "transaction_category_idx" ON "transaction" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transaction_suggested_category_idx" ON "transaction" USING btree ("suggested_category_id");--> statement-breakpoint
CREATE INDEX "transaction_import_file_idx" ON "transaction" USING btree ("import_file_id");--> statement-breakpoint
CREATE INDEX "transaction_transfer_to_account_idx" ON "transaction" USING btree ("transfer_to_account_id");--> statement-breakpoint
CREATE INDEX "transaction_fingerprint_alias_transaction_idx" ON "transaction_fingerprint_alias" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_split_txn_idx" ON "transaction_split" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_split_category_idx" ON "transaction_split" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transfer_pair_out_transaction_idx" ON "transfer_pair" USING btree ("out_transaction_id");--> statement-breakpoint
CREATE INDEX "transfer_pair_in_transaction_idx" ON "transfer_pair" USING btree ("in_transaction_id");--> statement-breakpoint
CREATE INDEX "transfer_pair_leg_pair_idx" ON "transfer_pair_leg" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "property_currency_idx" ON "property" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "property_owner_person_idx" ON "property" USING btree ("owner_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_bill_meter_property_idx" ON "property_bill" USING btree ("property_id") WHERE "property_bill"."source" = 'meter';--> statement-breakpoint
CREATE INDEX "property_bill_property_idx" ON "property_bill" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_bill_document_idx" ON "property_bill" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "property_opening_currency_idx" ON "property_opening" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "property_valuation_property_idx" ON "property_valuation" USING btree ("property_id","valued_on");--> statement-breakpoint
CREATE INDEX "property_valuation_currency_idx" ON "property_valuation" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "tenancy_property_idx" ON "tenancy" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "loan_currency_idx" ON "loan" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "loan_owner_person_idx" ON "loan" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "loan_event_loan_idx" ON "loan_event" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "loan_event_transaction_idx" ON "loan_event" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "loan_fixation_loan_idx" ON "loan_fixation_period" USING btree ("loan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_fixation_start_idx" ON "loan_fixation_period" USING btree ("loan_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_property_idx" ON "loan_property" USING btree ("loan_id","property_id");--> statement-breakpoint
CREATE INDEX "loan_property_property_idx" ON "loan_property" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "broker_import_state_currency_idx" ON "broker_import_state" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "broker_operation_currency_idx" ON "broker_operation" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "broker_operation_position_idx" ON "broker_operation" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "broker_position_currency_idx" ON "broker_position" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "holding_currency_idx" ON "holding" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "net_worth_snapshot_currency_idx" ON "net_worth_snapshot" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "portfolio_snapshot_currency_idx" ON "portfolio_snapshot" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "calendar_conflict_account_idx" ON "calendar_conflict" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "calendar_event_created_by_idx" ON "calendar_event" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_exception_occurrence_idx" ON "calendar_event_exception" USING btree ("event_id","recurrence_id");--> statement-breakpoint
CREATE INDEX "calendar_sync_link_account_idx" ON "calendar_sync_link" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "salary_attribution_key_idx" ON "salary_attribution" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "salary_attribution_person_idx" ON "salary_attribution" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "salary_attribution_account_idx" ON "salary_attribution" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_entry_person_month_doc_key" ON "salary_entry" USING btree ("person_id","period_month","document_id") WHERE document_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_entry_person_month_key" ON "salary_entry" USING btree ("person_id","period_month") WHERE document_id is null;--> statement-breakpoint
CREATE INDEX "salary_entry_person_month_idx" ON "salary_entry" USING btree ("person_id","period_month");--> statement-breakpoint
CREATE INDEX "salary_entry_currency_idx" ON "salary_entry" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "salary_entry_document_idx" ON "salary_entry" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "salary_entry_transaction_idx" ON "salary_entry" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "tax_statement_currency_idx" ON "tax_statement" USING btree ("currency");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_statement_unique_idx" ON "tax_statement" USING btree ("person_id","year","country");--> statement-breakpoint
CREATE INDEX "tax_statement_line_statement_idx" ON "tax_statement_line" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "job_claimable_idx" ON "job" USING btree ("kind","state","queued_at");--> statement-breakpoint
CREATE INDEX "job_subject_idx" ON "job" USING btree ("subject_id");
--> statement-breakpoint

-- =========================================================================
-- Everything below this line cannot be generated by drizzle-kit: triggers,
-- generated columns, CHECK constraints, expression indexes, the net-worth view,
-- and the seed rows a foreign key needs to be satisfiable.
--
-- So `db:generate` alone cannot notice any of it going missing, and a database
-- built with `drizzle-kit push` would have the tables without the integrity they
-- depend on. Build the schema with migrations.
--
-- Each block is exported from the schema module that owns the tables it
-- constrains; the two lists that were once repeated here — the enum CHECK
-- constraints and the entity kinds — are generated from src/lib/enums.ts.
-- =========================================================================

-- ---- Extensions ----
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- ---- Folding diacritics for search ----
CREATE OR REPLACE FUNCTION contact_fold(value text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	STRICT
	PARALLEL SAFE
AS $$
	select lower(
		public.unaccent('public.unaccent'::regdictionary, translate(value, 'łđøħŧ', 'ldoht'))
	)
$$;
--> statement-breakpoint

-- ---- Contact search ----
CREATE INDEX contact_search_idx ON contact USING gin (
	to_tsvector(
		'simple',
		contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, ''))
	)
);
--> statement-breakpoint

-- ---- Document search ----
CREATE INDEX dtc_fts_idx ON document_text_chunk
	USING gin (to_tsvector('simple', public.contact_fold(text)));
--> statement-breakpoint
CREATE INDEX dtc_trgm_idx ON document_text_chunk
	USING gin (public.contact_fold(text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX document_name_trgm_idx ON document
	USING gin (public.contact_fold(name) gin_trgm_ops);
--> statement-breakpoint

-- ---- The date a movement is read on ----
CREATE INDEX "transaction_effective_on_idx" ON "transaction"
	(coalesce("value_on", "booked_on"));
--> statement-breakpoint

-- ---- Transfer pair legs ----
CREATE FUNCTION maintain_transfer_pair_legs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND OLD.state IN ('auto', 'proposed', 'confirmed') THEN
		DELETE FROM transfer_pair_leg WHERE pair_id = OLD.id;
	END IF;

	IF NEW.state IN ('auto', 'proposed', 'confirmed') THEN
		INSERT INTO transfer_pair_leg (transaction_id, pair_id)
		VALUES (NEW.out_transaction_id, NEW.id), (NEW.in_transaction_id, NEW.id);
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_pair_leg_claims
AFTER INSERT OR UPDATE OF state, out_transaction_id, in_transaction_id ON transfer_pair
FOR EACH ROW EXECUTE FUNCTION maintain_transfer_pair_legs();
--> statement-breakpoint

-- ---- Enum CHECK constraints ----
ALTER TABLE person ADD CONSTRAINT person_role_check
	CHECK (role in ('admin', 'member'));
--> statement-breakpoint
ALTER TABLE account ADD CONSTRAINT account_kind_check
	CHECK (kind in ('current', 'savings', 'brokerage'));
--> statement-breakpoint
ALTER TABLE category_group ADD CONSTRAINT category_group_role_check
	CHECK (role in ('income', 'expense', 'savings'));
--> statement-breakpoint
ALTER TABLE person ADD CONSTRAINT person_theme_check
	CHECK (theme in ('dark', 'light'));
--> statement-breakpoint
ALTER TABLE property ADD CONSTRAINT property_kind_check
	CHECK (kind in ('lived', 'rented'));
--> statement-breakpoint
ALTER TABLE property_bill ADD CONSTRAINT property_bill_source_check
	CHECK (source in ('manual', 'meter'));
--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_kind_check
	CHECK (kind in ('mortgage', 'car', 'consumer', 'family'));
--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_regime_check
	CHECK (regime in ('fixed_period', 'fixed_term', 'floating'));
--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_day_count_check
	CHECK (day_count in ('30/360', 'act/365', 'act/360'));
--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_accrual_style_check
	CHECK (accrual_style in ('payment', 'calendar'));
--> statement-breakpoint
ALTER TABLE loan_event ADD CONSTRAINT loan_event_kind_check
	CHECK (kind in ('payment', 'extra_payment', 'refix', 'fee', 'balance'));
--> statement-breakpoint
ALTER TABLE transaction ADD CONSTRAINT transaction_review_state_check
	CHECK (review_state in ('auto', 'needs_review', 'confirmed', 'filed'));
--> statement-breakpoint
ALTER TABLE transaction ADD CONSTRAINT transaction_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));
--> statement-breakpoint
ALTER TABLE transfer_pair ADD CONSTRAINT transfer_pair_state_check
	CHECK (state in ('auto', 'proposed', 'confirmed', 'rejected'));
--> statement-breakpoint
ALTER TABLE job ADD CONSTRAINT job_kind_check
	CHECK (kind in ('import', 'calendar_sync', 'extract_text'));
--> statement-breakpoint
ALTER TABLE job ADD CONSTRAINT job_state_check
	CHECK (state in ('queued', 'running', 'done', 'failed'));
--> statement-breakpoint
ALTER TABLE import_profile ADD CONSTRAINT import_profile_source_check
	CHECK (source in ('delimited', 'xlsx'));
--> statement-breakpoint
ALTER TABLE import_profile ADD CONSTRAINT import_profile_origin_check
	CHECK (origin in ('builtin', 'user', 'imported'));
--> statement-breakpoint
ALTER TABLE import_file ADD CONSTRAINT import_file_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));
--> statement-breakpoint
ALTER TABLE rule ADD CONSTRAINT rule_provenance_check
	CHECK (provenance in ('learned', 'manual'));
--> statement-breakpoint
ALTER TABLE document ADD CONSTRAINT document_sensitivity_check
	CHECK (sensitivity in ('normal', 'restricted'));
--> statement-breakpoint
ALTER TABLE document_text_chunk ADD CONSTRAINT document_text_chunk_source_check
	CHECK (source in ('text_layer', 'ocr', 'plain'));
--> statement-breakpoint
ALTER TABLE document ADD CONSTRAINT document_expiry_verb_check
	CHECK (expiry_verb in ('expires', 'renews', 'due'));
--> statement-breakpoint
ALTER TABLE document_identity ADD CONSTRAINT document_identity_kind_check
	CHECK (kind in ('passport', 'id_card', 'driving_licence', 'residence_permit', 'other'));
--> statement-breakpoint
ALTER TABLE calendar_account ADD CONSTRAINT calendar_account_provider_check
	CHECK (provider in ('icloud', 'google'));
--> statement-breakpoint
ALTER TABLE calendar_conflict ADD CONSTRAINT calendar_conflict_resolution_check
	CHECK (resolution in ('local-won', 'remote-won', 'wrote-back'));
--> statement-breakpoint
ALTER TABLE entity ADD CONSTRAINT entity_kind_check
	CHECK (kind in ('person', 'account', 'transaction', 'transaction_split', 'property', 'tenancy', 'loan', 'document', 'contact', 'tag', 'subject', 'tax_statement'));
--> statement-breakpoint

-- ---- Singletons and shapes ----
-- One row, ever: the wizard is claimed or it is not.
ALTER TABLE setup_claim ADD CONSTRAINT setup_claim_singleton CHECK (claimed = true);
--> statement-breakpoint
ALTER TABLE broker_import_state ADD CONSTRAINT broker_import_state_singleton
	CHECK (id = 'global');
--> statement-breakpoint
-- period_on means "the month this document covers", so a mid-month day is either
-- a different fact or a mistake.
ALTER TABLE document ADD CONSTRAINT document_period_first_of_month
	CHECK (period_on IS NULL OR extract(day from period_on) = 1);
--> statement-breakpoint
-- Two upper-case letters or nothing. The field is a picker, so this is not
-- defending against a typist; it is what keeps the artwork lookup and the flag
-- from being handed 'Czechia' by a future importer and drawing nothing.
ALTER TABLE document_identity ADD CONSTRAINT document_identity_country_check
	CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- A period that ends before it starts is not a period. NULLs are legal on both
-- sides: a subject that is simply current has neither.
ALTER TABLE subject ADD CONSTRAINT subject_active_period_check
	CHECK (active_from IS NULL OR active_to IS NULL OR active_from <= active_to);
--> statement-breakpoint

-- ---- The entity supertype ----
DO $outer$
DECLARE
	t text;
	has_created_at boolean;
BEGIN
	FOREACH t IN ARRAY ARRAY['person', 'account', 'transaction', 'transaction_split', 'property', 'tenancy', 'loan', 'document', 'contact', 'tag', 'subject', 'tax_statement']
	LOOP
		EXECUTE format(
			'ALTER TABLE %I ADD COLUMN entity_kind text GENERATED ALWAYS AS (%L) STORED', t, t);

		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (id, entity_kind)
				REFERENCES entity (id, kind) ON DELETE CASCADE',
			t, t || '_entity_fk');

		-- A table that records its own creation time hands it to the entity, so
		-- the two never disagree. The demo seed inserts rows dated years back;
		-- stamping now() here would have given those records an entity younger
		-- than the record itself, which is the divergence that makes a shared
		-- audit column worth having in the first place.
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
		) INTO has_created_at;

		IF has_created_at THEN
			EXECUTE format($f$
				CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
				BEGIN
					INSERT INTO entity (id, kind, created_at)
						VALUES (NEW.id, %L, COALESCE(NEW.created_at, now()))
						ON CONFLICT (id) DO NOTHING;
					RETURN NEW;
				END $b$;
			$f$, t || '_register_entity', t);
		ELSE
			EXECUTE format($f$
				CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
				BEGIN
					INSERT INTO entity (id, kind) VALUES (NEW.id, %L)
						ON CONFLICT (id) DO NOTHING;
					RETURN NEW;
				END $b$;
			$f$, t || '_register_entity', t);
		END IF;
		EXECUTE format(
			'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
			t || '_register_entity_trg', t, t || '_register_entity');

		EXECUTE format($f$
			CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
			BEGIN
				DELETE FROM entity WHERE id = OLD.id;
				RETURN OLD;
			END $b$;
		$f$, t || '_retire_entity');
		EXECUTE format(
			'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
			t || '_retire_entity_trg', t, t || '_retire_entity');
	END LOOP;
END $outer$;
--> statement-breakpoint

-- ---- The net-worth contract ----
CREATE VIEW net_worth_component AS
	SELECT id, 'property'::text AS kind, kind::text AS subkind, owner_person_id,
	       currency, value_minor, valued_on
	  FROM property
	UNION ALL
	SELECT id, 'account', kind::text, owner_person_id,
	       currency, balance_minor, balance_on
	  FROM account
	UNION ALL
	SELECT id, 'loan', kind::text, owner_person_id,
	       currency, -owed_minor, owed_on
	  FROM loan
	UNION ALL
	SELECT id, 'holding', category, NULL,
	       currency, value_minor, valued_at::date
	  FROM holding;
--> statement-breakpoint

-- ---- Seed rows ----
INSERT INTO currency (code, exponent, name)
VALUES ('CZK', 2, 'Czech Koruna'), ('EUR', 2, 'Euro')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO "category_group" ("key", "label", "color_token", "role", "sort") VALUES
	('income',        'Income',            '--series-income',        'income',  0),
	('taxes',         'Taxes & fees',      '--series-taxes',         'expense', 1),
	('bills',         'Bills & utilities', '--series-bills',         'expense', 2),
	('subscriptions', 'Subscriptions',     '--series-subscriptions', 'expense', 3),
	('health',        'Health & care',     '--series-health',        'expense', 4),
	('transport',     'Transport',         '--series-transport',     'expense', 5),
	('living',        'Food & lifestyle',  '--series-living',        'expense', 6),
	('housing',       'Housing',           '--series-housing',       'expense', 7),
	('savings',       'Saved & invested',  '--series-savings',       'savings', 8)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "bank" ("key", "label", "emoji") VALUES
	('fio', 'Fio banka', '🏦'),
	('revolut', 'Revolut', '💠'),
	('mbank', 'mBank', '🅜'),
	('rb', 'Raiffeisenbank', '🟡'),
	('cs', 'Česká spořitelna', '🔵'),
	('other', 'Other', '💼')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- One place for a document to always belong: the household. The documents
-- screen offers it as a tick beside the people, and nothing else creates it.
INSERT INTO subject (id, name, emoji) VALUES (gen_random_uuid(), 'Household', '🏠');
--> statement-breakpoint
INSERT INTO document_type (key, label, builtin, sort_order) VALUES
	('contract', 'Contract', true, 0),
	('invoice', 'Invoice', true, 10),
	('receipt', 'Receipt', true, 20),
	('payslip', 'Payslip', true, 30),
	('bank_statement', 'Bank statement', true, 40),
	('broker_report', 'Broker report', true, 50),
	('insurance_policy', 'Insurance policy', true, 60),
	('claim', 'Claim', true, 70),
	('id_document', 'Identity document', true, 80),
	('certificate', 'Certificate', true, 90),
	('medical_record', 'Medical record', true, 100),
	('tax_document', 'Tax document', true, 110),
	('technical_plan', 'Technical plan', true, 120),
	('correspondence', 'Correspondence', true, 130),
	('warranty', 'Warranty', true, 140),
	('manual', 'Manual', true, 150),
	('other', 'Other', true, 160)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO shelf (id, key, label, emoji, sort_order, system) VALUES
	(gen_random_uuid(), 'inbox',      'Inbox',      '📬',  0, true),
	(gen_random_uuid(), 'identity',   'Identity',   '🪪', 10, true),
	(gen_random_uuid(), 'family',     'Family',     '👶', 20, true),
	(gen_random_uuid(), 'health',     'Health',     '🩺', 30, true),
	(gen_random_uuid(), 'property',   'Property',   '🏠', 40, true),
	(gen_random_uuid(), 'tenancy',    'Tenancy',    '🔑', 50, false),
	(gen_random_uuid(), 'vehicles',   'Vehicles',   '🚗', 60, false),
	(gen_random_uuid(), 'finance',    'Finance',    '🏦', 70, true),
	(gen_random_uuid(), 'household',  'Household',  '🔧', 80, true),
	(gen_random_uuid(), 'statements', 'Statements', '🧾', 90, true)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO shelf_type (shelf_id, type, ordinal) VALUES
	((SELECT id FROM shelf WHERE key = 'identity'), 'id_document', 0),
	((SELECT id FROM shelf WHERE key = 'identity'), 'certificate', 1),
	((SELECT id FROM shelf WHERE key = 'family'), 'certificate', 0),
	((SELECT id FROM shelf WHERE key = 'family'), 'contract', 1),
	((SELECT id FROM shelf WHERE key = 'family'), 'correspondence', 2),
	((SELECT id FROM shelf WHERE key = 'health'), 'medical_record', 0),
	((SELECT id FROM shelf WHERE key = 'health'), 'certificate', 1),
	((SELECT id FROM shelf WHERE key = 'health'), 'insurance_policy', 2),
	((SELECT id FROM shelf WHERE key = 'health'), 'invoice', 3),
	((SELECT id FROM shelf WHERE key = 'property'), 'insurance_policy', 0),
	((SELECT id FROM shelf WHERE key = 'property'), 'technical_plan', 1),
	((SELECT id FROM shelf WHERE key = 'property'), 'contract', 2),
	((SELECT id FROM shelf WHERE key = 'property'), 'invoice', 3),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'contract', 0),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'invoice', 1),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'correspondence', 2),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'warranty', 0),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'insurance_policy', 1),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'manual', 3),
	((SELECT id FROM shelf WHERE key = 'finance'), 'payslip', 0),
	((SELECT id FROM shelf WHERE key = 'finance'), 'tax_document', 1),
	((SELECT id FROM shelf WHERE key = 'finance'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'finance'), 'contract', 3),
	((SELECT id FROM shelf WHERE key = 'household'), 'warranty', 0),
	((SELECT id FROM shelf WHERE key = 'household'), 'manual', 1),
	((SELECT id FROM shelf WHERE key = 'household'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'household'), 'receipt', 3),
	((SELECT id FROM shelf WHERE key = 'household'), 'contract', 4),
	((SELECT id FROM shelf WHERE key = 'statements'), 'bank_statement', 0),
	((SELECT id FROM shelf WHERE key = 'statements'), 'broker_report', 1)
ON CONFLICT (shelf_id, type) DO NOTHING;
