-- Surrogate keys become `uuid`, and ids become time-ordered.
--
-- Two separate changes that belong in one migration because each is cheap only
-- while the other is happening:
--
-- 1. The COLUMN TYPE. A uuid is 16 bytes against 37 for the same value as text,
--    it compares as an integer pair rather than a varlena, and it cannot hold a
--    string that is not a uuid at all.
--
-- 2. The GENERATOR, in application code: `randomUUID` is v4, which is random
--    across its whole range, so every insert lands in a different part of the
--    B-tree and the index fragments as history grows. UUIDv7 leads with a
--    millisecond timestamp, so new rows append. Measured before choosing: v7
--    values sort in creation order, v4 values do not.
--
-- WHAT DOES NOT CONVERT, and why each one is a decision rather than an omission:
--
--   category — its ids are SLUGS, not surrogates. 'salary', 'groceries',
--     'energy' are referenced by name in the seed and in code, which makes them
--     a natural key. Replacing them with uuids would cost every readable
--     reference and buy nothing: the set is small, fixed and seeded.
--   session, api_token, enrollment_token, webauthn_challenge, credential — the
--     id IS a hash or an authenticator's own identifier. Not ours to choose.
--   broker_operation, broker_position — XTB assigns these, which is exactly what
--     makes re-uploading a report idempotent.
--   broker_import_state, settings, setup_claim, currency, mark_transfer_rule,
--     import_profile, job — keyed by a sentinel, a natural key, or a composite
--     string ('calendar-sync:<id>').
--   calendar_sync_link.local_key, calendar_conflict.local_key — an authored
--     event's uuid OR a generated event's `gen:` key, so not always a uuid.
--   calendar_event_exception.recurrence_id — an occurrence's original start,
--     which is a date, not an id.
--
-- The conversion is driven from pg_catalog rather than a hand-written list of
-- sixty-six columns. PostgreSQL will not alter a referenced column while a
-- foreign key depends on it, so every key is saved, dropped, the columns are
-- retyped, and the keys are put back from their own definitions — which means
-- this cannot silently miss one, and cannot recreate one differently from how it
-- was. One DO block, so it is atomic.

DO $$
DECLARE
	-- Every table whose id is a surrogate we mint ourselves.
	targets text[] := ARRAY[
		'account', 'calendar_account', 'calendar_conflict', 'calendar_event',
		'calendar_event_exception', 'contact', 'document', 'entity', 'holding',
		'import_file', 'loan', 'loan_event', 'loan_fixation_period', 'loan_property',
		'person', 'property', 'property_bill', 'rule', 'subject', 'tag',
		'tax_statement', 'tax_statement_line', 'tenancy', 'transaction',
		'transaction_split', 'transfer_pair'
	];
	fk_add text[];
	fk_drop text[];
	trg_add text[];
	trg_drop text[];
	cols text[];
	s text;
BEGIN
	-- Save every foreign key exactly as PostgreSQL states it.
	SELECT
		array_agg(format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.relname, fk.conname,
			pg_get_constraintdef(fk.oid))),
		array_agg(format('ALTER TABLE %I DROP CONSTRAINT %I', c.relname, fk.conname))
	INTO fk_add, fk_drop
	FROM pg_constraint fk
	JOIN pg_class c ON c.oid = fk.conrelid
	WHERE fk.contype = 'f' AND c.relnamespace = 'public'::regnamespace;

	-- Triggers too. A trigger declared `UPDATE OF <column>` names that column in
	-- its definition, and PostgreSQL refuses to retype a column a trigger depends
	-- on — `maintain_transfer_pair_legs` watches the two transaction columns on
	-- transfer_pair for exactly that reason. Internal triggers are skipped: those
	-- belong to the foreign keys and come back with them.
	SELECT
		array_agg(pg_get_triggerdef(t.oid)),
		array_agg(format('DROP TRIGGER %I ON %I', t.tgname, c.relname))
	INTO trg_add, trg_drop
	FROM pg_trigger t
	JOIN pg_class c ON c.oid = t.tgrelid
	WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace;

	-- The ids themselves, plus every column that points at one of them. Paired by
	-- ordinality so a COMPOSITE key contributes only its id half: the entity
	-- foreign keys are (id, entity_kind) -> (id, kind), and `entity_kind` is a
	-- generated text column that stays text.
	-- Only tables that actually exist: a suite may build a partial world from a
	-- subset of the migrations, and a target that is not there yet is not an error.
	SELECT array_agg(t) INTO targets FROM unnest(targets) AS t
	WHERE EXISTS (
		SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
	);

	SELECT array_agg(DISTINCT x) INTO cols FROM (
		SELECT format('%s.id', t) AS x FROM unnest(targets) AS t
		UNION
		SELECT format('%s.%s', c.relname, a.attname)
		FROM pg_constraint fk
		JOIN pg_class c ON c.oid = fk.conrelid
		JOIN pg_class p ON p.oid = fk.confrelid
		CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.attnum
		JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS f(attnum, ord2)
			ON f.ord2 = k.ord
		JOIN pg_attribute pa ON pa.attrelid = fk.confrelid AND pa.attnum = f.attnum
		WHERE fk.contype = 'f'
			AND c.relnamespace = 'public'::regnamespace
			AND p.relname = ANY(targets)
			AND pa.attname = 'id'
	) q;

	-- Soft pointers: real references with no foreign key to find them by.
	-- transfer_pair_id is deliberately not a key, to avoid a cycle with
	-- transfer_pair's own two references back to transaction. job.subject_id names
	-- an account or a calendar account, both of which are converting.
	FOR s IN SELECT unnest(ARRAY['transaction.transfer_pair_id', 'job.subject_id']) LOOP
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = split_part(s, '.', 1)
			  AND column_name = split_part(s, '.', 2)
		) THEN
			cols := cols || s;
		END IF;
	END LOOP;

	FOREACH s IN ARRAY trg_drop LOOP EXECUTE s; END LOOP;
	FOREACH s IN ARRAY fk_drop LOOP EXECUTE s; END LOOP;

	FOREACH s IN ARRAY cols LOOP
		EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE uuid USING %I::uuid',
			split_part(s, '.', 1), split_part(s, '.', 2), split_part(s, '.', 2));
	END LOOP;

	FOREACH s IN ARRAY fk_add LOOP EXECUTE s; END LOOP;
	FOREACH s IN ARRAY trg_add LOOP EXECUTE s; END LOOP;
END $$;
