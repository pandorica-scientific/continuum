-- Rescale amounts stored under the old "every currency has two minor units"
-- assumption.
--
-- minorDigits() used to be a four-entry table with a default of 2, while the
-- currency picker offers every code the CNB quotes. CLDR gives HUF, JPY, IDR,
-- KRW, ISK, VND, CLP and COP no minor unit at all, and KWD, BHD, OMR, JOD and
-- TND three. Now that minorDigits reads that data, a row written before this
-- change is reinterpreted rather than merely displayed differently: a JPY
-- holding typed as 1 500 000 was stored as 150000000 and would read as
-- 150 000 000 — a hundredfold error in net worth, the accounts screen, the
-- register's amount filter and the API wire format alike.
--
-- Every UPDATE below is scoped to those currencies, so this is a complete
-- no-op for CZK, EUR, USD, PLN and every other two-digit currency — which is
-- every currency an existing installation can have used correctly.
--
-- The division is exact: a value written under the old assumption is always
-- major x 100, so no cent is lost. Tables without a currency column of their
-- own take it from their parent, which is the same currency their amounts were
-- entered in.

-- ---- Tables carrying their own currency ----

UPDATE "account" SET "balance_minor" = "balance_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "account" SET "balance_minor" = "balance_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "transaction" SET
		"amount" = "amount" / 100,
		"fee_minor" = "fee_minor" / 100,
		"balance_after_minor" = "balance_after_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "transaction" SET
		"amount" = "amount" * 10,
		"fee_minor" = "fee_minor" * 10,
		"balance_after_minor" = "balance_after_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

-- The original amount of a foreign card payment is denominated in its own
-- currency, not the account's.
UPDATE "transaction" SET "original_amount_minor" = "original_amount_minor" / 100
	WHERE "original_currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "transaction" SET "original_amount_minor" = "original_amount_minor" * 10
	WHERE "original_currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "property" SET "value_minor" = "value_minor" / 100, "money_in_minor" = "money_in_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "property" SET "value_minor" = "value_minor" * 10, "money_in_minor" = "money_in_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "loan" SET "principal_minor" = "principal_minor" / 100, "owed_minor" = "owed_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "loan" SET "principal_minor" = "principal_minor" * 10, "owed_minor" = "owed_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "holding" SET "value_minor" = "value_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "holding" SET "value_minor" = "value_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "portfolio_snapshot" SET "value_minor" = "value_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "portfolio_snapshot" SET "value_minor" = "value_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "networth_snapshot" SET "value_minor" = "value_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "networth_snapshot" SET "value_minor" = "value_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "broker_operation" SET "amount_minor" = "amount_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "broker_operation" SET "amount_minor" = "amount_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "broker_position" SET
		"purchase_value_minor" = "purchase_value_minor" / 100,
		"sale_value_minor" = "sale_value_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "broker_position" SET
		"purchase_value_minor" = "purchase_value_minor" * 10,
		"sale_value_minor" = "sale_value_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "tax_statement" SET
		"gross_income_minor" = "gross_income_minor" / 100,
		"tax_paid_minor" = "tax_paid_minor" / 100
	WHERE "currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "tax_statement" SET
		"gross_income_minor" = "gross_income_minor" * 10,
		"tax_paid_minor" = "tax_paid_minor" * 10
	WHERE "currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "document" SET "amount_minor" = "amount_minor" / 100
	WHERE "amount_currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "document" SET "amount_minor" = "amount_minor" * 10
	WHERE "amount_currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

-- ---- Tables taking their currency from a parent ----

UPDATE "transaction_split" s SET "amount_minor" = s."amount_minor" / 100
	FROM "transaction" t WHERE t."id" = s."transaction_id"
	  AND t."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "transaction_split" s SET "amount_minor" = s."amount_minor" * 10
	FROM "transaction" t WHERE t."id" = s."transaction_id"
	  AND t."currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "property_bill" b SET "amount_minor" = b."amount_minor" / 100
	FROM "property" p WHERE p."id" = b."property_id"
	  AND p."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "property_bill" b SET "amount_minor" = b."amount_minor" * 10
	FROM "property" p WHERE p."id" = b."property_id"
	  AND p."currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "tenancy" t SET "rent_minor" = t."rent_minor" / 100, "deposit_minor" = t."deposit_minor" / 100
	FROM "property" p WHERE p."id" = t."property_id"
	  AND p."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "tenancy" t SET "rent_minor" = t."rent_minor" * 10, "deposit_minor" = t."deposit_minor" * 10
	FROM "property" p WHERE p."id" = t."property_id"
	  AND p."currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "loan_fixation_period" f SET "payment_minor" = f."payment_minor" / 100
	FROM "loan" l WHERE l."id" = f."loan_id"
	  AND l."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "loan_fixation_period" f SET "payment_minor" = f."payment_minor" * 10
	FROM "loan" l WHERE l."id" = f."loan_id"
	  AND l."currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "loan_event" e SET
		"amount_minor" = e."amount_minor" / 100,
		"interest_minor" = e."interest_minor" / 100
	FROM "loan" l WHERE l."id" = e."loan_id"
	  AND l."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "loan_event" e SET
		"amount_minor" = e."amount_minor" * 10,
		"interest_minor" = e."interest_minor" * 10
	FROM "loan" l WHERE l."id" = e."loan_id"
	  AND l."currency" IN ('KWD','BHD','OMR','JOD','TND');
--> statement-breakpoint

UPDATE "tax_statement_line" li SET "amount_minor" = li."amount_minor" / 100
	FROM "tax_statement" ts WHERE ts."id" = li."statement_id"
	  AND ts."currency" IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP');
UPDATE "tax_statement_line" li SET "amount_minor" = li."amount_minor" * 10
	FROM "tax_statement" ts WHERE ts."id" = li."statement_id"
	  AND ts."currency" IN ('KWD','BHD','OMR','JOD','TND');
