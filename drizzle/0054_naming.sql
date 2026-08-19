-- The locked naming conventions, applied.
--
-- Three rules, each of which was already true of most of the schema and false
-- of enough of it to be worth settling while there is nothing to migrate:
--
--   money      `*_minor`, always bigint
--   a date     `*_on`
--   an instant `*_at`
--
-- `transaction.amount` is the one that mattered. It held minor units like every
-- other money column and said so nowhere, which is exactly the sort of thing a
-- reader has to already know. Everything else here is a `_date`/`_as_of` suffix
-- predating the rule, or a column whose name claimed the wrong kind: property
-- was `valued_at` while holding a date, and holding was `as_of` while holding an
-- instant, so the two said the opposite of what they were.
--
-- Enforced from here by tests/integration/schema-invariants.test.ts, which reads
-- information_schema and fails on any date, instant or money column that does
-- not follow. `day` on the snapshot and rate tables is allowlisted there: it is
-- a time dimension key rather than an attribute of the row.

-- Driven from a list and guarded on the old name existing, because some suites
-- build a partial world from a subset of the migrations and a rename that does
-- not apply there is not a failure.
DO $$
DECLARE
	r record;
BEGIN
	FOR r IN SELECT * FROM (VALUES
		('transaction','amount','amount_minor'),
		('transaction','booked_at','booked_on'),
		('transaction','value_date','value_on'),
		('account','balance_as_of','balance_on'),
		('property','valued_at','valued_on'),
		('holding','as_of','valued_at'),
		('loan','start_date','starts_on'),
		('loan','end_date','ends_on'),
		('loan','owed_as_of','owed_on'),
		('loan_fixation_period','start_date','starts_on'),
		('loan_fixation_period','end_date','ends_on'),
		('tenancy','start_date','starts_on'),
		('tenancy','end_date','ends_on'),
		('tenancy','renewal_notice_date','renewal_notice_on'),
		('document','amount_currency','currency')
	) AS t(tbl, old, new)
	LOOP
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.old
		) THEN
			EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', r.tbl, r.old, r.new);
		END IF;
	END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE IF EXISTS networth_snapshot RENAME TO net_worth_snapshot;--> statement-breakpoint

ALTER INDEX IF EXISTS transaction_booked_idx RENAME TO transaction_booked_on_idx;--> statement-breakpoint
ALTER INDEX IF EXISTS networth_snapshot_currency_idx RENAME TO net_worth_snapshot_currency_idx;--> statement-breakpoint
ALTER INDEX IF EXISTS document_amount_currency_idx RENAME TO document_currency_idx;
