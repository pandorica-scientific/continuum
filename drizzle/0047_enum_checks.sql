-- A CHECK for every closed set of column values.
--
-- Twenty columns held their permitted values only in a comment beside the
-- declaration, and the comments had already drifted: `transaction.review_state`
-- documented three states while the code wrote four, and `document.shelf`
-- documented eight shelves while the app offered nine. Nothing compared them,
-- so nothing noticed.
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
-- Each constraint is preceded by a normalisation of anything that would violate
-- it. On well-formed data every one of these is a no-op; they exist so this
-- migration cannot fail halfway on a developer's own database.
--
-- Nullable columns need no special handling: `col in (...)` is NULL for a NULL
-- input, and a CHECK accepts anything that is not false.

-- person.role already carries a check from 0026; recreate it under the locked
-- name so the parity test finds it where it expects.
ALTER TABLE person DROP CONSTRAINT IF EXISTS person_role_check;
ALTER TABLE person ADD CONSTRAINT person_role_check CHECK (role in ('admin', 'member'));

UPDATE account SET kind = 'current' WHERE kind not in ('current', 'savings', 'brokerage');
ALTER TABLE account ADD CONSTRAINT account_kind_check
	CHECK (kind in ('current', 'savings', 'brokerage'));

UPDATE property SET kind = 'lived' WHERE kind not in ('lived', 'rented');
ALTER TABLE property ADD CONSTRAINT property_kind_check CHECK (kind in ('lived', 'rented'));

UPDATE property_bill SET source = 'manual' WHERE source not in ('manual', 'meter');
ALTER TABLE property_bill ADD CONSTRAINT property_bill_source_check
	CHECK (source in ('manual', 'meter'));

UPDATE loan SET kind = 'mortgage' WHERE kind not in ('mortgage', 'car', 'consumer', 'family');
ALTER TABLE loan ADD CONSTRAINT loan_kind_check
	CHECK (kind in ('mortgage', 'car', 'consumer', 'family'));

UPDATE loan SET regime = 'fixed_period'
	WHERE regime not in ('fixed_period', 'fixed_term', 'floating');
ALTER TABLE loan ADD CONSTRAINT loan_regime_check
	CHECK (regime in ('fixed_period', 'fixed_term', 'floating'));

UPDATE loan SET day_count = '30/360' WHERE day_count not in ('30/360', 'act/365', 'act/360');
ALTER TABLE loan ADD CONSTRAINT loan_day_count_check
	CHECK (day_count in ('30/360', 'act/365', 'act/360'));

UPDATE loan SET accrual_style = 'payment' WHERE accrual_style not in ('payment', 'calendar');
ALTER TABLE loan ADD CONSTRAINT loan_accrual_style_check
	CHECK (accrual_style in ('payment', 'calendar'));

UPDATE loan_event SET kind = 'payment'
	WHERE kind not in ('payment', 'extra_payment', 'refix', 'fee', 'balance');
ALTER TABLE loan_event ADD CONSTRAINT loan_event_kind_check
	CHECK (kind in ('payment', 'extra_payment', 'refix', 'fee', 'balance'));

-- Four states. `filed` is written by the demo seed and treated as terminal
-- beside `confirmed` by ingest.ts; the schema comment listing three was wrong.
UPDATE transaction SET review_state = 'needs_review'
	WHERE review_state not in ('auto', 'needs_review', 'confirmed', 'filed');
ALTER TABLE transaction ADD CONSTRAINT transaction_review_state_check
	CHECK (review_state in ('auto', 'needs_review', 'confirmed', 'filed'));

UPDATE transaction SET proof_class = NULL
	WHERE proof_class is not null and proof_class not in ('P4', 'P3', 'P2', 'P1', 'P0');
ALTER TABLE transaction ADD CONSTRAINT transaction_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));

UPDATE transfer_pair SET state = 'auto'
	WHERE state not in ('auto', 'proposed', 'confirmed', 'rejected');
ALTER TABLE transfer_pair ADD CONSTRAINT transfer_pair_state_check
	CHECK (state in ('auto', 'proposed', 'confirmed', 'rejected'));

-- An unrecognised state is not runnable, so it is failed rather than requeued.
UPDATE import_job SET state = 'failed'
	WHERE state not in ('queued', 'running', 'done', 'failed');
ALTER TABLE import_job ADD CONSTRAINT import_job_state_check
	CHECK (state in ('queued', 'running', 'done', 'failed'));

UPDATE import_profile SET source = 'delimited' WHERE source not in ('delimited', 'xlsx');
ALTER TABLE import_profile ADD CONSTRAINT import_profile_source_check
	CHECK (source in ('delimited', 'xlsx'));

UPDATE import_profile SET origin = 'user' WHERE origin not in ('builtin', 'user', 'imported');
ALTER TABLE import_profile ADD CONSTRAINT import_profile_origin_check
	CHECK (origin in ('builtin', 'user', 'imported'));

UPDATE import_file SET proof_class = NULL
	WHERE proof_class is not null and proof_class not in ('P4', 'P3', 'P2', 'P1', 'P0');
ALTER TABLE import_file ADD CONSTRAINT import_file_proof_class_check
	CHECK (proof_class in ('P4', 'P3', 'P2', 'P1', 'P0'));

-- Migration 0033 retired 'seeded'; anything still carrying it becomes 'learned'.
UPDATE rule SET provenance = 'learned' WHERE provenance not in ('learned', 'manual');
ALTER TABLE rule ADD CONSTRAINT rule_provenance_check
	CHECK (provenance in ('learned', 'manual'));

UPDATE document SET shelf = 'family' WHERE shelf not in (
	'payslips', 'tax', 'identity', 'family', 'health', 'property', 'tenancy', 'loans', 'insurance');
ALTER TABLE document ADD CONSTRAINT document_shelf_check CHECK (shelf in (
	'payslips', 'tax', 'identity', 'family', 'health', 'property', 'tenancy', 'loans', 'insurance'));

UPDATE document SET expiry_verb = 'expires'
	WHERE expiry_verb not in ('expires', 'ends', 'renews', 'due');
ALTER TABLE document ADD CONSTRAINT document_expiry_verb_check
	CHECK (expiry_verb in ('expires', 'ends', 'renews', 'due'));

-- No normalisation: a provider that is neither of these cannot be synced with,
-- so silently rewriting it would hide a broken connection rather than fix it.
ALTER TABLE calendar_account ADD CONSTRAINT calendar_account_provider_check
	CHECK (provider in ('icloud', 'google'));

UPDATE calendar_conflict SET resolution = 'local-won'
	WHERE resolution not in ('local-won', 'remote-won', 'wrote-back');
ALTER TABLE calendar_conflict ADD CONSTRAINT calendar_conflict_resolution_check
	CHECK (resolution in ('local-won', 'remote-won', 'wrote-back'));
