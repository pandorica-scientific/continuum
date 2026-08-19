// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * People and companies outside the household.
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The household's address book: tenants, tradespeople, bank contacts. Replaces
// tenancy.tenantContact, which was one free-text string with no structure and
// nowhere to put a second number.
export const contact = pgTable('contact', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	// A stored upload name from saveUpload(), served through /files/[name] —
	// the same convention property photos use. Never a path or a URL.
	photo: text('photo'),
	// organisation and jobTitle are kept apart rather than as one "work" string:
	// that is the vCard ORG/TITLE split, so a later CardDAV export is a mapping
	// rather than a migration, and "everyone at Česká spořitelna" stays askable.
	organisation: text('organisation'),
	jobTitle: text('job_title'),
	phone: text('phone'),
	email: text('email'),
	address: text('address'),
	notes: text('notes'),
	category: text('category'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
