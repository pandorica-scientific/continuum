// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rows for integration suites to test against.
 *
 * `harness.ts` starts a database; it does not put anything in one. So 74
 * suites hand-rolled their own rows, and 332 inline `insert()` calls grew up
 * around the same seven tables — 29 of them constructing an `account`. A
 * column added to `account` therefore meant editing 29 call sites that did not
 * care about it, which is most of what "the tests are brittle" actually meant.
 *
 * Every builder here fills the columns the schema demands and nothing else,
 * takes overrides for whatever the test is actually about, and returns the
 * inserted row. A test names the two facts it cares about; the rest stops
 * being its problem.
 *
 * Builders compose: `makeTransaction` opens an account if handed none,
 * `makeDocumentLink` creates both ends. Pass an id when a test needs the same
 * value twice — `rowId('...')` from `../row-id` keeps that legible.
 */
import { uuidv7 } from 'uuidv7';
import {
	account,
	contact,
	document,
	documentLink,
	loan,
	person,
	property,
	transaction
} from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ENUMS } from '$lib/enums';
import type { Queryable } from '$lib/server/db';
import { rowId } from '../row-id';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/**
 * The currency a fixture reaches for when the test says nothing.
 *
 * A fixture default, not a household fact: `account` is the currency authority
 * in this application, so anything testing currency behaviour passes its own
 * and never inherits this.
 */
export const FIXTURE_CURRENCY = 'CZK';

/** Any date column a test does not care about resolves to this. */
export const FIXTURE_DATE = '2025-01-15';

/**
 * A fingerprint that collides with nothing.
 *
 * Production derives this from the parsed row — see `$lib/server/import/
 * fingerprint` — because it is how a re-imported statement is recognised. A
 * fixture is usually not about dedup, and a unique index on
 * `(accountId, dedupFingerprint)` would turn two otherwise-identical fixture
 * rows into a failure about nothing. A suite testing dedup passes its own.
 */
function uniqueFingerprint(): string {
	return `fixture-${uuidv7()}`;
}

export async function makePerson(
	db: Queryable,
	overrides: Partial<Insert<typeof person>> = {}
): Promise<typeof person.$inferSelect> {
	const name = overrides.name ?? 'Test Person';
	const [row] = await db
		.insert(person)
		.values({
			id: uuidv7(),
			name,
			// Derived rather than fixed, so two people in one suite do not collide
			// on a column the test never mentioned.
			initials: initialsOf(name),
			...overrides
		})
		.returning();
	return row;
}

function initialsOf(name: string): string {
	const letters = name
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => [...word][0]?.toUpperCase() ?? '')
		.join('');
	return letters.slice(0, 3) || 'X';
}

export async function makeAccount(
	db: Queryable,
	overrides: Partial<Insert<typeof account>> = {}
): Promise<typeof account.$inferSelect> {
	const [row] = await db
		.insert(account)
		.values({
			id: uuidv7(),
			name: 'Test Account',
			bank: 'Test Bank',
			currency: FIXTURE_CURRENCY,
			...overrides
		})
		.returning();
	return row;
}

export async function makeProperty(
	db: Queryable,
	overrides: Partial<Insert<typeof property>> = {}
): Promise<typeof property.$inferSelect> {
	const [row] = await db
		.insert(property)
		.values({
			id: uuidv7(),
			name: 'Test Flat',
			// Read from the enum registry, not spelled out: a fixture that pins a
			// literal here goes stale the day the allowed values change, and does
			// it as a constraint violation in an unrelated suite.
			kind: ENUMS['property.kind'][0],
			currency: FIXTURE_CURRENCY,
			...overrides
		})
		.returning();
	return row;
}

export async function makeLoan(
	db: Queryable,
	overrides: Partial<Insert<typeof loan>> = {}
): Promise<typeof loan.$inferSelect> {
	const [row] = await db
		.insert(loan)
		.values({
			id: uuidv7(),
			name: 'Test Loan',
			currency: FIXTURE_CURRENCY,
			principalMinor: 1_000_000_00n,
			owedMinor: 900_000_00n,
			...overrides
		})
		.returning();
	return row;
}

export async function makeTransaction(
	db: Queryable,
	overrides: Partial<Insert<typeof transaction>> = {}
): Promise<typeof transaction.$inferSelect> {
	// A transaction without an account is not representable, so open one rather
	// than making every caller say so.
	const accountId = overrides.accountId ?? (await makeAccount(db)).id;
	const [row] = await db
		.insert(transaction)
		.values({
			id: uuidv7(),
			accountId,
			bookedOn: FIXTURE_DATE,
			amountMinor: -1_000_00n,
			currency: FIXTURE_CURRENCY,
			dedupFingerprint: uniqueFingerprint(),
			...overrides
		})
		.returning();
	return row;
}

export async function makeContact(
	db: Queryable,
	overrides: Partial<Insert<typeof contact>> = {}
): Promise<typeof contact.$inferSelect> {
	const [row] = await db
		.insert(contact)
		.values({ id: uuidv7(), name: 'Test Contact', ...overrides })
		.returning();
	return row;
}

export async function makeDocument(
	db: Queryable,
	overrides: Partial<Insert<typeof document>> & { shelfKey?: string } = {}
): Promise<typeof document.$inferSelect> {
	const { shelfKey, ...rest } = overrides;
	// `shelfId` is NOT NULL against a seeded table, so resolve the shelf by the
	// key a reader recognises instead of asking tests to carry a uuid.
	const shelfId = rest.shelfId ?? (await shelfIdByKey(shelfKey ?? 'inbox', db));
	const [row] = await db
		.insert(document)
		.values({
			id: uuidv7(),
			name: 'Test Document',
			shelfId,
			addedOn: FIXTURE_DATE,
			...rest
		})
		.returning();
	return row;
}

/**
 * File a document against a record.
 *
 * `targetId` is a foreign key into `entity`, which every concrete table
 * registers by trigger — so any row a builder above returned is a valid
 * target, and nothing has to register it by hand.
 */
export async function makeDocumentLink(
	db: Queryable,
	options: { documentId?: string; targetId?: string } = {}
): Promise<typeof documentLink.$inferSelect> {
	const documentId = options.documentId ?? (await makeDocument(db)).id;
	const targetId = options.targetId ?? (await makeAccount(db)).id;
	const [row] = await db.insert(documentLink).values({ documentId, targetId }).returning();
	return row;
}

// ---- Sessions ----

/**
 * A session as a route loader sees it.
 *
 * Seventeen suites declared their own `asAdmin`/`asMember` pair, which is the
 * same drift risk as the rows above: the shape is the application's, not each
 * suite's.
 */
export interface SessionLocals {
	person: {
		id: string;
		name: string;
		initials: string;
		role: 'admin' | 'member';
		theme: null;
	};
}

/**
 * A session for each role, ready to hand to a loader.
 *
 * Frozen and shared because they are read, never written; a suite that needs a
 * particular person calls `session()` instead. Ids are derived, so a failure
 * naming one is traceable to the fixture rather than to a fresh uuid.
 */
export function session(
	role: 'admin' | 'member',
	overrides: Partial<SessionLocals['person']> = {}
): SessionLocals {
	const name = overrides.name ?? (role === 'admin' ? 'Admin' : 'Member');
	return {
		person: {
			id: overrides.id ?? rowId(`fixture-${role}`),
			name,
			initials: overrides.initials ?? initialsOf(name),
			role,
			theme: null,
			...overrides
		}
	};
}

export const asAdmin: SessionLocals = Object.freeze(session('admin'));
export const asMember: SessionLocals = Object.freeze(session('member'));

/** Re-exported so a suite needs one fixtures import rather than two. */
export { rowId } from '../row-id';
