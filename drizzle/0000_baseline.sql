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
-- Where in life a document belongs — one level, never a tree. The slug `key`
-- is immutable and is what code refers to; the label is the household's.
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
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	-- Where in life it is filed. A row, not an enum: a household renames and
	-- reorders its own shelves. RESTRICT below, so deleting one can never take
	-- the paper with it.
	"shelf_id" uuid NOT NULL,
	-- What kind of paper it is, independent of where it sits. Behaviour hangs
	-- off this — the salary tracker reads type='payslip'.
	"type" text DEFAULT 'other' NOT NULL,
	-- The one user-authored phrase field, ranked above contents in search.
	"note" text,
	-- Absent for members everywhere, enforced by visibleDocumentPredicate.
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"stored_name" text,
	"ext" text DEFAULT 'PDF' NOT NULL,
	"added_on" date NOT NULL,
	"expires_on" date,
	"expiry_verb" text DEFAULT 'expires' NOT NULL,
	"amount_minor" bigint,
	"currency" text,
	"period_on" date,
	-- SHA-256 of the stored file, so the same file uploaded twice is recognised
	-- as the same file rather than filed as a second one.
	"content_hash" text
);
--> statement-breakpoint
-- That a document's text was read, and by what. The text itself lives in the
-- chunk table: PostgreSQL refuses a tsvector over about 1 MB, which a 600-page
-- OCR run passes comfortably.
CREATE TABLE "document_text" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"engine" text NOT NULL,
	"engine_version" text NOT NULL,
	"languages" text NOT NULL,
	"mean_confidence" real,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The bounded-work contract: a partial run says so rather than looking done.
	"complete" boolean DEFAULT true NOT NULL,
	"pages_extracted" integer
);
--> statement-breakpoint
-- One PDF page, one image, or a ≤100 KB slice of a plain-text file. Every
-- content index lives here and nowhere else.
CREATE TABLE "document_text_chunk" (
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	-- Null for plain-text slices and single images: they have no page.
	"page_no" integer,
	"source" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_text_chunk_document_id_ordinal_pk" PRIMARY KEY("document_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏠' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Archiving a subject demotes everything filed under it in one reversible
	-- action; the period is what lets an old document read as history.
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
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"group_key" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL
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
CREATE TABLE "mark_transfer_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"counterparty_account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_transfer_rule_counterparty_account_unique" UNIQUE("counterparty_account")
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
CREATE TABLE "tax_statement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"gross_income_minor" bigint NOT NULL,
	"tax_paid_minor" bigint NOT NULL,
	"document_id" uuid,
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
ALTER TABLE "document_text" ADD CONSTRAINT "document_text_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_text_chunk" ADD CONSTRAINT "document_text_chunk_document_id_document_text_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_text"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link" ADD CONSTRAINT "contact_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_link" ADD CONSTRAINT "tag_link_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_link" ADD CONSTRAINT "tag_link_target_id_entity_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_original_currency_currency_code_fk" FOREIGN KEY ("original_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_suggested_category_id_category_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_import_file_id_import_file_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement_line" ADD CONSTRAINT "tax_statement_line_statement_id_tax_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."tax_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_person_idx" ON "credential" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "session_person_idx" ON "session" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_expires_idx" ON "webauthn_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_address_created_idx" ON "webauthn_challenge" USING btree ("address","created_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_person_idx" ON "webauthn_challenge" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "document_currency_idx" ON "document" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "document_shelf_id_idx" ON "document" USING btree ("shelf_id");--> statement-breakpoint
CREATE INDEX "document_type_idx" ON "document" USING btree ("type");--> statement-breakpoint
CREATE INDEX "document_content_hash_idx" ON "document" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "dtc_document_idx" ON "document_text_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_name_ci_idx" ON "subject" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "contact_link_target_idx" ON "contact_link" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "document_link_target_idx" ON "document_link" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_id_kind_key" ON "entity" USING btree ("id","kind");--> statement-breakpoint
CREATE INDEX "entity_kind_idx" ON "entity" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tag_link_target_idx" ON "tag_link" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "account_currency_idx" ON "account" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "account_owner_person_idx" ON "account" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "import_file_currency_idx" ON "import_file" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "import_file_account_idx" ON "import_file" USING btree ("account_id");--> statement-breakpoint
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
CREATE INDEX "tax_statement_currency_idx" ON "tax_statement" USING btree ("currency");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_statement_unique_idx" ON "tax_statement" USING btree ("person_id","year","country");--> statement-breakpoint
CREATE INDEX "tax_statement_document_idx" ON "tax_statement" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "tax_statement_line_statement_idx" ON "tax_statement_line" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "job_claimable_idx" ON "job" USING btree ("kind","state","queued_at");--> statement-breakpoint
CREATE INDEX "job_subject_idx" ON "job" USING btree ("subject_id");--> statement-breakpoint
-- ===========================================================================
-- Everything above this line is generated by drizzle-kit from the Drizzle
-- schema. Everything below it cannot be: drizzle-kit models tables, columns,
-- indexes and foreign keys, and nothing else.
--
-- So `db:generate` cannot notice any of this going missing, and a database
-- built with `drizzle-kit push` would have the tables without the integrity
-- they depend on. Build the schema with migrations.
--
-- Each section says where it came from and why it exists; the reasoning is the
-- part that would otherwise have been lost when the chain that produced it was
-- squashed away.
-- ===========================================================================

--> statement-breakpoint
-- ---- Extensions ----

-- gen_random_uuid() and digest(), for ids and transaction fingerprints.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

-- Contact search folds diacritics: "rehor" must find "Řehoř", "lodz" must find
-- "Łódź". Without this an address book for a Czech and Polish household only
-- answers to input nobody can type quickly.
--
-- The statement-breakpoint markers here are load-bearing, not formatting.
-- Drizzle splits a migration on them and sends each part separately; without
-- them the whole file arrives as one batch, and CREATE FUNCTION is parsed
-- before CREATE EXTENSION has taken effect. That fails with "text search
-- dictionary unaccent does not exist" — on a fresh database only, which is the
-- one place nobody tests before shipping.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint

-- ---- Contact search ----

-- The fold has to be identical on both sides. A term folded in TypeScript and
-- compared against text folded differently in SQL matches nothing, and it fails
-- silently — as "no results", never as an error. src/lib/contacts/search.ts owns
-- the canonical definition; tests/unit/contacts.test.ts pins this SQL against it.
--
-- WHY A WRAPPER FUNCTION RATHER THAN unaccent() INLINE:
-- unaccent(text) is STABLE, not IMMUTABLE, because it resolves the default
-- dictionary at run time. PostgreSQL refuses a STABLE expression in an index,
-- so indexing unaccent(name) directly fails outright. The two-argument form
-- unaccent(regdictionary, text) IS immutable — naming the dictionary is what
-- makes it so — and wrapping that lets the expression be indexed.
--
-- translate() covers the stroked letters unaccent cannot: Ł and Đ are single
-- code points with no combining accent to remove, so NFD-style stripping leaves
-- them alone. The from/to pairs mirror STROKED in search.ts.
--
-- TWO NON-OBVIOUS REQUIREMENTS, BOTH LEARNED BY THE MIGRATION FAILING:
--
-- 1. The ::regdictionary cast. A bare 'unaccent' literal arrives as type
--    `unknown`, PostgreSQL cannot choose between the one- and two-argument
--    overloads, and CREATE FUNCTION fails with
--    "function unaccent(unknown, text) does not exist".
--
-- 2. Both names are schema-qualified. PostgreSQL builds an index expression
--    under a restricted search_path that excludes `public` (the hardening from
--    CVE-2018-1058), so an unqualified reference resolves fine when the function
--    is created and then fails when the INDEX is built, with "text search
--    dictionary unaccent does not exist". The function looked correct in
--    isolation; only the index build proved otherwise.
CREATE OR REPLACE FUNCTION contact_fold(value text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	STRICT
	PARALLEL SAFE
AS $$
	select lower(
		public.unaccent('public.unaccent'::regdictionary, translate(value, 'łđøħŧ', 'ldoht'))
	)
$$;--> statement-breakpoint

-- Name and organisation are the two fields people search by: a person, or
-- everyone at a company. Notes and address are deliberately excluded — folding
-- a free-text blob into the same index makes every contact match almost
-- anything, which reads as the search being broken.
CREATE INDEX contact_search_idx ON contact USING gin (
	to_tsvector(
		'simple',
		contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, ''))
	)
);--> statement-breakpoint

-- ---- Transfer pair legs ----

-- Active pair legs are claims. Keeping them in a separate relation lets one
-- unique constraint cover both the outgoing and incoming columns, including the
-- cross-column collision ordinary indexes cannot prevent. The table itself is
-- generated above; what cannot be is the trigger that keeps it in step, so a
-- pair can never be active without its two legs claimed.
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
$$;--> statement-breakpoint

CREATE TRIGGER transfer_pair_leg_claims
AFTER INSERT OR UPDATE OF state, out_transaction_id, in_transaction_id ON transfer_pair
FOR EACH ROW EXECUTE FUNCTION maintain_transfer_pair_legs();--> statement-breakpoint

-- ---- Enum CHECK constraints ----

-- A CHECK for every closed set of column values.
--
-- Twenty-one columns once held their permitted values only in a comment beside
-- the declaration, and the comments had already drifted: `transaction.review_state`
-- documented three states while the code wrote four, and `document.shelf`
-- documented eight shelves while the app offered nine. Nothing compared them, so
-- nothing noticed.
--
-- The lists live in `src/lib/enums.ts` and are used three times over — to type
-- the Drizzle column, to build what the screens offer, and to write the
-- constraints below. `tests/integration/schema-invariants.test.ts` reads
-- pg_constraint and fails if this file and that one ever disagree, which is what
-- makes "one source of truth" a fact rather than an intention.
--
-- PostgreSQL ENUM types were rejected: a value cannot be dropped or reordered
-- without recreating the type and every column using it. A CHECK is one DROP and
-- one ADD, which is what an additive-only schema needs.
--
-- Nullable columns need no special handling: `col in (...)` is NULL for a NULL
-- input, and a CHECK accepts anything that is not false.
ALTER TABLE person ADD CONSTRAINT person_role_check CHECK (role in ('admin', 'member'));--> statement-breakpoint
ALTER TABLE person ADD CONSTRAINT person_theme_check CHECK (theme in ('dark', 'light'));--> statement-breakpoint
ALTER TABLE account ADD CONSTRAINT account_kind_check
	CHECK (kind in ('current', 'savings', 'brokerage'));--> statement-breakpoint
ALTER TABLE property ADD CONSTRAINT property_kind_check CHECK (kind in ('lived', 'rented'));--> statement-breakpoint
ALTER TABLE property_bill ADD CONSTRAINT property_bill_source_check
	CHECK (source in ('manual', 'meter'));--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_kind_check
	CHECK (kind in ('mortgage', 'car', 'consumer', 'family'));--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_regime_check
	CHECK (regime in ('fixed_period', 'fixed_term', 'floating'));--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_day_count_check
	CHECK (day_count in ('30/360', 'act/365', 'act/360'));--> statement-breakpoint
ALTER TABLE loan ADD CONSTRAINT loan_accrual_style_check
	CHECK (accrual_style in ('payment', 'calendar'));--> statement-breakpoint
ALTER TABLE loan_event ADD CONSTRAINT loan_event_kind_check
	CHECK (kind in ('payment', 'extra_payment', 'refix', 'fee', 'balance'));--> statement-breakpoint
-- Four states. `filed` is written by the demo seed and treated as terminal
-- beside `confirmed` by ingest.ts; the schema comment listing three was wrong.
ALTER TABLE transaction ADD CONSTRAINT transaction_review_state_check
	CHECK (review_state in ('auto', 'needs_review', 'confirmed', 'filed'));--> statement-breakpoint
ALTER TABLE transaction ADD CONSTRAINT transaction_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));--> statement-breakpoint
ALTER TABLE transfer_pair ADD CONSTRAINT transfer_pair_state_check
	CHECK (state in ('auto', 'proposed', 'confirmed', 'rejected'));--> statement-breakpoint
ALTER TABLE job ADD CONSTRAINT job_kind_check
	CHECK (kind in ('import', 'calendar_sync', 'extract_text'));--> statement-breakpoint
ALTER TABLE job ADD CONSTRAINT job_state_check
	CHECK (state in ('queued', 'running', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE import_profile ADD CONSTRAINT import_profile_source_check
	CHECK (source in ('delimited', 'xlsx'));--> statement-breakpoint
ALTER TABLE import_profile ADD CONSTRAINT import_profile_origin_check
	CHECK (origin in ('builtin', 'user', 'imported'));--> statement-breakpoint
ALTER TABLE import_file ADD CONSTRAINT import_file_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));--> statement-breakpoint
ALTER TABLE rule ADD CONSTRAINT rule_provenance_check
	CHECK (provenance in ('learned', 'manual'));--> statement-breakpoint
ALTER TABLE document ADD CONSTRAINT document_expiry_verb_check
	CHECK (expiry_verb in ('expires', 'renews', 'due'));--> statement-breakpoint
-- No normalisation on a bad provider: one that is neither of these cannot be
-- synced with, so rewriting it would hide a broken connection rather than fix it.
ALTER TABLE calendar_account ADD CONSTRAINT calendar_account_provider_check
	CHECK (provider in ('icloud', 'google'));--> statement-breakpoint
ALTER TABLE calendar_conflict ADD CONSTRAINT calendar_conflict_resolution_check
	CHECK (resolution in ('local-won', 'remote-won', 'wrote-back'));--> statement-breakpoint

-- ---- Singletons and shapes ----

-- One row, ever: the wizard is claimed or it is not.
ALTER TABLE setup_claim ADD CONSTRAINT setup_claim_singleton CHECK (claimed = true);--> statement-breakpoint
-- Likewise the broker import high-water mark, which is per-install, not per-row.
ALTER TABLE broker_import_state ADD CONSTRAINT broker_import_state_singleton
	CHECK (id = 'global');--> statement-breakpoint
-- period_on means "the month this document covers", so a mid-month day is either
-- a different fact or a mistake.
ALTER TABLE document ADD CONSTRAINT document_period_first_of_month
	CHECK (period_on IS NULL OR extract(day from period_on) = 1);--> statement-breakpoint

-- ---- The entity supertype ----

-- Three decisions worth stating, because each one is load-bearing.
--
-- 1. `UNIQUE (id, kind)` exists so a concrete table can reference the PAIR. Each
--    table carries a generated `entity_kind` column fixed to its own kind, so a
--    `tag` row can only ever point at an entity registered as a tag. Without it
--    a link table would happily accept an id belonging to a different kind of
--    record, and the resulting row would read as perfectly valid.
--
-- 2. Registration is a BEFORE INSERT trigger, not something callers remember.
--    That is what makes this safe across twelve tables at once: no insert path
--    above the database changes, and an insert that "forgot" to register cannot
--    exist. A helper would have been one more thing to omit, and the composite
--    foreign key would then have turned the omission into a failed write at some
--    unrelated call site.
--
-- 3. Deletion works in both directions. Removing the entity cascades to the
--    record; removing the record retires the entity through an AFTER DELETE
--    trigger. Only the first is a foreign key, so without the second the
--    supertype would fill with orphans that a later link could still attach to.
--    The two do not recurse: by the time either trigger runs, the row it would
--    delete is already gone.

-- The list comes from ENTITY_KINDS in src/lib/enums.ts and is held to it by
-- tests/integration/schema-invariants.test.ts.
ALTER TABLE entity ADD CONSTRAINT entity_kind_check CHECK (kind in (
	'person', 'account', 'transaction', 'transaction_split', 'property',
	'tenancy', 'loan', 'document', 'contact', 'tag', 'subject',
	'tax_statement'));--> statement-breakpoint

-- One generated column, one composite foreign key and two triggers per kind.
-- Written as a loop because twelve copies of the same four statements is twelve
-- chances for one of them to differ by accident.
DO $outer$
DECLARE
	t text;
	has_created_at boolean;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		'person', 'account', 'transaction', 'transaction_split', 'property',
		'tenancy', 'loan', 'document', 'contact', 'tag', 'subject',
		'tax_statement'
	]
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
END $outer$;--> statement-breakpoint

-- ---- The net-worth contract ----

-- Every valued thing, in one place, with the liabilities-are-negative rule
-- applied exactly once rather than in each caller that has to remember it.
--
-- Adding an asset type is one table plus one UNION branch here. Net-worth code
-- reads the view and sums whatever it finds, so "forgot to include vehicles in
-- net worth" stops being a vigilance problem: the branch is the only edit.
--
-- `subkind` carries the row's own kind — an account is `current` or `brokerage`,
-- a property `lived` or `rented` — because the caller has rules that turn on it
-- (a brokerage balance is reported by the broker, not counted as cash) and it
-- would otherwise need a second query per table, which is the coupling the view
-- exists to remove.
--
-- Amounts stay in each row's own currency: this view knows nothing about rates,
-- so summing it across currencies is only meaningful when they agree. The caller
-- converts row by row.
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

-- Two data rows, not schema, and the one part of this file `db:generate` will
-- never re-emit: a regenerated baseline drops them silently, and the first
-- symptom is a screen with a control missing rather than an error.

-- One place for a document to always belong: the household. The documents
-- screen offers it as a tick beside the people, and nothing else creates it.
INSERT INTO subject (id, name, emoji) VALUES (gen_random_uuid(), 'Household', '🏠');--> statement-breakpoint

-- Enough currency for the fourteen foreign keys pointing here to be satisfiable
-- before anything is imported. `refreshCurrencies` replaces and extends this
-- from CLDR on the next boot, so this is a floor, not the list.
INSERT INTO currency (code, exponent, name)
VALUES ('CZK', 2, 'Czech Koruna'), ('EUR', 2, 'Euro')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ---- Banks and category groups ----
--
-- Folded in from what were separate migrations. Continuum has no users, so
-- `drizzle/` carries ONE file describing the current schema rather than a
-- chain describing how it got here — see tests/integration/baseline-migration.
--
-- The reference rows below are seeded here for the same reason `currency` and
-- `subject` are seeded above: a foreign key points at them, so an empty table
-- refuses every insert that follows. `seedBanks()` and `seedCategories()`
-- rewrite them idempotently on every boot, so this is a floor rather than a
-- source of truth.
--
-- What is NOT carried over is the statement that adopted whatever `group_key`
-- existing category rows already named. That was migration logic — it upgraded
-- data written by an older version — and Continuum has no older version to
-- upgrade from.
CREATE TABLE "bank" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"emoji" text DEFAULT '🏦' NOT NULL
);--> statement-breakpoint

CREATE TABLE "category_group" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color_token" text NOT NULL,
	"role" text DEFAULT 'expense' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

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
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "bank" ("key", "label", "emoji") VALUES
	('fio', 'Fio banka', '🏦'),
	('revolut', 'Revolut', '💠'),
	('mbank', 'mBank', '🅜'),
	('rb', 'Raiffeisenbank', '🟡'),
	('cs', 'Česká spořitelna', '🔵'),
	('other', 'Other', '💼')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

ALTER TABLE "category" ADD CONSTRAINT "category_group_key_category_group_key_fk"
	FOREIGN KEY ("group_key") REFERENCES "public"."category_group"("key")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- drizzle-kit models neither CHECK constraints nor the index a foreign key
-- wants, so both are carried by hand exactly as the rest of this file is.
ALTER TABLE category_group ADD CONSTRAINT category_group_role_check
	CHECK (role in ('income', 'expense', 'savings'));--> statement-breakpoint

CREATE INDEX "category_group_key_idx" ON "category" USING btree ("group_key");--> statement-breakpoint

-- ---- The far side of a one-sided transfer ----
ALTER TABLE "transaction" ADD COLUMN "transfer_to_account_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_to_account_id_account_id_fk"
	FOREIGN KEY ("transfer_to_account_id") REFERENCES "public"."account"("id")
	ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_transfer_to_account_idx" ON "transaction" USING btree ("transfer_to_account_id");
--> statement-breakpoint

-- ---- What a property has been worth, and what it cost to buy ----
--
-- `property.value_minor` is a single number: a flat could say what it is worth
-- today and nothing about how it got there. The series below is the history;
-- the column stays as the latest of these so every existing reader is untouched.
CREATE TABLE "property_valuation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"valued_on" date NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"source" text DEFAULT 'estimate' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);--> statement-breakpoint
ALTER TABLE "property_valuation" ADD CONSTRAINT "property_valuation_property_id_property_id_fk"
	FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_valuation" ADD CONSTRAINT "property_valuation_currency_currency_code_fk"
	FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_valuation_property_idx" ON "property_valuation" USING btree ("property_id","valued_on");--> statement-breakpoint
CREATE INDEX "property_valuation_currency_idx" ON "property_valuation" USING btree ("currency");--> statement-breakpoint

-- One row per property: what was actually paid, so money-in need not be
-- reconstructed from transactions that predate the ledger.
CREATE TABLE "property_opening" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"purchased_on" date,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"costs_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL
);--> statement-breakpoint
ALTER TABLE "property_opening" ADD CONSTRAINT "property_opening_property_id_property_id_fk"
	FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_opening" ADD CONSTRAINT "property_opening_currency_currency_code_fk"
	FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every foreign key carries a covering index; schema-invariants.test.ts enforces
-- it, because an unindexed FK turns a delete on the parent into a sequential
-- scan of the child.
CREATE INDEX "property_opening_currency_idx" ON "property_opening" USING btree ("currency");
--> statement-breakpoint

-- ---- Salary, from a payslip or from the bank ----
--
-- Gross and net are two COLUMNS, not two rows: a payslip states gross, a bank
-- credit is net, and they are not competing readings of one number.
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
);--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_person_id_person_id_fk"
	FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_currency_currency_code_fk"
	FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_document_id_document_id_fk"
	FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_entry" ADD CONSTRAINT "salary_entry_transaction_id_transaction_id_fk"
	FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_entry_person_month_idx" ON "salary_entry" USING btree ("person_id","period_month");--> statement-breakpoint
CREATE INDEX "salary_entry_currency_idx" ON "salary_entry" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "salary_entry_document_idx" ON "salary_entry" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "salary_entry_transaction_idx" ON "salary_entry" USING btree ("transaction_id");--> statement-breakpoint

-- One entry per person per month. A payslip and a bank credit for the same
-- month fill their own column of the SAME row rather than racing each other.
CREATE UNIQUE INDEX "salary_entry_person_month_doc_key" ON "salary_entry" USING btree ("person_id","period_month","document_id") WHERE document_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_entry_person_month_key" ON "salary_entry" USING btree ("person_id","period_month") WHERE document_id is null;--> statement-breakpoint

-- Whose salary a payment into a JOINT account is. Deliberately not the `rule`
-- table, whose payload is a category: letting the categoriser assign people
-- mixes two things that fail very differently.
CREATE TABLE "salary_attribution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_key" text NOT NULL,
	"person_id" uuid NOT NULL,
	"account_id" uuid,
	"created_on" date DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "salary_attribution" ADD CONSTRAINT "salary_attribution_person_id_person_id_fk"
	FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_attribution" ADD CONSTRAINT "salary_attribution_account_id_account_id_fk"
	FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_attribution_key_idx" ON "salary_attribution" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "salary_attribution_person_idx" ON "salary_attribution" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "salary_attribution_account_idx" ON "salary_attribution" USING btree ("account_id");

-- ---- Documents v2 ----

-- Trigram matching for identifiers: a variable symbol like 10078410 is not a
-- word to any text-search configuration, so FTS alone never finds it. The
-- extension is schema-qualified in every reference below, as unaccent already
-- is, because search_path is not something a migration should depend on.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Both indexes fold with the SAME expression the query uses. contact_fold is
-- IMMUTABLE and PARALLEL SAFE, which is what makes it indexable at all.
CREATE INDEX dtc_fts_idx ON document_text_chunk
	USING gin (to_tsvector('simple', public.contact_fold(text)));--> statement-breakpoint
CREATE INDEX dtc_trgm_idx ON document_text_chunk
	USING gin (public.contact_fold(text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX document_name_trgm_idx ON document
	USING gin (public.contact_fold(name) gin_trgm_ops);--> statement-breakpoint

ALTER TABLE document ADD CONSTRAINT document_type_check CHECK (type in (
	'contract', 'invoice', 'receipt', 'payslip', 'bank_statement', 'insurance_policy',
	'claim', 'id_document', 'certificate', 'medical_record', 'tax_document',
	'technical_plan', 'correspondence', 'warranty', 'manual', 'other'));--> statement-breakpoint
ALTER TABLE document ADD CONSTRAINT document_sensitivity_check
	CHECK (sensitivity in ('normal', 'restricted'));--> statement-breakpoint
ALTER TABLE document_text_chunk ADD CONSTRAINT document_text_chunk_source_check
	CHECK (source in ('text_layer', 'ocr', 'plain'));--> statement-breakpoint

-- A period that ends before it starts is not a period. NULLs are legal on both
-- sides: a subject that is simply current has neither.
ALTER TABLE subject ADD CONSTRAINT subject_active_period_check
	CHECK (active_from IS NULL OR active_to IS NULL OR active_from <= active_to);--> statement-breakpoint

-- The ten shelves a fresh install starts with. Households edit these freely;
-- `inbox` and `statements` are the two the application refers to by key.
INSERT INTO shelf (id, key, label, emoji, sort_order, system) VALUES
	(gen_random_uuid(), 'inbox',      'Inbox',      '📬',  0, true),
	(gen_random_uuid(), 'identity',   'Identity',   '🪪', 10, false),
	(gen_random_uuid(), 'family',     'Family',     '👶', 20, false),
	(gen_random_uuid(), 'health',     'Health',     '🩺', 30, false),
	(gen_random_uuid(), 'property',   'Property',   '🏠', 40, false),
	(gen_random_uuid(), 'tenancy',    'Tenancy',    '🔑', 50, false),
	(gen_random_uuid(), 'vehicles',   'Vehicles',   '🚗', 60, false),
	(gen_random_uuid(), 'finance',    'Finance',    '🏦', 70, false),
	(gen_random_uuid(), 'household',  'Household',  '🔧', 80, false),
	(gen_random_uuid(), 'statements', 'Statements', '🧾', 90, true)
ON CONFLICT (key) DO NOTHING;
