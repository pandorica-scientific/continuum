-- Constraints and types the schema was missing, closed while there are still no
-- deployments to migrate.
--
-- Each of these was loose for a reason that has expired: a column added after its
-- table existed and never made required, a foreign key nobody got round to, a
-- date kept as text because the first writer had a string in hand.
--
-- NOT INCLUDED: the source dimension on the snapshot tables, which the plan for
-- this release called for. `portfolio_snapshot` is keyed on `day` alone, and a
-- second broker would indeed collide — but nothing in the investment model
-- carries a broker identity to key on. `broker_import_state.id` is the literal
-- string 'global', and neither `holding` nor `portfolio_snapshot` has an account
-- column. Adding `source_id` now would mean writing a hardcoded constant into
-- every row, which relocates the singleton assumption rather than removing it.
-- Giving a portfolio an identity is the prerequisite, and it is a feature rather
-- than a constraint. Recorded here so the omission is a decision and not a
-- forgotten line.

-- broker_operation.position_id referenced nothing at all, so an operation could
-- name a position that was never imported and the reconstructed value curve would
-- lose that cash movement without complaint.
DELETE FROM broker_operation
	WHERE position_id IS NOT NULL
	  AND position_id NOT IN (SELECT id FROM broker_position);--> statement-breakpoint
ALTER TABLE broker_operation ADD CONSTRAINT broker_operation_position_fk
	FOREIGN KEY (position_id) REFERENCES broker_position(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX broker_operation_position_idx ON broker_operation(position_id);--> statement-breakpoint

-- These three were added to import_file after it existed and left nullable, so a
-- statement could be filed carrying no record of what read it or how strongly it
-- was proven — the one thing the provenance columns exist for. The defaults below
-- are the honest reading of an older row: unknown, and unproven.
UPDATE import_file SET currency = 'CZK' WHERE currency IS NULL;--> statement-breakpoint
UPDATE import_file SET source_method = 'unknown' WHERE source_method IS NULL;--> statement-breakpoint
UPDATE import_file SET proof_class = 'P0' WHERE proof_class IS NULL;--> statement-breakpoint
ALTER TABLE import_file ALTER COLUMN currency SET NOT NULL;--> statement-breakpoint
ALTER TABLE import_file ALTER COLUMN source_method SET NOT NULL;--> statement-breakpoint
ALTER TABLE import_file ALTER COLUMN proof_class SET NOT NULL;--> statement-breakpoint

-- period_month held a 'YYYY-MM' string with nothing enforcing the shape, and the
-- FX join had to carry `period_month ~ '^\d{4}-\d{2}$' then (period_month ||
-- '-01')::date` to use it at all — a regex that silently skipped any value
-- written another way. A real date removes both the cast and the silence.
ALTER TABLE document ADD COLUMN period_on date;--> statement-breakpoint
UPDATE document SET period_on = to_date(period_month || '-01', 'YYYY-MM-DD')
	WHERE period_month ~ '^\d{4}-\d{2}$';--> statement-breakpoint
ALTER TABLE document DROP COLUMN period_month;--> statement-breakpoint
-- The column means "the month this document covers", so a mid-month day is either
-- a different fact or a mistake.
ALTER TABLE document ADD CONSTRAINT document_period_first_of_month
	CHECK (period_on IS NULL OR extract(day from period_on) = 1);--> statement-breakpoint

-- interest_deductible was an integer holding 0 or 1, and every caller already
-- passed a boolean and converted on the way in.
ALTER TABLE loan ALTER COLUMN interest_deductible DROP DEFAULT;--> statement-breakpoint
ALTER TABLE loan ALTER COLUMN interest_deductible TYPE boolean
	USING interest_deductible <> 0;--> statement-breakpoint
ALTER TABLE loan ALTER COLUMN interest_deductible SET DEFAULT false;
