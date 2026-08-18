ALTER TABLE "import_file" ADD COLUMN "source_method" text;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "proof_class" text;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "ledger_model" text;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "opening_balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "closing_balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "stated_credit_total_minor" bigint;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "stated_debit_total_minor" bigint;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "stated_row_count" integer;--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "reconciliation" jsonb;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "source_method" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "proof_class" text;