// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Who can sign in, how, and what the household has set.
 */

import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { OverviewPlacement } from '../../../overview/layout';
import type { TaxViewPrefs } from '../../../tax';
import type { EnumValue } from '../../../enums';

export const person = pgTable('person', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	initials: text('initials').notNull(),
	// Permission, not household relationship: 'admin' may manage people and API
	// tokens, 'member' may not. These are the only two valid values.
	role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
	birthYear: integer('birth_year'),
	// Null between "created by an admin" and "enrolled via the one-time link".
	// A null hash can never satisfy a sign-in — see verifyPassword.
	passwordHash: text('password_hash'),
	// Captured by sessions, passkeys and ceremonies so work begun before a
	// revocation cannot create a new way in after it commits.
	authGeneration: integer('auth_generation').notNull().default(0),
	// Set to suspend sign-in without deleting a person other tables reference.
	deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
	// Each person arranges their own Overview board. Plumbing attached to the
	// profile, never a Settings entry and never in the config export. Null means
	// "never chosen" and shows the first-run picker on an empty board; an empty
	// array is a person who removed every panel, which is a different and
	// equally valid state, and reads as an empty board with no picker on it.
	// validateSession selects explicit columns, so this never rides the hot path.
	overviewLayout: jsonb('overview_layout').$type<OverviewPlacement[]>(),
	// How this person last left the Tax screen: chart mode, display currency and
	// which filer's figures are shown. Same reasoning and same storage as
	// overviewLayout — preferences that should follow them between devices.
	// Null means never chosen, which reads as the household's own defaults.
	taxView: jsonb('tax_view').$type<TaxViewPrefs>(),
	// Null until this person picks one, which reads as dark. Stored on the person
	// rather than in the browser so it follows them between devices; a cookie
	// mirrors it so the pre-paint script can apply it without a round trip.
	theme: text('theme').$type<EnumValue<'person.theme'>>(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable(
	'session',
	{
		// sha256 hash of the bearer token; the raw token never touches the database
		id: text('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	// Revoking every other session of one person reads by person_id, as does
	// deleting them when the person goes. Indexed like every comparable foreign
	// key in this schema.
	(table) => [
		index('session_person_idx').on(table.personId),
		index('session_expires_idx').on(table.expiresAt)
	]
);

// The primary key arbitrates concurrent initial setup requests in PostgreSQL.
export const setupClaim = pgTable('setup_claim', {
	claimed: boolean('claimed').primaryKey(),
	claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow()
});

// A bearer token for the read-only API. Only the hash is stored — the raw
// token is shown once at creation, exactly as session tokens are handled.
export const apiToken = pgTable('api_token', {
	// sha256 hex of the bearer token
	id: text('id').primaryKey(),
	label: text('label').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true })
});

// A one-time link letting a new person set their own password, so the admin
// who created them never knows it. Only the hash is stored — the raw token
// appears once, exactly as sessions and API tokens are handled.
export const enrollmentToken = pgTable('enrollment_token', {
	// sha256 hex of the raw token
	id: text('id').primaryKey(),
	// Unique: one live link per person. createEnrollmentToken upserts against
	// this constraint, which is what makes reissuing atomic — without it two
	// racing reissues each left a spendable link behind.
	personId: uuid('person_id')
		.notNull()
		.unique()
		.references(() => person.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true })
});

// A WebAuthn challenge this server issued and has not yet spent.
//
// The challenge used to live only in an httpOnly cookie the caller hands back,
// which is not a record of anything: SvelteKit does not sign cookies, so the
// value was entirely attacker-chosen and "expectedChallenge" was whatever the
// request said it should be. One captured assertion could then be replayed into
// a fresh session forever. A row here is what makes a challenge single-use —
// verification deletes it and refuses if it was not there.
export const webauthnChallenge = pgTable(
	'webauthn_challenge',
	{
		// sha256 hex of the challenge, the way sessions and tokens are stored
		id: text('id').primaryKey(),
		address: text('address').notNull(),
		personId: uuid('person_id').references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation'),
		authSnapshot: jsonb('auth_snapshot').$type<Record<string, number>>().notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('webauthn_challenge_expires_idx').on(table.expiresAt),
		index('webauthn_challenge_address_created_idx').on(table.address, table.createdAt),
		index('webauthn_challenge_person_idx').on(table.personId)
	]
);

// A registered passkey. The public key is public by construction — the private
// half never leaves the authenticator, which is the whole point.
export const credential = pgTable(
	'credential',
	{
		// base64url credential ID as the authenticator reports it
		id: text('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation').notNull(),
		publicKey: text('public_key').notNull(),
		// See webauthn/counter.ts: 0 means "not reported", not "never used".
		counter: bigint('counter', { mode: 'number' }).notNull().default(0),
		transports: jsonb('transports').$type<string[]>().notNull().default([]),
		label: text('label').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true })
	},
	// Listing a person's passkeys and revoking them on a password change both
	// read by person_id.
	(table) => [index('credential_person_idx').on(table.personId)]
);

// App-level configuration owned by the Settings screen (module toggles, base
// currency, household name, …). One row per key, value is JSON.
export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull()
});
