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
import {
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import type { EnumValue } from '../../../enums';
import { document, shelf } from './documents';
import { entity } from './entity';
import { person } from './auth';

export const organisation = pgTable(
	'organisation',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		kind: text('kind').$type<EnumValue<'organisation.kind'>>().notNull().default('other'),
		emoji: text('emoji').notNull().default('🏛️'),
		notes: text('notes'),
		// The shelf whose cards this organisation is one of. An employer and the
		// tax office are cards on Income & Tax; a household that files its car
		// insurer's letters under Vehicles puts that insurer there instead, and
		// the two never appear in each other's About list.
		shelfId: uuid('shelf_id')
			.notNull()
			.references(() => shelf.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// Case-insensitive, exactly as `subject` is: "AV ČR" and "av čr" are one
	// institute, and the household must not be able to create the second.
	(table) => [
		uniqueIndex('organisation_name_ci_idx').on(sql`lower(${table.name})`),
		index('organisation_shelf_id_idx').on(table.shelfId)
	]
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

/**
 * One rhythm of paper expected from an organisation.
 *
 * A lane is the same coverage question the Statements ribbon asks, pointed at a
 * different set of documents: how often should this arrive, and which months or
 * years have nothing in them. An employer has three — payslips monthly, the
 * declaration yearly, and everything else with no rhythm at all.
 *
 * `conditions` is `[{ field, op, value }]` ANDed, deliberately the shape
 * `rule.conditions` already holds for transactions: a household that has learnt
 * what a rule is should not have to learn a second thing. In this release they
 * decide which lane an already-linked document falls into; in the next they
 * propose the organisation link itself.
 *
 * A lane belongs to the household the moment it exists. What ships is a seed —
 * the same relationship `shelf_type` has with `SHELF_PROFILES`.
 */
export const lane = pgTable(
	'lane',
	{
		id: uuid('id').primaryKey(),
		/**
		 * The card this lane sits on — a person, an organisation, a property or a
		 * subject — through the entity supertype, exactly as `document_link` points
		 * at its target.
		 *
		 * It was `organisation_id` in v0.7.7, because Income & Tax was the only
		 * shelf drawing lanes. Property's inspections and a car's road tax are the
		 * same shape, so the column names the supertype instead and the kind is
		 * read from `entity` where anything needs it. Nothing else about a lane
		 * changed.
		 */
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		/** Null for a lane about the card rather than about one person. */
		personId: uuid('person_id').references(() => person.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		cadence: text('cadence').$type<EnumValue<'lane.cadence'>>().notNull(),
		/**
		 * For `yearly`: a cell every N years. 1 for every other cadence.
		 *
		 * A technical inspection every two years is one cell spanning two columns,
		 * not two cells one of which is always empty. Declared like the cadence
		 * itself and never inferred from what happens to be filed.
		 */
		every: integer('every').notNull().default(1),
		conditions: jsonb('conditions').notNull().default([]),
		/**
		 * How often this lane's proposals were taken, and how often corrected.
		 *
		 * EVIDENCE, not a tuned weight — the distinction `rule` already draws for
		 * transactions. A lane that keeps being wrong falls silent on its own
		 * (see `laneTrusted`), so nobody has to find and disable it, and a lane
		 * that is usually right keeps proposing without being told it may.
		 */
		acceptedCount: integer('accepted_count').notNull().default(0),
		correctedCount: integer('corrected_count').notNull().default(0),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(table) => [
		index('lane_entity_idx').on(table.entityId),
		index('lane_person_idx').on(table.personId)
	]
);

/** Shapes a CHECK can state and a column type cannot. */
export const organisationsCheckSql = `
-- A period that ends before it starts is not a period, and would make a lane
-- expect a negative number of filings.
ALTER TABLE engagement ADD CONSTRAINT engagement_period_order_check
	CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);
--> statement-breakpoint
-- Every N years, where N is a whole number of years. Zero would divide the
-- ribbon by nothing and a negative would run it backwards.
ALTER TABLE lane ADD CONSTRAINT lane_every_check CHECK (every >= 1);
--> statement-breakpoint
-- \`document.lane_id\` lives here rather than on the column, because \`lane\` is
-- declared in this file and \`document\` in the one that imports it: a Drizzle
-- reference would make the two modules import each other. SET NULL, so deleting
-- a lane sends its paper back to the card's history and never deletes it.
ALTER TABLE document ADD CONSTRAINT document_lane_id_fk
	FOREIGN KEY (lane_id) REFERENCES lane(id) ON DELETE SET NULL;
--> statement-breakpoint
-- The covering index every foreign key gets; \`schema-invariants\` holds us to it.
CREATE INDEX document_lane_idx ON document (lane_id);
`;
