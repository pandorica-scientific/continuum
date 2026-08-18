-- How each statement was read, and what proved it.
--
-- Until now nothing about the reading survived the import: the proof engine
-- decided whether to file a statement and then threw its evidence away, so the
-- ledger held numbers with no account of where they came from. A row that
-- turns out to be wrong could not be traced to the reading that produced it,
-- and "show me everything that came from OCR" had nothing to query.
ALTER TABLE "import_file" ADD COLUMN "proof_class" text;
ALTER TABLE "import_file" ADD COLUMN "source_method" text;
ALTER TABLE "import_file" ADD COLUMN "ledger_model" text;
ALTER TABLE "import_file" ADD COLUMN "currency" text;
ALTER TABLE "import_file" ADD COLUMN "opening_balance_minor" bigint;
ALTER TABLE "import_file" ADD COLUMN "closing_balance_minor" bigint;
ALTER TABLE "import_file" ADD COLUMN "stated_credit_total_minor" bigint;
ALTER TABLE "import_file" ADD COLUMN "stated_debit_total_minor" bigint;
ALTER TABLE "import_file" ADD COLUMN "stated_row_count" integer;
-- The individual checks, as the evidence panel shows them: name, status, detail.
ALTER TABLE "import_file" ADD COLUMN "reconciliation" jsonb;

-- Per row, so a single transaction can answer for itself even after the file
-- it came from has been re-parsed or superseded.
ALTER TABLE "transaction" ADD COLUMN "source_method" text;
ALTER TABLE "transaction" ADD COLUMN "proof_class" text;

CREATE INDEX "transaction_source_method_idx" ON "transaction" ("source_method");
