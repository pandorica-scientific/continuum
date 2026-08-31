// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One queue for every kind of background work, leased rather than locked.
 */

import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';

/**
 * Work that is claimed under a lease.
 *
 * `import_job` and `calendar_account.syncing_since` were the same mechanism
 * written twice: take the work, stamp when you took it, and let a stale stamp be
 * taken over so a worker that died strands nothing. This is that mechanism once,
 * and the next integration inherits it rather than writing a third copy.
 *
 * Reading a statement is not always fast. A 140-movement statement spread over
 * eight pages is recovered from glyph coordinates by two assemblers, and every
 * candidate reading is proved before one is chosen; a photograph has to be
 * rasterised and recognised first. None of that belongs on a request the person
 * who uploaded the file is waiting behind.
 *
 * The bytes live in `blob` rather than on disk so a queued file is transactional
 * with its job: a crash between writing the file and recording the job cannot
 * leave one without the other, and nothing has to be swept up afterwards. They
 * are cleared the moment the job finishes, so this table holds only work in
 * flight — `byteSize` outlives them, so a finished upload can still say what it
 * read.
 *
 * `claimedAt` is a LEASE, not a lock. The work in the middle is CPU-bound or
 * network-bound and can run for many seconds; no database lock belongs open
 * across that. The claim itself is made atomic by an advisory lock, which is
 * what lets a crashed worker's job be picked up again rather than stranded.
 *
 * `subjectId` is what lets one table serve two trigger models. An import is
 * QUEUED and has no subject; a calendar pass is about one account, and its job
 * row exists so a second pass can tell that the first one holds it.
 */
export const job = pgTable(
	'job',
	{
		id: text('id').primaryKey(),
		kind: text('kind').$type<EnumValue<'job.kind'>>().notNull(),
		/** What the work is about, for kinds where that is the work. */
		subjectId: uuid('subject_id'),
		state: text('state').$type<EnumValue<'job_state'>>().notNull().default('queued'),
		filename: text('filename'),
		/** Base64 of the uploaded bytes; cleared once the job leaves the queue. */
		blob: text('blob'),
		byteSize: integer('byte_size').notNull().default(0),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
		/** So a job that dies every time can be given up on rather than retried for ever. */
		attempts: integer('attempts').notNull().default(0),
		/** The IngestResult, so the page can show what happened without re-reading. */
		result: jsonb('result'),
		error: text('error'),
		queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true })
	},
	(table) => [
		index('job_claimable_idx').on(table.kind, table.state, table.queuedAt),
		index('job_subject_idx').on(table.subjectId)
	]
);
