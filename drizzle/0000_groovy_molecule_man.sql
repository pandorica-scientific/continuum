CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏦' NOT NULL,
	"bank" text NOT NULL,
	"kind" text DEFAULT 'current' NOT NULL,
	"currency" text NOT NULL,
	"owner_person_id" text,
	"numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"balance_as_of" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"group_key" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"matcher_type" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" text NOT NULL,
	"provenance" text DEFAULT 'learned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rate" (
	"code" text NOT NULL,
	"day" date NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	CONSTRAINT "currency_rate_code_day_pk" PRIMARY KEY("code","day")
);
--> statement-breakpoint
CREATE TABLE "import_file" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"bank" text NOT NULL,
	"format" text NOT NULL,
	"account_id" text,
	"content_hash" text NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_added" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"rows_paired" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_file_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "mark_transfer_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"counterparty_account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_transfer_rule_counterparty_account_unique" UNIQUE("counterparty_account")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"role" text DEFAULT 'adult' NOT NULL,
	"birth_year" integer,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"booked_at" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"counterparty" text,
	"counterparty_account" text,
	"variable_symbol" text,
	"description" text,
	"bank_ref" text,
	"dedup_fingerprint" text NOT NULL,
	"category_id" text,
	"review_state" text DEFAULT 'needs_review' NOT NULL,
	"review_reason" text,
	"import_file_id" text,
	"transfer_pair_id" text
);
--> statement-breakpoint
CREATE TABLE "transfer_pair" (
	"id" text PRIMARY KEY NOT NULL,
	"out_transaction_id" text NOT NULL,
	"in_transaction_id" text NOT NULL,
	"state" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_import_file_id_import_file_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rule_matcher_idx" ON "category_rule" USING btree ("matcher_type","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_dedup_idx" ON "transaction" USING btree ("account_id","dedup_fingerprint");--> statement-breakpoint
CREATE INDEX "transaction_booked_idx" ON "transaction" USING btree ("booked_at");--> statement-breakpoint
CREATE INDEX "transaction_review_idx" ON "transaction" USING btree ("review_state");