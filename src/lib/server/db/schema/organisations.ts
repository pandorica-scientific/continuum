// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The organisations a household deals with: an employer, the tax office, an
 * insurer.
 *
 * A record rather than a name printed on a payslip, for the same reason
 * `subject` is a record rather than a name typed on a receipt: a string retyped
 * is a string that will one day be typed differently, and then one employer is
 * two employers and nothing in the archive can say so.
 *
 * NOT `contact`. A contact is a person who has an `organisation` field — a
 * person AT a company. Two colleagues at one employer would be two records
 * here, and an employer nobody happens to know anyone at could not exist at all.
 */
import { sql } from 'drizzle-orm';
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { EnumValue } from '../../../enums';
import { document } from './documents';
import { person } from './auth';

export const organisation = pgTable(
	'organisation',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		kind: text('kind').$type<EnumValue<'organisation.kind'>>().notNull().default('other'),
		emoji: text('emoji').notNull().default('🏛️'),
		notes: text('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// Case-insensitive, exactly as `subject` is: "AV ČR" and "av čr" are one
	// institute, and the household must not be able to create the second.
	(table) => [uniqueIndex('organisation_name_ci_idx').on(sql`lower(${table.name})`)]
);

/**
 * A person's relationship with an organisation, over ONE ROLE PERIOD.
 *
 * One row per period, never per job. A promotion is a second row against the
 * same person and organisation:
 *
 *     PhD student         2018-09-01 → 2021-08-31
 *     Research scientist  2021-09-01 → (open)
 *
 * That is not tidiness. A lane on the Income & Tax shelf counts the filings it
 * expected from the EARLIEST start across every period, so overwriting the role
 * on promotion would move the beginning to 2021 and silently erase three years
 * of missing paperwork from the count. See `engagementSpan`.
 *
 * Both dates are nullable. An authority a household has simply always dealt
 * with has no start anybody remembers, and a lane then falls back to the
 * earliest filed document — the same fallback the coverage ribbon makes to an
 * account's first movement.
 *
 * The shape follows `tenancy` (`starts_on` / `ends_on`) and `subject`
 * (`active_from` / `active_to`): a third instance of a pattern already twice
 * established here, not a new idea.
 */
export const engagement = pgTable(
	'engagement',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		organisationId: uuid('organisation_id')
			.notNull()
			.references(() => organisation.id, { onDelete: 'cascade' }),
		/** "Research scientist". Free text: a job title is not an enum anywhere. */
		role: text('role'),
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		/**
		 * The contract or amendment that created this period, where there is one.
		 *
		 * SET NULL rather than CASCADE: deleting the paperwork does not mean the
		 * job never happened.
		 */
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' })
	},
	(table) => [
		index('engagement_organisation_idx').on(table.organisationId),
		index('engagement_person_idx').on(table.personId),
		// Every foreign key carries its own covering index — `schema-invariants`
		// holds that. Without this one, deleting a document scans every role
		// period ever recorded to find the ones pointing at it.
		index('engagement_document_idx').on(table.documentId)
	]
);

/** Shapes a CHECK can state and a column type cannot. */
export const organisationsCheckSql = `
-- A period that ends before it starts is not a period, and would make a lane
-- expect a negative number of filings.
ALTER TABLE engagement ADD CONSTRAINT engagement_period_order_check
	CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);
`;
