-- Migration 0023 rescaled zero- and three-minor-digit transaction amounts,
-- but installations where it had already run retained hashes made from the
-- old amounts. Rebuild those hashes with fingerprint version 3 without ever
-- exposing duplicate final hashes through transaction_dedup_idx.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE TEMP TABLE transaction_fingerprint_repair (
	transaction_id text PRIMARY KEY,
	fingerprint text NOT NULL
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.continuum_fingerprint(
	booked_at text,
	amount_minor text,
	currency_code text,
	bank_reference text,
	counterparty_account text,
	counterparty_name text,
	balance_after text,
	occurrence text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT encode(digest(
		convert_to(coalesce(booked_at, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(amount_minor, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(currency_code, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(bank_reference, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(counterparty_account, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(counterparty_name, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(balance_after, ''), 'UTF8') || decode('00', 'hex') ||
		convert_to(coalesce(occurrence, ''), 'UTF8'),
		'sha256'
	), 'hex')
$$;--> statement-breakpoint

INSERT INTO transaction_fingerprint_repair (transaction_id, fingerprint)
WITH target AS (
	SELECT
		t.*,
		CASE
			WHEN t.currency IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP')
				THEN t.amount * 100
			ELSE t.amount / 10
		END AS old_amount,
		CASE
			WHEN t.balance_after_minor IS NULL THEN NULL
			WHEN t.currency IN ('JPY','HUF','IDR','KRW','ISK','VND','CLP','COP')
				THEN t.balance_after_minor * 100
			ELSE t.balance_after_minor / 10
		END AS old_balance,
		row_number() OVER (
			PARTITION BY t.import_file_id, t.booked_at, t.amount, t.currency,
				nullif(t.bank_ref, ''),
				CASE WHEN nullif(t.bank_ref, '') IS NULL THEN t.counterparty_account END,
				CASE WHEN nullif(t.bank_ref, '') IS NULL THEN t.counterparty END,
				CASE WHEN nullif(t.bank_ref, '') IS NULL THEN t.balance_after_minor END
			ORDER BY t.dedup_fingerprint, t.id
		) - 1 AS fallback_occurrence
	FROM "transaction" t
	WHERE t.currency IN (
		'JPY','HUF','IDR','KRW','ISK','VND','CLP','COP',
		'KWD','BHD','OMR','JOD','TND'
	) AND t.fingerprint_version < 3
		-- Revolut v1 folded an unrecorded fee into amount. Even after 0023
		-- rescaled the row, SQL cannot infer the gross amount needed for v3.
		-- Leave it as v1; a later source replay records its current fingerprint
		-- as an alias without rewriting user filing or split amounts.
		AND NOT (
			t.fingerprint_version = 1
			AND (
				EXISTS (
					SELECT 1 FROM import_file source
					WHERE source.id = t.import_file_id AND source.bank = 'revolut'
				)
				OR EXISTS (
					SELECT 1 FROM account owner
					WHERE owner.id = t.account_id AND owner.bank = 'revolut'
				)
			)
		)
), resolved AS (
	SELECT target.*,
		coalesce(matched.occurrence, target.fallback_occurrence) AS occurrence
	FROM target
	LEFT JOIN LATERAL (
		SELECT candidate AS occurrence
		FROM generate_series(
			0,
			greatest(
				1,
				coalesce((SELECT source.rows_read FROM import_file source
					WHERE source.id = target.import_file_id), 0),
				(SELECT count(*)::int FROM "transaction" same_file
					WHERE same_file.import_file_id = target.import_file_id)
			)
		) candidate
		WHERE pg_temp.continuum_fingerprint(
			target.booked_at::text,
			target.old_amount::text,
			target.currency,
			coalesce(target.bank_ref, ''),
			CASE WHEN nullif(target.bank_ref, '') IS NULL THEN coalesce(target.counterparty_account, '') ELSE '' END,
			CASE WHEN nullif(target.bank_ref, '') IS NULL THEN coalesce(target.counterparty, '') ELSE '' END,
			CASE WHEN nullif(target.bank_ref, '') IS NULL THEN coalesce(target.old_balance::text, '') ELSE '' END,
			CASE WHEN nullif(target.bank_ref, '') IS NOT NULL AND candidate = 0 THEN '' ELSE candidate::text END
		) = target.dedup_fingerprint
		LIMIT 1
	) matched ON true
)
SELECT
	id,
	pg_temp.continuum_fingerprint(
		booked_at::text,
		amount::text,
		currency,
		coalesce(bank_ref, ''),
		CASE WHEN nullif(bank_ref, '') IS NULL THEN coalesce(counterparty_account, '') ELSE '' END,
		CASE WHEN nullif(bank_ref, '') IS NULL THEN coalesce(counterparty, '') ELSE '' END,
		CASE WHEN nullif(bank_ref, '') IS NULL THEN coalesce(balance_after_minor::text, '') ELSE '' END,
		CASE WHEN nullif(bank_ref, '') IS NOT NULL AND occurrence = 0 THEN '' ELSE occurrence::text END
	)
FROM resolved;--> statement-breakpoint

-- A correctly fingerprinted v3 row can already occupy the key a legacy row
-- is about to receive. They are the same economic movement, so retaining both
-- under invented hashes would double the ledger. Prefer the row that already
-- has the current fingerprint; when all colliding rows need repair, keep the
-- lexicographically first id so the choice is deterministic.
CREATE TEMP TABLE transaction_fingerprint_collision (
	redundant_id text PRIMARY KEY,
	canonical_id text NOT NULL
);--> statement-breakpoint

INSERT INTO transaction_fingerprint_collision (redundant_id, canonical_id)
WITH desired AS (
	SELECT
		t.id AS transaction_id,
		t.account_id,
		coalesce(repair.fingerprint, t.dedup_fingerprint) AS fingerprint,
		CASE WHEN repair.transaction_id IS NULL THEN 0 ELSE 1 END AS repair_rank
	FROM "transaction" t
	LEFT JOIN transaction_fingerprint_repair repair ON repair.transaction_id = t.id
	WHERE repair.transaction_id IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM transaction_fingerprint_repair candidate
			JOIN "transaction" target ON target.id = candidate.transaction_id
			WHERE target.account_id = t.account_id
				AND candidate.fingerprint = t.dedup_fingerprint
		)
), ranked AS (
	SELECT
		transaction_id,
		first_value(transaction_id) OVER (
			PARTITION BY account_id, fingerprint
			ORDER BY repair_rank, transaction_id
		) AS canonical_id,
		count(*) OVER (PARTITION BY account_id, fingerprint) AS collision_size
	FROM desired
)
SELECT transaction_id, canonical_id
FROM ranked
WHERE collision_size > 1 AND transaction_id <> canonical_id;--> statement-breakpoint

-- If a current Revolut row already coexists with its v1 predecessor, the
-- current row carries the missing fee and makes the relationship provable:
-- v1 amount = gross amount - fee. Rank both sides within the complete stored
-- source identity and join the same occurrence. Without that one-to-one rule,
-- two genuine identical legacy movements could both collapse onto one current
-- row. value_date is deliberately absent: v1 did not persist Revolut's started
-- date consistently, so it is not available identity on both sides.
INSERT INTO transaction_fingerprint_collision (redundant_id, canonical_id)
WITH legacy_ranked AS (
	SELECT
		legacy.*,
		row_number() OVER (
			PARTITION BY
				legacy.account_id,
				legacy.booked_at,
				legacy.amount,
				legacy.currency,
				legacy.bank_ref,
				legacy.counterparty_account,
				legacy.counterparty,
				legacy.description,
				legacy.balance_after_minor,
				legacy.variable_symbol,
				legacy.constant_symbol,
				legacy.specific_symbol,
				legacy.original_amount_minor,
				legacy.original_currency
			ORDER BY legacy.id
		) AS match_occurrence
	FROM "transaction" legacy
	LEFT JOIN import_file legacy_source ON legacy_source.id = legacy.import_file_id
	WHERE legacy.fingerprint_version = 1
		AND (
			legacy_source.bank = 'revolut'
			OR (
				legacy_source.id IS NULL
				AND EXISTS (
					SELECT 1 FROM account owner
					WHERE owner.id = legacy.account_id AND owner.bank = 'revolut'
				)
			)
		)
), current_ranked AS (
	SELECT
		candidate.*,
		candidate.amount - coalesce(candidate.fee_minor, 0) AS legacy_amount,
		row_number() OVER (
			PARTITION BY
				candidate.account_id,
				candidate.booked_at,
				candidate.amount - coalesce(candidate.fee_minor, 0),
				candidate.currency,
				candidate.bank_ref,
				candidate.counterparty_account,
				candidate.counterparty,
				candidate.description,
				candidate.balance_after_minor,
				candidate.variable_symbol,
				candidate.constant_symbol,
				candidate.specific_symbol,
				candidate.original_amount_minor,
				candidate.original_currency
			ORDER BY candidate.fingerprint_version DESC, candidate.id
		) AS match_occurrence
	FROM "transaction" candidate
	WHERE candidate.fingerprint_version >= 2
		AND NOT EXISTS (
			SELECT 1
			FROM transaction_fingerprint_collision already_redundant
			WHERE already_redundant.redundant_id = candidate.id
		)
)
SELECT
	legacy.id,
	current_row.id
FROM legacy_ranked legacy
JOIN current_ranked current_row
	ON current_row.account_id = legacy.account_id
	AND current_row.booked_at = legacy.booked_at
	AND current_row.legacy_amount = legacy.amount
	AND current_row.currency = legacy.currency
	AND current_row.bank_ref IS NOT DISTINCT FROM legacy.bank_ref
	AND current_row.counterparty_account IS NOT DISTINCT FROM legacy.counterparty_account
	AND current_row.counterparty IS NOT DISTINCT FROM legacy.counterparty
	AND current_row.description IS NOT DISTINCT FROM legacy.description
	AND current_row.balance_after_minor IS NOT DISTINCT FROM legacy.balance_after_minor
	AND current_row.variable_symbol IS NOT DISTINCT FROM legacy.variable_symbol
	AND current_row.constant_symbol IS NOT DISTINCT FROM legacy.constant_symbol
	AND current_row.specific_symbol IS NOT DISTINCT FROM legacy.specific_symbol
	AND current_row.original_amount_minor IS NOT DISTINCT FROM legacy.original_amount_minor
	AND current_row.original_currency IS NOT DISTINCT FROM legacy.original_currency
	AND current_row.match_occurrence = legacy.match_occurrence
ON CONFLICT (redundant_id) DO NOTHING;--> statement-breakpoint

-- Filing is a user decision, not import provenance. Preserve the most resolved
-- decision across duplicate rows (confirmed/filed, then automatic, then review)
-- and let the canonical row win equally resolved conflicts.
CREATE TEMP TABLE transaction_collision_filing (
	canonical_id text PRIMARY KEY,
	source_id text NOT NULL
);--> statement-breakpoint

INSERT INTO transaction_collision_filing (canonical_id, source_id)
WITH members AS (
	SELECT canonical_id, canonical_id AS source_id
	FROM transaction_fingerprint_collision
	UNION
	SELECT canonical_id, redundant_id AS source_id
	FROM transaction_fingerprint_collision
)
SELECT DISTINCT ON (members.canonical_id)
	members.canonical_id,
	members.source_id
FROM members
JOIN "transaction" source ON source.id = members.source_id
ORDER BY
	members.canonical_id,
	CASE source.review_state
		WHEN 'confirmed' THEN 0
		WHEN 'filed' THEN 0
		WHEN 'auto' THEN 1
		ELSE 2
	END,
	CASE WHEN members.source_id = members.canonical_id THEN 0 ELSE 1 END,
	members.source_id;--> statement-breakpoint

-- Splits are an alternative filing of one amount and must never be combined.
-- Keep the canonical row's complete split set when it has one; otherwise move
-- the most resolved legacy set wholesale, retaining split ids and split tags.
CREATE TEMP TABLE transaction_collision_split_choice (
	canonical_id text PRIMARY KEY,
	source_id text NOT NULL
);--> statement-breakpoint

INSERT INTO transaction_collision_split_choice (canonical_id, source_id)
WITH members AS (
	SELECT canonical_id, canonical_id AS source_id
	FROM transaction_fingerprint_collision
	UNION
	SELECT canonical_id, redundant_id AS source_id
	FROM transaction_fingerprint_collision
)
SELECT DISTINCT ON (members.canonical_id)
	members.canonical_id,
	members.source_id
FROM members
JOIN "transaction" source ON source.id = members.source_id
WHERE EXISTS (
	SELECT 1 FROM transaction_split split WHERE split.transaction_id = members.source_id
)
ORDER BY
	members.canonical_id,
	CASE WHEN members.source_id = members.canonical_id THEN 0 ELSE 1 END,
	CASE source.review_state
		WHEN 'confirmed' THEN 0
		WHEN 'filed' THEN 0
		WHEN 'auto' THEN 1
		ELSE 2
	END,
	members.source_id;--> statement-breakpoint

-- Move every affected row to an impossible temporary key first. A direct
-- swap can violate (account_id, dedup_fingerprint) halfway through the update.
UPDATE "transaction" t
SET dedup_fingerprint = 'repair-v3-' || t.id
FROM transaction_fingerprint_repair repair
WHERE repair.transaction_id = t.id;--> statement-breakpoint

UPDATE "transaction" canonical
SET
	category_id = source.category_id,
	suggested_category_id = source.suggested_category_id,
	review_state = source.review_state,
	review_reason = source.review_reason
FROM transaction_collision_filing filing
JOIN "transaction" source ON source.id = filing.source_id
WHERE canonical.id = filing.canonical_id;--> statement-breakpoint

INSERT INTO transaction_tag (transaction_id, tag_id)
SELECT collision.canonical_id, tagged.tag_id
FROM transaction_fingerprint_collision collision
JOIN transaction_tag tagged ON tagged.transaction_id = collision.redundant_id
ON CONFLICT DO NOTHING;--> statement-breakpoint

DELETE FROM transaction_split split
USING transaction_fingerprint_collision collision
WHERE split.transaction_id = collision.redundant_id
	AND NOT EXISTS (
		SELECT 1
		FROM transaction_collision_split_choice choice
		WHERE choice.canonical_id = collision.canonical_id
			AND choice.source_id = split.transaction_id
	);--> statement-breakpoint

UPDATE transaction_split split
SET transaction_id = choice.canonical_id
FROM transaction_collision_split_choice choice
WHERE split.transaction_id = choice.source_id
	AND choice.source_id <> choice.canonical_id;--> statement-breakpoint

-- A split owns the category allocation, so a transaction-level category must
-- not survive beside the selected split set.
UPDATE "transaction" canonical
SET category_id = NULL
FROM transaction_collision_split_choice choice
WHERE canonical.id = choice.canonical_id;--> statement-breakpoint

UPDATE loan_event event
SET transaction_id = collision.canonical_id
FROM transaction_fingerprint_collision collision
WHERE event.transaction_id = collision.redundant_id;--> statement-breakpoint

UPDATE transfer_pair pair
SET out_transaction_id = collision.canonical_id
FROM transaction_fingerprint_collision collision
WHERE pair.out_transaction_id = collision.redundant_id;--> statement-breakpoint

UPDATE transfer_pair pair
SET in_transaction_id = collision.canonical_id
FROM transaction_fingerprint_collision collision
WHERE pair.in_transaction_id = collision.redundant_id;--> statement-breakpoint

-- Keep historical import counters internally consistent: a repaired collision
-- is one added row discovered to have been a duplicate, not a second movement.
WITH removed AS (
	SELECT redundant.import_file_id, count(*)::int AS rows_removed
	FROM transaction_fingerprint_collision collision
	JOIN "transaction" redundant ON redundant.id = collision.redundant_id
	WHERE redundant.import_file_id IS NOT NULL
	GROUP BY redundant.import_file_id
)
UPDATE import_file source
SET
	rows_added = greatest(0, source.rows_added - removed.rows_removed),
	rows_duplicate = source.rows_duplicate + removed.rows_removed
FROM removed
WHERE source.id = removed.import_file_id;--> statement-breakpoint

DELETE FROM "transaction" redundant
USING transaction_fingerprint_collision collision
WHERE redundant.id = collision.redundant_id;--> statement-breakpoint

UPDATE "transaction" t
SET dedup_fingerprint = repair.fingerprint,
	fingerprint_version = 3
FROM transaction_fingerprint_repair repair
WHERE repair.transaction_id = t.id;--> statement-breakpoint

DROP TABLE transaction_collision_split_choice;--> statement-breakpoint
DROP TABLE transaction_collision_filing;--> statement-breakpoint
DROP TABLE transaction_fingerprint_collision;--> statement-breakpoint
DROP TABLE transaction_fingerprint_repair;--> statement-breakpoint

-- Some v1 fingerprints cannot be derived from their stored row. The first
-- replay of the original/overlapping statement binds its current fingerprint
-- to that row here; subsequent imports then take the ordinary deterministic
-- duplicate path without inventing a second movement.
CREATE TABLE transaction_fingerprint_alias (
	account_id text NOT NULL REFERENCES account(id) ON DELETE CASCADE,
	fingerprint text NOT NULL,
	transaction_id text NOT NULL REFERENCES "transaction"(id) ON DELETE CASCADE,
	CONSTRAINT transaction_fingerprint_alias_account_fingerprint_pk
		PRIMARY KEY(account_id, fingerprint)
);--> statement-breakpoint
CREATE INDEX transaction_fingerprint_alias_transaction_idx
	ON transaction_fingerprint_alias(transaction_id);--> statement-breakpoint

-- Older pairing ran its candidate scans before it had a cross-column claim
-- constraint, so two active pairs may share one leg. A user-confirmed pair is
-- authoritative over an automatic match, which is authoritative over a held
-- proposal. Within a state, the oldest pair then the smallest id wins. Walk
-- that order greedily: accept an available pair, skip a conflict, then allow
-- later disjoint pairs to claim legs the skipped row never won. This produces
-- a deterministic maximal priority matching. Invalid self-pairs are rejected.
CREATE TEMP TABLE canonical_active_transfer_pair (
	pair_id text PRIMARY KEY
);--> statement-breakpoint

INSERT INTO canonical_active_transfer_pair (pair_id)
WITH RECURSIVE ordered AS (
	SELECT
		id AS pair_id,
		out_transaction_id,
		in_transaction_id,
		row_number() OVER (
			ORDER BY
				CASE state WHEN 'confirmed' THEN 0 WHEN 'auto' THEN 1 ELSE 2 END,
				created_at,
				id
		) AS position
	FROM transfer_pair
	WHERE state IN ('auto', 'proposed', 'confirmed')
), matching AS (
	SELECT
		0::bigint AS position,
		ARRAY[]::text[] AS claimed_legs,
		ARRAY[]::text[] AS kept_pairs
	UNION ALL
	SELECT
		candidate.position,
		CASE WHEN candidate.out_transaction_id <> candidate.in_transaction_id
				AND NOT candidate.out_transaction_id = ANY (matching.claimed_legs)
				AND NOT candidate.in_transaction_id = ANY (matching.claimed_legs)
			THEN matching.claimed_legs || ARRAY[candidate.out_transaction_id, candidate.in_transaction_id]
			ELSE matching.claimed_legs
		END,
		CASE WHEN candidate.out_transaction_id <> candidate.in_transaction_id
				AND NOT candidate.out_transaction_id = ANY (matching.claimed_legs)
				AND NOT candidate.in_transaction_id = ANY (matching.claimed_legs)
			THEN matching.kept_pairs || candidate.pair_id
			ELSE matching.kept_pairs
		END
	FROM matching
	JOIN ordered candidate ON candidate.position = matching.position + 1
), final_matching AS (
	SELECT kept_pairs
	FROM matching
	ORDER BY position DESC
	LIMIT 1
)
SELECT unnest(kept_pairs)
FROM final_matching;--> statement-breakpoint

UPDATE transfer_pair pair
SET state = 'rejected'
WHERE pair.state IN ('auto', 'proposed', 'confirmed')
	AND NOT EXISTS (
		SELECT 1 FROM canonical_active_transfer_pair canonical WHERE canonical.pair_id = pair.id
	);--> statement-breakpoint

-- transaction.transfer_pair_id is intentionally a soft pointer. Rebuild it
-- from the reconciled source of truth: only auto/confirmed pairs exclude cash
-- flow; proposals continue to leave their transactions in the figures.
UPDATE "transaction" t
SET transfer_pair_id = NULL
WHERE t.transfer_pair_id IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM transfer_pair pair
		JOIN canonical_active_transfer_pair canonical ON canonical.pair_id = pair.id
		WHERE pair.state IN ('auto', 'confirmed')
			AND pair.id = t.transfer_pair_id
			AND (pair.out_transaction_id = t.id OR pair.in_transaction_id = t.id)
	);--> statement-breakpoint

-- A unique leg from a losing auto/confirmed pair is no longer a transfer. If
-- it has no deliberate category or split filing, return it to visible review
-- instead of leaving review_state='confirmed' with a null pair forever.
UPDATE "transaction" t
SET
	review_state = 'needs_review',
	review_reason = 'legacy transfer conflict — choose a category or pair again'
WHERE t.category_id IS NULL
	AND t.review_state IN ('auto', 'confirmed', 'filed')
	AND NOT EXISTS (
		SELECT 1 FROM transaction_split split WHERE split.transaction_id = t.id
	)
	AND EXISTS (
		SELECT 1
		FROM transfer_pair losing
		WHERE losing.state = 'rejected'
			AND (losing.out_transaction_id = t.id OR losing.in_transaction_id = t.id)
	)
	AND NOT EXISTS (
		SELECT 1
		FROM transfer_pair kept
		JOIN canonical_active_transfer_pair canonical ON canonical.pair_id = kept.id
		WHERE kept.out_transaction_id = t.id OR kept.in_transaction_id = t.id
	);--> statement-breakpoint

UPDATE "transaction" t
SET transfer_pair_id = pair.id
FROM transfer_pair pair
JOIN canonical_active_transfer_pair canonical ON canonical.pair_id = pair.id
WHERE pair.state IN ('auto', 'confirmed')
	AND (pair.out_transaction_id = t.id OR pair.in_transaction_id = t.id)
	AND t.transfer_pair_id IS DISTINCT FROM pair.id;--> statement-breakpoint

DROP TABLE canonical_active_transfer_pair;--> statement-breakpoint

-- Active pair legs are claims. Keeping them in a separate relation lets one
-- unique constraint cover both the outgoing and incoming columns, including
-- the cross-column collision ordinary indexes cannot prevent.
CREATE TABLE transfer_pair_leg (
	transaction_id text PRIMARY KEY REFERENCES "transaction"(id) ON DELETE CASCADE,
	pair_id text NOT NULL REFERENCES transfer_pair(id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX transfer_pair_leg_pair_idx ON transfer_pair_leg(pair_id);--> statement-breakpoint

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

INSERT INTO transfer_pair_leg (transaction_id, pair_id)
SELECT leg.transaction_id, leg.pair_id
FROM (
	SELECT out_transaction_id AS transaction_id, id AS pair_id
	FROM transfer_pair WHERE state IN ('auto', 'proposed', 'confirmed')
	UNION ALL
	SELECT in_transaction_id AS transaction_id, id AS pair_id
	FROM transfer_pair WHERE state IN ('auto', 'proposed', 'confirmed')
) leg;
