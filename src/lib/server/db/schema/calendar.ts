// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Events, the providers they sync with, and what to do when both sides changed.
 */

import {
	boolean,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { person } from './auth';

// ---- Calendar ----

// Events someone wrote by hand. The ledger's own events stay derived — they are
// recomputed from loans, tenancies and documents and never land in a table — so
// this holds only what a person authored.
export const calendarEvent = pgTable(
	'calendar_event',
	{
		id: uuid('id').primaryKey(),
		title: text('title').notNull(),
		notes: text('notes'),
		// A key from EVENT_CATEGORIES; supplies the marker emoji. Null is untagged.
		category: text('category'),
		allDay: boolean('all_day').notNull().default(false),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		// The IANA zone the event was authored in, and NOT redundant beside the two
		// timestamptz columns above. Recurrence expands against wall-clock time:
		// "every Tuesday at 09:00" has to stay 09:00 local across the March and
		// October transitions, and a series expanded purely in UTC silently drifts by
		// an hour for half the year. The instant alone cannot say which 09:00 was
		// meant, so the zone travels with the event.
		tz: text('tz').notNull(),
		// RFC 5545 rule, without the RRULE: prefix. Null means a single event.
		rrule: text('rrule'),
		createdBy: uuid('created_by').references(() => person.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		// The merge clock: sync compares this against the remote's modification time.
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		// A tombstone rather than a hard delete. Sync has to be able to tell "deleted
		// here, push the deletion" from "never existed", and a removed row says
		// nothing at all.
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [index('calendar_event_created_by_idx').on(table.createdBy)]
);

// One occurrence of a recurring event that was moved or cancelled.
export const calendarEventException = pgTable(
	'calendar_event_exception',
	{
		id: uuid('id').primaryKey(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => calendarEvent.id, { onDelete: 'cascade' }),
		// The occurrence's ORIGINAL start, never where it was moved to. That is
		// what RFC 5545 keys on and what Google and CalDAV both expect back.
		// Storing the moved-to time instead is the bug that makes a rescheduled
		// occurrence reappear at its old slot on the next sync.
		recurrenceId: text('recurrence_id').notNull(),
		cancelled: boolean('cancelled').notNull().default(false),
		// Null means "inherit from the series" — distinct from an empty string,
		// which is an override to nothing.
		title: text('title'),
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		notes: text('notes'),
		// The rest of what an edit can change. Without these three, a "this event
		// only" edit that retagged, un-all-dayed or re-zoned one occurrence was
		// accepted by the form, silently dropped on the way to the table, and the
		// occurrence came back rendered from the series values — so the screen
		// disagreed with what had just been saved and nothing was pushed.
		//
		// Nullable, and null means inherit, exactly as title and notes do. That is
		// what lets a later series-level change still reach an overridden
		// occurrence: only the fields the edit actually differed on are stored.
		category: text('category'),
		allDay: boolean('all_day'),
		tz: text('tz')
	},
	(t) => [uniqueIndex('calendar_event_exception_occurrence_idx').on(t.eventId, t.recurrenceId)]
);

// ---- Calendar sync ----

// A connected remote calendar.
//
// Its own table rather than a `settings` key on purpose. Home Assistant's config
// lives in settings, and config-file.ts keeps secrets out of the export with a
// whitelist — but a credential that leaks because someone forgot to maintain a
// list is a bad failure. Here it is excluded by construction.
export const calendarAccount = pgTable('calendar_account', {
	id: uuid('id').primaryKey(),
	provider: text('provider').$type<'icloud' | 'google'>().notNull(),
	label: text('label').notNull(),
	remoteCalId: text('remote_cal_id'),
	/** The chosen calendar's display name. Stored because the id is a CalDAV
	 *  collection URL or a Google calendar id — neither of which tells a person
	 *  which of their calendars this is. */
	remoteCalName: text('remote_cal_name'),
	/** App-specific password, or an OAuth refresh token. Never leaves this table. */
	credential: text('credential').notNull(),
	/** Opaque: a Google syncToken, a CalDAV sync-token, or a ctag. */
	cursor: text('cursor'),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
	lastError: text('last_error'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// What a local event is called on one remote, and what we last agreed on.
//
// A CACHE, not the source of truth: remote ids are derived from local keys, so
// losing this table triggers a reconcile that recomputes the same ids and
// re-attaches, rather than duplicating every event on someone's phone.
export const calendarSyncLink = pgTable(
	'calendar_sync_link',
	{
		/** An authored event's uuid, or a generated event's `gen:` key. */
		localKey: text('local_key').notNull(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => calendarAccount.id, { onDelete: 'cascade' }),
		remoteId: text('remote_id').notNull(),
		remoteEtag: text('remote_etag'),
		/** What we last sent — the merge base. Without it there is no way to tell
		 *  which side changed, only that the two differ. */
		pushedHash: text('pushed_hash'),
		/** Remote content we last accepted. */
		seenHash: text('seen_hash'),
		/** Set when a generated event was deleted on the remote: stop pushing it
		 *  rather than re-creating it and overruling the person who deleted it. */
		suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		primaryKey({ columns: [t.localKey, t.accountId] }),
		// The primary key leads with local_key, so it cannot serve a lookup that
		// only knows the account — and every one of them does. A sync pass reads
		// this table by account, disconnecting an account cascades by account, and
		// both were sequential scans that grow with the whole household's history
		// rather than with one account's share of it.
		index('calendar_sync_link_account_idx').on(t.accountId)
	]
);

// A discarded version, kept so last-writer-wins is not silent.
//
// This is what makes the conflict rule acceptable rather than reckless: the
// losing edit is recorded and surfaced through the briefing, so an overwritten
// change is visible instead of simply gone.
export const calendarConflict = pgTable(
	'calendar_conflict',
	{
		id: uuid('id').primaryKey(),
		localKey: text('local_key').notNull(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => calendarAccount.id, { onDelete: 'cascade' }),
		detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
		ours: jsonb('ours').notNull(),
		theirs: jsonb('theirs').notNull(),
		resolution: text('resolution').$type<'local-won' | 'remote-won' | 'wrote-back'>().notNull(),
		/** Cleared once someone has seen it, so the briefing stops raising it. */
		acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
	},
	(table) => [index('calendar_conflict_account_idx').on(table.accountId)]
);
