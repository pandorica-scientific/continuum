-- One table for work that is claimed under a lease.
--
-- `import_job` and `calendar_account.syncing_since` were the same mechanism
-- written twice over: take the work, stamp the time you took it, and let a stale
-- stamp be taken over so a worker that died strands nothing. Each carried its own
-- copy of the reasoning about why a lease and not a lock, and a third integration
-- would have written it a third time.
--
-- WHAT IS SHARED, and what deliberately is not.
--
-- Shared: the row, the states, the lease column, and the attempt count. Two of
-- those are new to the calendar side — it had no attempt count at all, so a pass
-- that failed on every try was retried for ever with nothing recording it, and
-- its errors lived in a column on the account rather than on the work.
--
-- Not shared: how work is TRIGGERED. An import is queued and drained by a worker
-- that takes the oldest thing nobody holds; a calendar pass runs when something
-- asks for it, and only needs to know whether another pass already holds that
-- account. Those are different models and forcing them together would have made
-- both worse — a queue row per sync pass to clean up, or a drain loop the
-- calendar does not want. `subject_id` is what lets one table serve both: null
-- for queued work that is about nothing in particular, and the account id for
-- work that IS about one record.
--
-- The advisory locks stay where they are. They are what makes read-then-claim
-- atomic across processes, they are covered by their own tests, and nothing about
-- moving the row changes what they are for.

CREATE TABLE job (
	id text PRIMARY KEY,
	kind text NOT NULL,
	/** What the work is about, for kinds where that is the work. Null when queued. */
	subject_id text,
	state text NOT NULL DEFAULT 'queued',
	filename text,
	/** Base64 of an upload, cleared the moment the job leaves the queue. */
	blob text,
	/** Survives the blob, so a finished upload can still report what it read. */
	byte_size integer NOT NULL DEFAULT 0,
	/** A LEASE, not a lock: the work in the middle runs for minutes. */
	claimed_at timestamptz,
	attempts integer NOT NULL DEFAULT 0,
	result jsonb,
	error text,
	queued_at timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz,
	CONSTRAINT job_kind_check CHECK (kind in ('import', 'calendar_sync')),
	CONSTRAINT job_state_check CHECK (state in ('queued', 'running', 'done', 'failed'))
);--> statement-breakpoint

-- The claim query: oldest first, within one kind, filtered by state.
CREATE INDEX job_claimable_idx ON job(kind, state, queued_at);--> statement-breakpoint
-- "is a pass running for this account", which is the calendar side's whole
-- question.
CREATE INDEX job_subject_idx ON job(subject_id);--> statement-breakpoint

INSERT INTO job (id, kind, subject_id, state, filename, blob, byte_size,
                 claimed_at, result, error, queued_at, finished_at)
SELECT id, 'import', applies_to_account_id, state, filename, payload, byte_size,
       claimed_at, result, error, queued_at, finished_at
FROM import_job;--> statement-breakpoint

DROP TABLE import_job;--> statement-breakpoint

-- Any pass that was running when this migration was applied is recorded as one,
-- so the lease is not silently released mid-flight. A stale one is taken over
-- after LEASE_MINUTES exactly as before.
INSERT INTO job (id, kind, subject_id, state, claimed_at)
SELECT 'calendar-sync:' || id, 'calendar_sync', id, 'running', syncing_since
FROM calendar_account WHERE syncing_since IS NOT NULL;--> statement-breakpoint

ALTER TABLE calendar_account DROP COLUMN syncing_since;
