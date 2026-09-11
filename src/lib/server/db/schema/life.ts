// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The half of a household's record that is not the ledger.
 *
 * Four subjects in one module because they are one area and they feed each
 * other: a trip ends and writes visits, the visits scratch the map, a recipe
 * and a bottle are the other two things this household keeps a record of. They
 * share no table, so the grouping is editorial rather than structural — but a
 * reader looking for "where does Life live" should find one file.
 *
 * Three rules hold across all of it:
 *
 * 1. **Artwork is stored as a definition, never as a file.** `art` holds what
 *    the generator resolved, so renaming a recipe does not silently repaint it
 *    and upgrading the library does not repaint the household's history.
 * 2. **Derived state is not stored.** A bottle is sealed, open or finished
 *    because of `owned` and `opened`; a country is visited because a `visit`
 *    row says so. Storing the conclusion as well as its inputs is two facts
 *    that can disagree.
 * 3. **Money is minor units plus a currency**, as everywhere else.
 */

import {
	bigint,
	boolean,
	char,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';
import { currency } from './money';
import { person } from './auth';
import { document } from './documents';
import { transaction } from './accounts';

/**
 * What a generator resolved for one row, kept so it can be drawn again.
 *
 * Deliberately loose: three different libraries write into this column, each
 * with its own shape, and the module that renders it is the one that knows
 * which. Typing it as a union here would put the artwork libraries' internals
 * into the schema.
 */
type ArtDefinition = Record<string, unknown>;

// ---- Trips ----

/**
 * Somewhere the household would like to go, with no dates and no bookings.
 *
 * Separate from `trip` rather than a nullable-dates trip, because the two are
 * read completely differently — an idea is browsed, a trip is prepared for —
 * and a table of trips where most rows have no dates makes every query about
 * real trips say "and starts is not null". `trip.fromIdeaId` records where a
 * trip came from when one was promoted.
 */
export const tripIdea = pgTable('trip_idea', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	emoji: text('emoji').notNull().default(''),
	/** One line on why this one keeps coming back. Not a description. */
	note: text('note').notNull().default(''),
	/** ISO 3166-1 alpha-2, for the stamp's ink and the flag. */
	country: char('country', { length: 2 }),
	art: jsonb('art').$type<ArtDefinition>(),
	/** An uploaded photograph on the data volume, as `/files/[name]`. */
	photo: text('photo'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Who wants to go.
 *
 * A row per person, and nothing else on it: no weight, no rank, no timestamp
 * anybody would be tempted to sort by. The hearts are a feeling, not a vote,
 * and the moment this table carries a count it has become a poll.
 */
export const tripIdeaHeart = pgTable(
	'trip_idea_heart',
	{
		ideaId: uuid('idea_id')
			.notNull()
			.references(() => tripIdea.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.ideaId, table.personId] }),
		// The primary key covers the idea side; this covers the person side, which
		// is what deleting a person has to scan.
		index('trip_idea_heart_person_idx').on(table.personId)
	]
);

export const trip = pgTable(
	'trip',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		emoji: text('emoji').notNull().default(''),
		startsOn: date('starts_on').notNull(),
		endsOn: date('ends_on').notNull(),
		notes: text('notes').notNull().default(''),
		art: jsonb('art').$type<ArtDefinition>(),
		/**
		 * The idea this trip was promoted from, kept as provenance.
		 *
		 * SET NULL: removing an idea from the board must not delete the holiday
		 * it turned into.
		 */
		fromIdeaId: uuid('from_idea_id').references(() => tripIdea.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('trip_starts_on_idx').on(table.startsOn),
		index('trip_from_idea_idx').on(table.fromIdeaId)
	]
);

/**
 * Where a trip goes, in travel order.
 *
 * Three levels, all optional below the country, because that is how precisely
 * a household actually remembers: "Portugal" for one trip, "Porto, Norte" for
 * another. The map lights whatever it is given — a region if there is one, the
 * country alone otherwise.
 */
export const tripDestination = pgTable(
	'trip_destination',
	{
		id: uuid('id').primaryKey(),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trip.id, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull().default(0),
		country: char('country', { length: 2 }).notNull(),
		/** An administrative unit as Natural Earth names it, or null for the whole country. */
		region: text('region'),
		city: text('city')
	},
	(table) => [index('trip_destination_trip_idx').on(table.tripId, table.ordinal)]
);

export const tripMember = pgTable(
	'trip_member',
	{
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trip.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.tripId, table.personId] }),
		index('trip_member_person_idx').on(table.personId)
	]
);

/**
 * A flight, a hotel, a car — the things a trip is made of.
 *
 * `documentId` is SET NULL and never CASCADE: filing the confirmation and then
 * deleting the document must leave the flight standing. The booking is the
 * fact; the PDF is evidence of it.
 */
export const tripBooking = pgTable(
	'trip_booking',
	{
		id: uuid('id').primaryKey(),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trip.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<EnumValue<'booking.kind'>>().notNull(),
		title: text('title').notNull(),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		reference: text('reference').notNull().default(''),
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' })
	},
	(table) => [
		index('trip_booking_trip_idx').on(table.tripId, table.startsAt),
		index('trip_booking_document_idx').on(table.documentId)
	]
);

/** Something to see, with a tick the household is free to ignore. */
export const tripPlace = pgTable(
	'trip_place',
	{
		id: uuid('id').primaryKey(),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trip.id, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull().default(0),
		label: text('label').notNull(),
		done: boolean('done').notNull().default(false)
	},
	(table) => [index('trip_place_trip_idx').on(table.tripId, table.ordinal)]
);

// ---- Visits: what the map reads ----

/**
 * Somewhere the household has actually been.
 *
 * The map derives everything from this table — countries, regions, the tiles,
 * the continent coins — and there is deliberately no second table of visited
 * countries. Two records of the same fact is one record that goes wrong.
 *
 * `source` decides who may edit the row: a `trip` visit is rewritten whenever
 * its trip's destinations change, a `manual` one is left alone forever. The
 * unique index is what makes writing trip visits idempotent, so opening the
 * map twice does not visit Portugal twice.
 *
 * `revealedAt` is what makes the scratch play once. Null means the map has not
 * shown this one yet.
 */
export const visit = pgTable(
	'visit',
	{
		id: uuid('id').primaryKey(),
		country: char('country', { length: 2 }).notNull(),
		region: text('region'),
		city: text('city'),
		year: integer('year').notNull(),
		/** SET NULL: deleting a trip must not un-visit a place somebody went. */
		tripId: uuid('trip_id').references(() => trip.id, { onDelete: 'set null' }),
		source: text('source').$type<EnumValue<'visit.source'>>().notNull(),
		revealedAt: timestamp('revealed_at', { withTimezone: true })
	},
	(table) => [
		index('visit_country_idx').on(table.country),
		index('visit_country_region_idx').on(table.country, table.region),
		// "Which visits did this trip write" — and the partial unique index below
		// does not answer it, because a partial index covers only its own WHERE.
		index('visit_trip_idx').on(table.tripId)
	]
);

export const visitMember = pgTable(
	'visit_member',
	{
		visitId: uuid('visit_id')
			.notNull()
			.references(() => visit.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.visitId, table.personId] }),
		index('visit_member_person_idx').on(table.personId)
	]
);

// ---- Cookbook ----

/** The rail down the left of the Cookbook. */
export const recipeCategory = pgTable('recipe_category', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	emoji: text('emoji').notNull().default(''),
	sortOrder: integer('sort_order').notNull().default(0)
});

export const recipe = pgTable(
	'recipe',
	{
		id: uuid('id').primaryKey(),
		/** RESTRICT: emptying a category must be a decision, not a side effect. */
		categoryId: uuid('category_id')
			.notNull()
			.references(() => recipeCategory.id, { onDelete: 'restrict' }),
		name: text('name').notNull(),
		emoji: text('emoji').notNull().default(''),
		description: text('description').notNull().default(''),
		/** What the stored quantities are FOR. The scaler reads from this. */
		servings: integer('servings').notNull().default(2),
		minutes: integer('minutes'),
		photo: text('photo'),
		art: jsonb('art').$type<ArtDefinition>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('recipe_category_idx').on(table.categoryId)]
);

/**
 * A tag, with the series slot it is inked in.
 *
 * Its own table rather than the ledger's `tag`: a transaction tag and a recipe
 * tag share a word and nothing else, and one list holding both would offer
 * "weeknight" when categorising a bank transfer.
 */
export const recipeTag = pgTable('recipe_tag', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull().unique(),
	/** A `--series-*` token name, so the chip's colour survives a theme switch. */
	series: text('series').notNull()
});

export const recipeTagLink = pgTable(
	'recipe_tag_link',
	{
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		tagId: uuid('tag_id')
			.notNull()
			.references(() => recipeTag.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.recipeId, table.tagId] }),
		// "Every recipe carrying this tag", which is what the tag filter asks.
		index('recipe_tag_link_tag_idx').on(table.tagId)
	]
);

/**
 * One line of the ingredients list.
 *
 * `quantity` is nullable because "a handful" is a quantity a recipe is allowed
 * to have, and the scaler leaves those alone rather than inventing a number
 * for them. numeric, not a float: doubling 0.1 three times should give 0.8.
 */
export const recipeIngredient = pgTable(
	'recipe_ingredient',
	{
		id: uuid('id').primaryKey(),
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull().default(0),
		quantity: numeric('quantity', { precision: 10, scale: 3 }),
		unit: text('unit').notNull().default(''),
		name: text('name').notNull()
	},
	(table) => [index('recipe_ingredient_recipe_idx').on(table.recipeId, table.ordinal)]
);

export const recipeStep = pgTable(
	'recipe_step',
	{
		id: uuid('id').primaryKey(),
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull().default(0),
		body: text('body').notNull()
	},
	(table) => [index('recipe_step_recipe_idx').on(table.recipeId, table.ordinal)]
);

// ---- Collections ----

/**
 * A shelf of things the household keeps.
 *
 * Named `collection` and not `shelf`: `shelf` is the Documents table — one
 * question, one unit, one template — and a bottle is not a document. The rail
 * still says "shelves" on screen, because that is the household's word for it;
 * this is the one place the two vocabularies are allowed to differ.
 *
 * **There is no `kind` column**, and its absence is deliberate. One was drafted
 * holding the single value `cellar`, on the reasoning that books and records
 * are the next two and the list is where they would arrive. `enums.test.ts`
 * refused it — a CHECK over one value is a constant wearing a validation's
 * clothes — and the objection is right: today every collection IS a cellar, so
 * the column would carry no information and the database would permit a `books`
 * row nothing could draw.
 *
 * The application finds this shelf by `key`, exactly as it finds the four
 * system Documents shelves by theirs. When a second engine exists, `kind`
 * arrives with a real choice in it.
 */
export const collection = pgTable('collection', {
	id: uuid('id').primaryKey(),
	key: text('key').notNull().unique(),
	name: text('name').notNull(),
	emoji: text('emoji').notNull().default('🍷'),
	/** Why a person would open it — the same prose a Documents shelf carries. */
	question: text('question').notNull().default(''),
	sortOrder: integer('sort_order').notNull().default(0)
});

/**
 * One kind of bottle, and how many of it are on the shelf.
 *
 * A row is not one physical bottle: it is a bottling the household owns some
 * number of. `owned` and `opened` are held as real counts and never clamped
 * for display — a clamp hides the bug it is covering — and the appendix's
 * CHECK is what proves the three controls in the ownership row keep them true.
 *
 * The state — sealed, open, finished — is read from those two numbers and is
 * deliberately not a column.
 */
export const bottle = pgTable(
	'bottle',
	{
		id: uuid('id').primaryKey(),
		/** RESTRICT, like shelf → document: deleting a shelf must not empty it. */
		collectionId: uuid('collection_id')
			.notNull()
			.references(() => collection.id, { onDelete: 'restrict' }),
		type: text('type').$type<EnumValue<'bottle.type'>>().notNull(),
		producer: text('producer').notNull().default(''),
		name: text('name').notNull(),
		/** A vintage year, or an age statement in years. Rarely both. */
		vintage: integer('vintage'),
		ageYears: integer('age_years'),
		country: char('country', { length: 2 }),
		region: text('region').notNull().default(''),
		/** The grape for wine, the cask for whisky — one field, because it is one line. */
		grapeOrCask: text('grape_or_cask').notNull().default(''),
		abv: numeric('abv', { precision: 4, scale: 1 }),
		sizeMl: integer('size_ml'),
		photo: text('photo'),
		/** A cropped label photograph, which drops into the silhouette's label plate. */
		labelPhoto: text('label_photo'),
		/**
		 * Here from the first release although nothing scans yet.
		 *
		 * Add-bottle is typed in v0.9.0. When the camera arrives it needs
		 * somewhere to look up "same as your Lagavulin from March", and adding
		 * the column later would be a migration for a feature that was always
		 * coming.
		 */
		barcode: text('barcode'),
		drinkFrom: integer('drink_from'),
		drinkTo: integer('drink_to'),
		owned: integer('owned').notNull().default(0),
		opened: integer('opened').notNull().default(0),
		boughtOn: date('bought_on'),
		boughtWhere: text('bought_where').notNull().default(''),
		boughtMinor: bigint('bought_minor', { mode: 'bigint' }),
		boughtCurrency: text('bought_currency').references(() => currency.code),
		/** SET NULL: re-importing a statement must not delete the bottle. */
		transactionId: uuid('transaction_id').references(() => transaction.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('bottle_collection_type_idx').on(table.collectionId, table.type),
		index('bottle_barcode_idx').on(table.barcode),
		index('bottle_bought_currency_idx').on(table.boughtCurrency),
		index('bottle_transaction_idx').on(table.transactionId)
	]
);

/**
 * A bottle opened and written down.
 *
 * This is also what "opened this year" counts — a logged tasting, not a button
 * press, which is what the tile's own note says.
 *
 * Scores are out of 100. The brief asked for 100 and 10 both; the design
 * removed the toggle as redundant, and a column that holds either would make
 * every comparison ask which scale each row was on.
 */
export const tasting = pgTable(
	'tasting',
	{
		id: uuid('id').primaryKey(),
		bottleId: uuid('bottle_id')
			.notNull()
			.references(() => bottle.id, { onDelete: 'cascade' }),
		tastedOn: date('tasted_on').notNull(),
		personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),
		score: integer('score'),
		note: text('note').notNull().default('')
	},
	(table) => [
		index('tasting_bottle_idx').on(table.bottleId, table.tastedOn),
		index('tasting_person_idx').on(table.personId)
	]
);

/**
 * One flavour the household wrote down, and the colour it is drawn in.
 *
 * Rows rather than an array column because the radar counts them: an axis is a
 * distinct note, its distance from the centre is how many tastings mentioned
 * it, and that is a GROUP BY over this table rather than an unnest.
 */
export const tastingNote = pgTable(
	'tasting_note',
	{
		id: uuid('id').primaryKey(),
		tastingId: uuid('tasting_id')
			.notNull()
			.references(() => tasting.id, { onDelete: 'cascade' }),
		note: text('note').notNull(),
		series: text('series').notNull()
	},
	(table) => [uniqueIndex('tasting_note_unique').on(table.tastingId, table.note)]
);

// ---- SQL drizzle-kit cannot model ----

/**
 * Shapes a CHECK can state and a column type cannot.
 *
 * The first one is the load-bearing one. Every rule in the bottle's ownership
 * row — plus adds a sealed bottle, minus removes the open one first, "Open
 * one" is the only control that raises the open count — exists to keep
 * `opened <= owned` true, and this is what proves they do rather than trusting
 * three event handlers to agree forever.
 */
export const lifeCheckSql = `
-- More bottles open than the household owns is not a state, it is a bug that
-- has already happened. Neither count may go negative either: a display that
-- clamps to zero hides exactly this.
ALTER TABLE bottle ADD CONSTRAINT bottle_counts_check
	CHECK (owned >= 0 AND opened >= 0 AND opened <= owned);
--> statement-breakpoint
-- A window that closes before it opens would draw a bar of negative width, and
-- the phase read off it would be nonsense. Either end alone is fine: a wine
-- that is drinking now with no closing year is an ordinary thing to record.
ALTER TABLE bottle ADD CONSTRAINT bottle_drink_window_check
	CHECK (drink_to IS NULL OR drink_from IS NULL OR drink_to >= drink_from);
--> statement-breakpoint
-- A price is an amount AND the currency it is in. Half of one is a number
-- nobody can convert, and it would be summed as base currency by whichever
-- caller forgot to check.
ALTER TABLE bottle ADD CONSTRAINT bottle_bought_money_check
	CHECK ((bought_minor IS NULL) = (bought_currency IS NULL));
--> statement-breakpoint
-- Out of 100, and 0 is not a score anybody writes down.
ALTER TABLE tasting ADD CONSTRAINT tasting_score_check
	CHECK (score IS NULL OR (score BETWEEN 1 AND 100));
--> statement-breakpoint
-- A trip that ends before it starts has no nights, and the year grouping on the
-- stamp wall would file it twice.
ALTER TABLE trip ADD CONSTRAINT trip_dates_check
	CHECK (ends_on >= starts_on);
--> statement-breakpoint
-- Two upper-case letters, the same rule the identity documents carry: this is
-- what keeps the map lookup and the flag from being handed 'Czechia'.
ALTER TABLE trip_destination ADD CONSTRAINT trip_destination_country_check
	CHECK (country ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE trip_idea ADD CONSTRAINT trip_idea_country_check
	CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE bottle ADD CONSTRAINT bottle_country_check
	CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE visit ADD CONSTRAINT visit_country_check
	CHECK (country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- A visit is to a year somebody was alive for and the map can label.
ALTER TABLE visit ADD CONSTRAINT visit_year_check
	CHECK (year BETWEEN 1900 AND 2200);
--> statement-breakpoint
-- A recipe scales FROM its stored servings, so zero would divide by nothing.
ALTER TABLE recipe ADD CONSTRAINT recipe_servings_check
	CHECK (servings > 0);
`;

/**
 * What makes writing a trip's visits idempotent.
 *
 * Opening the Map runs the "trips that have ended" pass, and it must be safe to
 * run on every load — so the derived row is keyed by the trip and the place it
 * came from. A partial index, because two MANUAL visits to Porto in different
 * years are two facts a household is entitled to record separately, while two
 * trip-derived rows for one destination are always a duplicate.
 *
 * COALESCE rather than the bare columns: in an index as in a WHERE clause, NULL
 * is not equal to NULL, so a country-only destination would insert again on
 * every single load — which is the exact bug this exists to stop.
 */
export const lifeIndexSql = `
CREATE UNIQUE INDEX visit_from_trip_unique
	ON visit (trip_id, country, COALESCE(region, ''), COALESCE(city, ''))
	WHERE source = 'trip';
`;

/**
 * The Cellar, which every install has from the first minute.
 *
 * Seeded here rather than in the demo, because Collections cannot make its own
 * shelf: v0.9.0 ships one shelf type and the rail's "New shelf" is deliberately
 * disabled until books and records arrive. A household without this row gets a
 * screen with an empty rail and an Add bottle button that does nothing, which is
 * exactly what happened on the first real install.
 *
 * `ON CONFLICT (key) DO NOTHING`, like the document shelves: the row is keyed by
 * `cellar` and the household is free to rename it afterwards.
 */
export const lifeSeedSql = `
INSERT INTO collection (id, key, name, emoji, question, sort_order) VALUES
	(gen_random_uuid(), 'cellar', 'Cellar', '🍷', 'What is worth opening, and when?', 0)
ON CONFLICT (key) DO NOTHING;
`;
