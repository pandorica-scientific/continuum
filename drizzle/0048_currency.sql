-- A currency reference table, so a currency code is a foreign key rather than
-- three characters nobody checked.
--
-- WHAT THIS IS NOT FOR. The zero-decimal currency defect is already fixed in
-- code: `$lib/money` reads each currency's exponent from the runtime's CLDR
-- data via `minorDigits`, and `import/fingerprint.ts` carries a v3 version
-- bumped precisely because that stopped assuming two. Every literal `100` left
-- in money-adjacent code is a percentage or a unit conversion. This table does
-- not re-fix that, and nothing here should be read as though it did.
--
-- What it fixes is that `isCurrencyCode` runs in the application, so a code
-- written by raw SQL, by a migration, or by a path that skipped validation
-- still landed. `refreshRates` was one such path: it inserted whatever code the
-- CNB fixing printed, and `availableCurrencies` then offered it as selectable —
-- which is how a Polish column heading once became a currency. A foreign key
-- ends that class of problem for all fourteen columns at once.
--
-- The rows are MATERIALISED FROM CLDR on every boot by `refreshCurrencies`, not
-- seeded here. A hand-written ISO 4217 list would be a second source of truth
-- free to drift from `money.ts`, and the two genuinely disagree: ISO gives HUF
-- two decimal places, CLDR gives zero, and CLDR is how the currency is written.
--
-- ON DELETE is absent, so NO ACTION: a currency cannot be removed while
-- anything is denominated in it. That is correct — there is no other currency a
-- transaction could be reassigned to, and nulling it would strip the meaning
-- from the amount beside it.

CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"exponent" integer NOT NULL,
	"name" text NOT NULL
);--> statement-breakpoint
-- Enough to attach the constraints below on a database that already holds data.
-- `refreshCurrencies` replaces and extends this on the next boot.
INSERT INTO "currency" ("code", "exponent", "name")
VALUES ('CZK', 2, 'Czech Koruna'), ('EUR', 2, 'Euro')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- Whatever a database already holds becomes a row rather than blocking the
-- constraints. A ONE-TIME repair of existing data, not a standing behaviour:
-- after this an unrecognised code is refused at the insert. Exponent 2 is a
-- placeholder for a code recorded only to keep it referenceable;
-- `refreshCurrencies` corrects it for anything CLDR knows.
INSERT INTO "currency" ("code", "exponent", "name")
SELECT DISTINCT code, 2, code FROM (
	SELECT currency AS code FROM "account"
	UNION SELECT currency FROM "import_file"
	UNION SELECT currency FROM "transaction"
	UNION SELECT original_currency FROM "transaction"
	UNION SELECT currency FROM "property"
	UNION SELECT currency FROM "loan"
	UNION SELECT amount_currency FROM "document"
	UNION SELECT currency FROM "tax_statement"
	UNION SELECT currency FROM "holding"
	UNION SELECT currency FROM "broker_operation"
	UNION SELECT currency FROM "broker_position"
	UNION SELECT currency FROM "portfolio_snapshot"
	UNION SELECT currency FROM "networth_snapshot"
	UNION SELECT currency FROM "broker_import_state"
	UNION SELECT code FROM "currency_rate"
) present
WHERE code IS NOT NULL AND code <> ''
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_import_state" ADD CONSTRAINT "broker_import_state_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_operation" ADD CONSTRAINT "broker_operation_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_position" ADD CONSTRAINT "broker_position_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_rate" ADD CONSTRAINT "currency_rate_code_currency_code_fk" FOREIGN KEY ("code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_amount_currency_currency_code_fk" FOREIGN KEY ("amount_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networth_snapshot" ADD CONSTRAINT "networth_snapshot_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_original_currency_currency_code_fk" FOREIGN KEY ("original_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_currency_idx" ON "account" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "broker_import_state_currency_idx" ON "broker_import_state" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "broker_operation_currency_idx" ON "broker_operation" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "broker_position_currency_idx" ON "broker_position" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "document_amount_currency_idx" ON "document" USING btree ("amount_currency");--> statement-breakpoint
CREATE INDEX "holding_currency_idx" ON "holding" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "import_file_currency_idx" ON "import_file" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "loan_currency_idx" ON "loan" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "networth_snapshot_currency_idx" ON "networth_snapshot" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "portfolio_snapshot_currency_idx" ON "portfolio_snapshot" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "property_currency_idx" ON "property" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "tax_statement_currency_idx" ON "tax_statement" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "transaction_currency_idx" ON "transaction" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "transaction_original_currency_idx" ON "transaction" USING btree ("original_currency");