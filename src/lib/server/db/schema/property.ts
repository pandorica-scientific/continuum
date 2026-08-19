/**
 * Flats: what they are worth, who rents them, what they cost to run.
 */

import { sql } from 'drizzle-orm';
import {
	bigint,
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
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';
import { person } from './auth';
import { document } from './documents';
import { currency } from './money';

export const property = pgTable(
	'property',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		// e.g. "3+kk · 78 m² · bought 2019"
		sizeLabel: text('size_label').notNull().default(''),
		kind: text('kind').$type<EnumValue<'property.kind'>>().notNull(),
		currency: text('currency')
			.notNull()
			.default('CZK')
			.references(() => currency.code),
		valueMinor: bigint('value_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		valuedOn: date('valued_on'),
		// what went in: deposit, fees, principal repaid — for the appreciation tile
		moneyInMinor: bigint('money_in_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		boughtYear: integer('bought_year'),
		ownerPersonId: uuid('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
		// uploaded images on the data volume, plus the drawn floor plan:
		// {plan?, photos, drawing?: {cellCm, rooms: [{name, cells: [[x,y],…]}]}}
		images: jsonb('images')
			.$type<{
				plan?: string;
				photos: string[];
				drawing?: { cellCm: number; rooms: { name: string; cells: [number, number][] }[] };
			}>()
			.notNull()
			.default({ photos: [] }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('property_currency_idx').on(table.currency),
		index('property_owner_person_idx').on(table.ownerPersonId)
	]
);

export const tenancy = pgTable(
	'tenancy',
	{
		id: uuid('id').primaryKey(),
		propertyId: uuid('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		tenantName: text('tenant_name').notNull(),
		rentMinor: bigint('rent_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		depositMinor: bigint('deposit_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		// the date by which a renewal notice must be given
		renewalNoticeOn: date('renewal_notice_on')
	},
	(table) => [index('tenancy_property_idx').on(table.propertyId)]
);

export const propertyBill = pgTable(
	'property_bill',
	{
		id: uuid('id').primaryKey(),
		propertyId: uuid('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		sort: integer('sort').notNull().default(0),
		/**
		 * Where the amount comes from: 'meter' rows are rewritten from the smart
		 * meter reading, everything else is the household's own figure and is never
		 * touched. A typed column rather than a label match — looking for a label
		 * containing "energy" missed the app's own seeded "Electricity advance", so
		 * a second energy line appeared beside it and the property's bill total
		 * counted electricity twice, and renaming a bill to Czech did the same.
		 */
		source: text('source').$type<EnumValue<'property_bill.source'>>().notNull().default('manual'),
		// the uploaded bill itself, filed in Documents about this property
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' })
	},
	(table) => [
		uniqueIndex('property_bill_meter_property_idx')
			.on(table.propertyId)
			.where(sql`${table.source} = 'meter'`),
		index('property_bill_property_idx').on(table.propertyId),
		index('property_bill_document_idx').on(table.documentId)
	]
);
