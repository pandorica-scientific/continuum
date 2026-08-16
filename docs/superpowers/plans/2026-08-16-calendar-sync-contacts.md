# Calendar Sync and Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.3.7 — a contacts module, a writable shared household calendar with recurrence, and two-way synchronisation with iCloud (CalDAV) and Google Calendar, including write-back from remote date edits into the ledger rows that generated an event.

**Architecture:** Generated events stay derived and are never materialised; only the mapping between an event and its remote counterpart is stored. The unit of transfer is a whole series (an event plus every exception) so CalDAV's single-resource model and Google's separate-resource model stay inside their adapters. The merge is a pure function over `(base, local, remote)` with no network, database or clock, which makes the dangerous logic exhaustively testable offline.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript strict, PostgreSQL via Drizzle ORM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-calendar-sync-contacts-design.md`

## Global Constraints

- **Robert makes all git commits.** Never run `git commit`. Each task ends with a verification checkpoint; stop there and report.
- Money is integer minor units (`bigint`) plus a currency code. Never floats.
- Nothing variable is hard-coded. Poll interval, horizon bounds and the marker toggle are settings. Constants are allowed only for format facts (RFC 5545 property names, base32hex alphabet).
- Server-only code lives under `src/lib/server/`. Pure logic lives elsewhere under `src/lib/` and is unit-testable without a database.
- Ids are `randomUUID()` from `node:crypto`.
- Mutations return the discriminated result used across the codebase: `{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string }`.
- Timestamps are `timestamptz`. Dates that are calendar facts (not instants) are `date`.
- Tests: `npm test`, `npm run test:e2e` (needs `npm run build` and the database), `npm run check`, `npm run lint`.
- E2E is one ordered serial journey; new tests append to existing state.
- `drizzle-kit` needs `DATABASE_URL` set even to generate: prefix with `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum'`.
- **Live-API tests never run in CI.** Google and iCloud acceptance suites self-skip via `describe.skipIf(...)` on an env var, following `tests/acceptance/real-files.test.ts`. Fake-provider and fixture tests always run in CI.
- Migrations are append-only. Never edit or renumber an existing migration. Next free index is `0035` — `0034_person_overview_layout.sql` was already present.

---

## File Structure

**Create — pure logic (client-safe, no database):**

- `src/lib/calendar/rrule.ts` — RRULE parsing and occurrence expansion, timezone-aware.
- `src/lib/calendar/series.ts` — `EventSeries` type, canonical form, content hashing.
- `src/lib/calendar/merge.ts` — the pure three-way merge.
- `src/lib/calendar/markers.ts` — emoji + source-tag composition and stripping.
- `src/lib/calendar/keys.ts` — deterministic local keys and remote-id encoding.

**Create — server:**

- `src/lib/server/calendar/mutations.ts` — authored event CRUD and scope semantics.
- `src/lib/server/calendar/bindings.ts` — origin bindings and write-back.
- `src/lib/server/calendar/sync/engine.ts` — pull → reconcile → merge → push → commit.
- `src/lib/server/calendar/sync/provider.ts` — the `CalendarProvider` seam and registry.
- `src/lib/server/calendar/sync/icloud.ts` — CalDAV adapter.
- `src/lib/server/calendar/sync/google.ts` — Google Calendar adapter.
- `src/lib/server/contacts.ts` — contact CRUD, search, links.

**Create — routes and components:**

- `src/routes/(app)/contacts/+page.server.ts`, `+page.svelte`
- `src/lib/components/ContactForm.svelte`, `EventDialog.svelte`, `RecurrenceEditor.svelte`

**Create — tests:**

- `tests/unit/rrule.test.ts`, `series-hash.test.ts`, `calendar-merge.test.ts`, `calendar-markers.test.ts`, `calendar-keys.test.ts`, `contacts.test.ts`, `calendar-bindings.test.ts`
- `tests/integration/calendar-sync.test.ts` — engine against the fake provider
- `tests/acceptance/calendar-live.test.ts` — self-skipping live iCloud/Google

**Modify:**

- `src/lib/server/db/schema.ts` — ten new tables; drop `tenancy.tenantContact`.
- `src/lib/server/calendar.ts` — stable keys, bindings on `LedgerEvent`, `buildIcs` UID fix.
- `src/lib/modules/registry.ts` — `contacts` module, nav item, `EVENT_CATEGORIES`.
- `src/lib/server/briefing.ts` — two new sources appended to `SOURCES`.
- `src/routes/(app)/calendar/+page.server.ts`, `+page.svelte` — authoring UI.
- `src/routes/(app)/settings/+page.server.ts`, `+page.svelte` — accounts panel.
- `ARCHITECTURE.md`, `CHANGELOG.md`, `package.json`, `docs/google-calendar-setup.md`.

---

## Phase A — Contacts

Independently shippable. No calendar dependency.

### Task 1: Contact schema and migration

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0035_contacts.sql`
- Test: `tests/unit/migration-metadata.test.ts` (extend)

**Interfaces:**

- Produces: `contact`, `contactTenancy`, `contactProperty`, `contactLoan`, `contactAccount` Drizzle tables.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/migration-metadata.test.ts` inside the existing describe:

```ts
it('declares the contact tables and their links', () => {
	const snapshot = readSnapshot();
	expect(snapshot.tables).toHaveProperty('public.contact');
	expect(snapshot.tables['public.contact'].columns).toHaveProperty('organisation');
	expect(snapshot.tables['public.contact'].columns).toHaveProperty('job_title');
	expect(snapshot.tables['public.contact'].columns).toHaveProperty('photo');
	for (const t of ['contact_tenancy', 'contact_property', 'contact_loan', 'contact_account']) {
		expect(snapshot.tables).toHaveProperty(`public.${t}`);
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/migration-metadata.test.ts`
Expected: FAIL — `public.contact` is not in the snapshot.

- [ ] **Step 3: Add the tables to `schema.ts`**

```ts
export const contact = pgTable('contact', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// Stored upload name from saveUpload(), served via /files/[name].
	photo: text('photo'),
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

export const contactTenancy = pgTable(
	'contact_tenancy',
	{
		contactId: text('contact_id')
			.notNull()
			.references(() => contact.id, { onDelete: 'cascade' }),
		tenancyId: text('tenancy_id')
			.notNull()
			.references(() => tenancy.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.contactId, t.tenancyId] })]
);
```

Repeat the same shape for `contactProperty` (→ `property.id`), `contactLoan` (→ `loan.id`) and `contactAccount` (→ `account.id`). Each is a composite primary key with cascade on both sides, matching `documentPerson`.

- [ ] **Step 4: Generate and inspect the migration**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:generate`
Rename the generated file to `drizzle/0035_contacts.sql`. Read it and confirm it only creates tables — no drops.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/migration-metadata.test.ts`
Expected: PASS. Also update `SNAPSHOT_NAME` to the newly generated snapshot.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 2: Contact search with diacritic folding

**Files:**

- Create: `src/lib/server/contacts.ts`, `tests/unit/contacts.test.ts`
- Create: `drizzle/0036_contact_search.sql`

**Interfaces:**

- Produces: `listContacts(query?: string): Promise<ContactRow[]>`, `createContact(input: ContactInput): Promise<ContactMutationResult>`, `updateContact`, `deleteContact`, `normaliseSearch(term: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { normaliseSearch } from '$lib/server/contacts';

describe('contact search normalisation', () => {
	it('folds Czech and Polish diacritics', () => {
		expect(normaliseSearch('Řehoř')).toBe('rehor');
		expect(normaliseSearch('Żabka')).toBe('zabka');
		expect(normaliseSearch('Łódź')).toBe('lodz');
	});

	it('is idempotent on already-folded input', () => {
		expect(normaliseSearch('rehor')).toBe('rehor');
	});

	it('trims and lowercases', () => {
		expect(normaliseSearch('  Kaufland ')).toBe('kaufland');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contacts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalisation**

```ts
// Ł has no combining decomposition, so NFD alone misses it. The explicit map
// covers the Latin letters with a stroke rather than an accent.
const STROKED: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ħ: 'h', ŧ: 't' };

export function normaliseSearch(term: string): string {
	return term
		.trim()
		.toLowerCase()
		.replace(/[łđøħŧ]/g, (c) => STROKED[c])
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/contacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the database-side index**

Create `drizzle/0036_contact_search.sql`:

```sql
-- Contact search folds diacritics: a household with Czech and Polish names must
-- find Řehoř by typing "rehor". unaccent() handles combining accents; the
-- translate() wrapper covers stroked letters (Ł, Đ) which have no decomposition.
create extension if not exists unaccent;

create index contact_search_idx on contact using gin (
	to_tsvector('simple',
		unaccent(translate(lower(coalesce(name, '') || ' ' || coalesce(organisation, '')),
			'łđøħŧ', 'ldoht'))
	)
);
```

Append the entry to `drizzle/meta/_journal.json` by regenerating; do not hand-edit existing entries.

- [ ] **Step 6: Implement `listContacts` using the index**

```ts
export async function listContacts(query = ''): Promise<ContactRow[]> {
	const term = normaliseSearch(query);
	if (!term) return db.select().from(contact).orderBy(contact.name);
	return db
		.select()
		.from(contact)
		.where(
			sql`to_tsvector('simple', unaccent(translate(lower(coalesce(${contact.name}, '') || ' ' || coalesce(${contact.organisation}, '')), 'łđøħŧ', 'ldoht')))
			    @@ plainto_tsquery('simple', ${term})`
		)
		.orderBy(contact.name);
}
```

- [ ] **Step 7: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 3: Contact mutations and photo lifecycle

**Files:**

- Modify: `src/lib/server/contacts.ts`
- Test: `tests/unit/contacts.test.ts`

**Interfaces:**

- Produces: `createContact`, `updateContact`, `deleteContact`, all returning `ContactMutationResult = { ok: true; id: string } | { ok: false; status: 400 | 404; message: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { previousPhotoToRemove } from '$lib/server/contacts';

describe('photo lifecycle', () => {
	it('returns the old stored name when a new photo replaces it', () => {
		expect(previousPhotoToRemove('old.jpg', 'new.jpg')).toBe('old.jpg');
	});

	it('returns the old name when the photo is cleared', () => {
		expect(previousPhotoToRemove('old.jpg', null)).toBe('old.jpg');
	});

	it('returns null when the photo is unchanged', () => {
		expect(previousPhotoToRemove('same.jpg', 'same.jpg')).toBeNull();
	});

	it('returns null when there was no previous photo', () => {
		expect(previousPhotoToRemove(null, 'new.jpg')).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contacts.test.ts -t 'photo lifecycle'`
Expected: FAIL — `previousPhotoToRemove` is not exported.

- [ ] **Step 3: Implement**

```ts
/** Which stored upload (if any) is orphaned by this edit. Without this every
 *  re-upload leaves a file on the data volume forever. */
export function previousPhotoToRemove(before: string | null, after: string | null): string | null {
	if (!before) return null;
	return before === after ? null : before;
}
```

`updateContact` calls `removeUpload(previousPhotoToRemove(row.photo, input.photo))` after the row update commits, and `deleteContact` calls `removeUpload(row.photo)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/contacts.test.ts -t 'photo lifecycle'`
Expected: PASS.

- [ ] **Step 5: Exclude SVG from avatar uploads**

In the contact form action, validate the extension against a narrower set than `files.ts` allows:

```ts
// files.ts permits .svg for documents. An avatar is rendered in an <img>, but
// /files/[name] also serves it by direct navigation, where SVG can run script.
const AVATAR_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
```

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 4: Contacts screen

**Files:**

- Create: `src/routes/(app)/contacts/+page.server.ts`, `src/routes/(app)/contacts/+page.svelte`, `src/lib/components/ContactForm.svelte`
- Modify: `src/lib/modules/registry.ts`

**Interfaces:**

- Consumes: `listContacts`, `createContact`, `updateContact`, `deleteContact` from Task 2 and 3.
- Produces: the `/contacts` route; a `contacts` key in `MODULES`.

- [ ] **Step 1: Register the module**

In `src/lib/modules/registry.ts`, add to `MODULES`:

```ts
contacts: { emoji: '📇', label: 'Contacts', note: 'people, companies and who to call' },
```

and a nav item in the appropriate `NAV_GROUPS` entry:

```ts
{ path: '/contacts', label: 'Contacts', emoji: '📇', module: 'contacts' },
```

- [ ] **Step 2: Write the load and actions**

`+page.server.ts` exposes `load` (reads `?q=` and calls `listContacts`) and `actions` for `create`, `update` and `delete`. Follow the echo-back convention already used by the settings screen: on validation failure return `fail(400, { values, message })` with the submitted values so the form is not cleared.

- [ ] **Step 3: Build the screen**

`+page.svelte` renders a search box bound to `?q=`, a list of contacts showing photo, name, organisation and job title, and a detail panel with phone, email, address, notes and linked ledger entities. `ContactForm.svelte` handles create and edit including the file input.

- [ ] **Step 4: Verify the module toggle appears on its own**

Run: `npm run dev`, open Settings, and confirm a Contacts toggle is present without any Settings code being edited. This is the registry contract; if it is absent, the registry entry is wrong.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 5: Migrate `tenancy.tenantContact` into contacts

**Files:**

- Create: `drizzle/0037_tenant_contacts.sql`
- Modify: `src/lib/server/db/schema.ts`, `src/lib/server/property/mutations.ts`, `src/routes/(app)/property/+page.svelte`

**Interfaces:**

- Produces: `tenancy.tenantContact` removed; every non-empty value preserved as a linked contact.

- [ ] **Step 1: Write the migration**

```sql
-- tenant_contact was free text. Each non-empty value becomes a real contact,
-- named after the tenant, with the original text preserved verbatim in notes —
-- parsing a phone number out of unstructured text would invent data.
insert into contact (id, name, notes, created_at, updated_at)
select gen_random_uuid(), t.tenant_name, t.tenant_contact, now(), now()
from tenancy t
where coalesce(trim(t.tenant_contact), '') <> '';

insert into contact_tenancy (contact_id, tenancy_id)
select c.id, t.id
from tenancy t
join contact c on c.notes = t.tenant_contact and c.name = t.tenant_name
where coalesce(trim(t.tenant_contact), '') <> '';

alter table tenancy drop column tenant_contact;
```

- [ ] **Step 2: Write the failing test**

Add to `tests/integration/` a test that seeds a tenancy with contact text, runs the migration, and asserts one contact exists linked to that tenancy with `notes` equal to the original string.

- [ ] **Step 3: Run migration and test**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:migrate && npm test`
Expected: PASS.

- [ ] **Step 4: Remove the column from schema and all readers**

Delete `tenantContact` from the `tenancy` table definition and fix every compile error `npm run check` reports. The property screen now renders linked contacts instead.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit. **Phase A is independently shippable here.**

---

## Phase B — Writable calendar

### Task 6: Calendar event schema

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0038_calendar_events.sql`
- Test: `tests/unit/migration-metadata.test.ts`

**Interfaces:**

- Produces: `calendarEvent`, `calendarEventException` tables.

- [ ] **Step 1: Write the failing test**

```ts
it('declares calendar_event with a timezone column and the exception table', () => {
	const snapshot = readSnapshot();
	expect(snapshot.tables['public.calendar_event'].columns).toHaveProperty('tz');
	expect(snapshot.tables['public.calendar_event'].columns).toHaveProperty('rrule');
	expect(snapshot.tables['public.calendar_event'].columns).toHaveProperty('deleted_at');
	expect(snapshot.tables).toHaveProperty('public.calendar_event_exception');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/migration-metadata.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the tables**

```ts
export const calendarEvent = pgTable('calendar_event', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	notes: text('notes'),
	category: text('category'),
	allDay: boolean('all_day').notNull().default(false),
	startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
	endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
	// IANA zone. Not redundant with timestamptz: RRULE expansion is
	// timezone-dependent, and "every Tuesday 09:00" expanded in UTC drifts an
	// hour across DST for half the year.
	tz: text('tz').notNull(),
	rrule: text('rrule'),
	createdBy: text('created_by').references(() => person.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp('deleted_at', { withTimezone: true })
});

export const calendarEventException = pgTable(
	'calendar_event_exception',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => calendarEvent.id, { onDelete: 'cascade' }),
		// The ORIGINAL occurrence start, per RFC 5545 — never the moved-to time.
		// Storing the moved-to time makes a rescheduled occurrence resurrect.
		recurrenceId: text('recurrence_id').notNull(),
		cancelled: boolean('cancelled').notNull().default(false),
		title: text('title'),
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		notes: text('notes')
	},
	(t) => [unique().on(t.eventId, t.recurrenceId)]
);
```

- [ ] **Step 4: Generate the migration and run the test**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:generate && npx vitest run tests/unit/migration-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 7: RRULE expansion (pure)

**Files:**

- Create: `src/lib/calendar/rrule.ts`, `tests/unit/rrule.test.ts`

**Interfaces:**

- Produces: `expand(rrule: string, dtstart: string, tz: string, from: string, to: string): string[]` returning occurrence start instants as ISO strings; `parseRrule(s: string): Rrule`; `formatRrule(r: Rrule): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { expand } from '$lib/calendar/rrule';

describe('RRULE expansion', () => {
	it('expands a weekly rule on chosen weekdays', () => {
		const out = expand(
			'FREQ=WEEKLY;BYDAY=TU',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toHaveLength(5);
		expect(out[0]).toBe('2026-09-01T09:00:00.000Z');
	});

	// The reason tz exists as a column. Europe/Prague leaves DST on 2026-10-25.
	it('keeps local wall-clock time across a DST transition', () => {
		const out = expand(
			'FREQ=WEEKLY;BYDAY=SU',
			'2026-10-18T09:00:00+02:00',
			'Europe/Prague',
			'2026-10-18',
			'2026-11-01'
		);
		// 18 Oct is CEST (+02:00) → 07:00Z. 25 Oct and 1 Nov are CET (+01:00) → 08:00Z.
		expect(out[0]).toBe('2026-10-18T07:00:00.000Z');
		expect(out[1]).toBe('2026-10-25T08:00:00.000Z');
		expect(out[2]).toBe('2026-11-01T08:00:00.000Z');
	});

	it('clamps monthly-by-date to the last day of a short month', () => {
		const out = expand(
			'FREQ=MONTHLY;BYMONTHDAY=31',
			'2026-01-31T09:00:00Z',
			'UTC',
			'2026-01-01',
			'2026-03-31'
		);
		// February has no 31st. RFC 5545 skips it; it must NOT roll into March.
		expect(out).toEqual(['2026-01-31T09:00:00.000Z', '2026-03-31T09:00:00.000Z']);
	});

	it('honours UNTIL as inclusive', () => {
		const out = expand(
			'FREQ=DAILY;UNTIL=20260903T090000Z',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toHaveLength(3);
	});

	it('honours COUNT', () => {
		const out = expand(
			'FREQ=DAILY;COUNT=2',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toHaveLength(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/rrule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement expansion**

Support `FREQ` of `DAILY | WEEKLY | MONTHLY | YEARLY`, plus `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYSETPOS` (for "2nd Tuesday"), `COUNT` and `UNTIL`. Expand by walking candidate local wall-clock times and converting each to an instant using the event's `tz` via `Intl.DateTimeFormat` with `timeZone`, so DST is applied per occurrence rather than once. Skip invalid dates (31 February) rather than rolling forward.

Cap the walk at 10 000 candidate iterations and throw a named error beyond it — an unbounded `FREQ=DAILY` with no `COUNT`/`UNTIL` over a wide window must not hang the request.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/rrule.test.ts`
Expected: PASS — all five.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 8: Deterministic keys and the `buildIcs` UID fix

**Files:**

- Create: `src/lib/calendar/keys.ts`, `tests/unit/calendar-keys.test.ts`
- Modify: `src/lib/server/calendar.ts`

**Interfaces:**

- Produces: `generatedKey(ruleKey: string, binding: OriginBinding | null, month?: string): string`, `toRemoteId(localKey: string): string`.
- Consumes: `LedgerEvent` from `src/lib/server/calendar.ts`, extended with `key` and `binding` fields.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { generatedKey, toRemoteId } from '$lib/calendar/keys';

describe('generated event keys', () => {
	it('is stable for the same loan and month', () => {
		const b = { table: 'loan' as const, rowId: 'abc', field: 'paymentDay' };
		expect(generatedKey('loanPayments', b, '2026-09')).toBe('gen:loanPayments:loan:abc:2026-09');
		expect(generatedKey('loanPayments', b, '2026-09')).toBe(
			generatedKey('loanPayments', b, '2026-09')
		);
	});

	it('differs across months and rows', () => {
		const b = { table: 'loan' as const, rowId: 'abc', field: 'paymentDay' };
		expect(generatedKey('loanPayments', b, '2026-09')).not.toBe(
			generatedKey('loanPayments', b, '2026-10')
		);
	});

	it('encodes remote ids in Google-legal base32hex', () => {
		const id = toRemoteId('gen:loanPayments:loan:abc:2026-09');
		expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
		expect(toRemoteId('gen:loanPayments:loan:abc:2026-09')).toBe(id);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/calendar-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
const B32HEX = '0123456789abcdefghijklmnopqrstuv';

export function generatedKey(
	ruleKey: string,
	binding: OriginBinding | null,
	month?: string
): string {
	const parts = ['gen', ruleKey];
	if (binding) parts.push(binding.table, binding.rowId);
	if (month) parts.push(month);
	return parts.join(':');
}

/** Google accepts a client-supplied event id in base32hex, 5–1024 chars. Encoding
 *  our own key means the remote id is derivable, so calendar_sync_link is a cache
 *  rather than the source of truth — losing it rebuilds instead of duplicating. */
export function toRemoteId(localKey: string): string {
	const bytes = new TextEncoder().encode(localKey);
	let bits = 0,
		value = 0,
		out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32HEX[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32HEX[(value << (5 - bits)) & 31];
	return out.padEnd(5, '0');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/calendar-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the ICS UID fix**

```ts
import { buildIcs } from '$lib/server/calendar';

it('gives each generated event a UID derived from its identity, not its index', async () => {
	const ics = await buildIcs();
	const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());
	expect(new Set(uids).size).toBe(uids.length);
	// Index-based UIDs look like "20260915-3@continuum-ledger".
	for (const uid of uids) expect(uid).not.toMatch(/^\d{8}-\d+@/);
});
```

- [ ] **Step 6: Fix `buildIcs`**

Replace `UID:${day}-${i}@continuum-ledger` with `UID:${e.key}@continuum-ledger`. Add `key` and `binding` to `LedgerEvent` and populate both in `generateEvents` at each push site.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 9: Markers

**Files:**

- Create: `src/lib/calendar/markers.ts`, `tests/unit/calendar-markers.test.ts`
- Modify: `src/lib/modules/registry.ts`

**Interfaces:**

- Produces: `decorate(label: string, marker: string | null, sourceTag: boolean): string`, `strip(summary: string): string`, `EVENT_CATEGORIES`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { decorate, strip } from '$lib/calendar/markers';

describe('markers', () => {
	it('composes emoji and the source tag', () => {
		expect(decorate('ČS mortgage payment', '💳', true)).toBe('💳 ČS mortgage payment · Continuum');
	});

	it('omits the source tag for authored events', () => {
		expect(decorate('Dentist', '🏥', false)).toBe('🏥 Dentist');
	});

	// strip() feeds the content hash. If decoration survives into the hash, every
	// event compares as changed on every pass and the engine pushes forever.
	it('round-trips: strip undoes decorate', () => {
		expect(strip(decorate('ČS mortgage payment', '💳', true))).toBe('ČS mortgage payment');
		expect(strip(decorate('Dentist', '🏥', false))).toBe('Dentist');
	});

	it('strips a decorated summary that a remote client re-saved', () => {
		expect(strip('💳 ČS mortgage payment · Continuum')).toBe('ČS mortgage payment');
	});

	it('leaves an undecorated summary untouched', () => {
		expect(strip('Dentist')).toBe('Dentist');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/calendar-markers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export const SOURCE_TAG = ' · Continuum';

export function decorate(label: string, marker: string | null, sourceTag: boolean): string {
	const head = marker ? `${marker} ` : '';
	return `${head}${label}${sourceTag ? SOURCE_TAG : ''}`;
}

/** Remove decoration so the content hash sees only authored text. */
export function strip(summary: string): string {
	let out = summary;
	if (out.endsWith(SOURCE_TAG)) out = out.slice(0, -SOURCE_TAG.length);
	// A leading emoji plus one space. \p{Extended_Pictographic} covers the
	// module set including variation-selector forms like 🗂️.
	return out.replace(/^\p{Extended_Pictographic}️?\s/u, '').trim();
}
```

- [ ] **Step 4: Add the authored-event category registry**

In `src/lib/modules/registry.ts`:

```ts
// Authored-event categories. A fixed registry rather than free-text emoji so the
// marker keeps a reliable meaning and nothing unvalidated reaches a SUMMARY field.
export const EVENT_CATEGORIES = {
	household: { label: 'Household', emoji: '🏠' },
	money: { label: 'Money', emoji: '💰' },
	travel: { label: 'Travel', emoji: '✈️' },
	health: { label: 'Health', emoji: '🏥' },
	admin: { label: 'Admin', emoji: '📋' },
	social: { label: 'Social', emoji: '🎉' }
} as const;

export type EventCategoryKey = keyof typeof EVENT_CATEGORIES;
```

- [ ] **Step 5: Wire the marker toggle setting**

`getSetting<boolean>('calendarMarkers', true)` gates decoration at every render site (ICS, Google, CalDAV).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 10: Event mutations and scope semantics

**Files:**

- Create: `src/lib/server/calendar/mutations.ts`, `tests/unit/calendar-mutations.test.ts`

**Interfaces:**

- Produces: `createEvent`, `updateEvent(id, input, scope: EditScope)`, `deleteEvent(id, recurrenceId, scope)` where `EditScope = 'this' | 'following' | 'all'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { planScopeChange } from '$lib/server/calendar/mutations';

describe('edit scope planning', () => {
	it("'this' writes one exception and leaves the series alone", () => {
		const plan = planScopeChange('this', 'FREQ=WEEKLY;BYDAY=TU', '2026-09-15T09:00:00.000Z');
		expect(plan).toEqual({ kind: 'exception', recurrenceId: '2026-09-15T09:00:00.000Z' });
	});

	// 'following' is NOT an exception. Modelling it as one desynchronises
	// immediately: the remote keeps believing the original series owns those
	// occurrences.
	it("'following' truncates the original with UNTIL and starts a new series", () => {
		const plan = planScopeChange('following', 'FREQ=WEEKLY;BYDAY=TU', '2026-09-15T09:00:00.000Z');
		expect(plan.kind).toBe('split');
		expect(plan.truncatedRrule).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20260914T090000Z');
		expect(plan.newSeriesStart).toBe('2026-09-15T09:00:00.000Z');
	});

	it("'all' rewrites the series in place", () => {
		const plan = planScopeChange('all', 'FREQ=WEEKLY;BYDAY=TU', '2026-09-15T09:00:00.000Z');
		expect(plan).toEqual({ kind: 'series' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/calendar-mutations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `planScopeChange`**

`UNTIL` is set to one second before the split occurrence, formatted as a UTC basic-format timestamp per RFC 5545.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/calendar-mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the CRUD around it**

`createEvent`/`updateEvent`/`deleteEvent` run in one transaction, bump `updatedAt`, and set `deletedAt` rather than hard-deleting while any `calendar_sync_link` row still references the key.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 11: Calendar authoring UI

**Files:**

- Modify: `src/routes/(app)/calendar/+page.server.ts`, `+page.svelte`
- Create: `src/lib/components/EventDialog.svelte`, `src/lib/components/RecurrenceEditor.svelte`

**Interfaces:**

- Consumes: Task 7 `expand`, Task 9 `EVENT_CATEGORIES`, Task 10 mutations.

- [ ] **Step 1: Extend the load**

Merge authored occurrences (expanded over the visible month, exceptions applied) with `generateEvents` output. Each cell shows both kinds; generated events render with their module emoji.

- [ ] **Step 2: Build `RecurrenceEditor.svelte`**

Offer: does not repeat; daily; weekly on chosen weekdays; monthly by date; monthly by weekday position; yearly — each with an end condition (never / after N / until date). Emit the RFC 5545 string.

- [ ] **Step 3: Build `EventDialog.svelte`**

Create and edit, with the three-way scope prompt (`this` / `following` / `all`) shown only when the event has an `rrule`.

- [ ] **Step 4: Add the E2E journey**

Append to `tests/e2e/flow.spec.ts` (serial, builds on existing state): create a weekly event, edit one occurrence with scope `this`, assert the other occurrences are unchanged, and assert the exception survives a page reload.

- [ ] **Step 5: Verification checkpoint**

Run: `npm run build && npm run test:e2e && npm test && npm run check && npm run lint`
Report results. Do not commit. **Phase B is independently shippable here.**

---

## Phase C — Sync engine, no network

### Task 12: Series canonical form and hashing

**Files:**

- Create: `src/lib/calendar/series.ts`, `tests/unit/series-hash.test.ts`

**Interfaces:**

- Produces: `EventSeries`, `SeriesException`, `canonical(s: EventSeries): string`, `hash(s: EventSeries): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { hash } from '$lib/calendar/series';

const base = {
	uid: 'a',
	title: 'Dentist',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-01T09:00:00.000Z',
	endsAt: '2026-09-01T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: null,
	exceptions: [],
	updatedAt: '2026-09-01T00:00:00.000Z'
};

describe('series hashing', () => {
	it('ignores updatedAt — a timestamp bump is not a content change', () => {
		expect(hash({ ...base, updatedAt: '2027-01-01T00:00:00.000Z' })).toBe(hash(base));
	});

	it('ignores decoration on the title', () => {
		expect(hash({ ...base, title: '🏥 Dentist · Continuum' })).toBe(hash(base));
	});

	it('ignores line-ending differences in notes', () => {
		expect(hash({ ...base, notes: 'a\r\nb' })).toBe(hash({ ...base, notes: 'a\nb' }));
	});

	it('is order-independent across exceptions', () => {
		const x = { recurrenceId: '2026-09-08T09:00:00.000Z', cancelled: true };
		const y = { recurrenceId: '2026-09-15T09:00:00.000Z', cancelled: true };
		expect(hash({ ...base, exceptions: [x, y] })).toBe(hash({ ...base, exceptions: [y, x] }));
	});

	it('changes when real content changes', () => {
		expect(hash({ ...base, title: 'Doctor' })).not.toBe(hash(base));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/series-hash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`canonical` produces a deterministic string: strip decoration from `title` via `markers.strip`, normalise `\r\n` to `\n`, drop `updatedAt` and every provider-added field, sort exceptions by `recurrenceId`, and JSON-stringify with sorted keys. `hash` is `sha256` of that string, hex.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/series-hash.test.ts`
Expected: PASS — all five.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 13: The merge function

**Files:**

- Create: `src/lib/calendar/merge.ts`, `tests/unit/calendar-merge.test.ts`

**Interfaces:**

- Produces: `merge(input: MergeInput): MergeOutcome` where `MergeOutcome` is one of `{kind:'noop'}`, `{kind:'push'}`, `{kind:'apply'}`, `{kind:'push-delete'}`, `{kind:'apply-delete'}`, `{kind:'drop-link'}`, `{kind:'conflict', winner:'local'|'remote'}`, `{kind:'write-back', field: string, value: string}`.

- [ ] **Step 1: Write the failing test — the full table**

```ts
import { describe, expect, it } from 'vitest';
import { merge } from '$lib/calendar/merge';

const m = (local: string | null, remote: string | null, base: string | null) =>
	merge({
		baseHash: base,
		localHash: local,
		remoteHash: remote,
		localUpdatedAt: '2026-09-02T00:00:00Z',
		remoteUpdatedAt: '2026-09-01T00:00:00Z',
		generated: false,
		dateOnlyChange: false,
		binding: null
	}).kind;

describe('three-way merge', () => {
	it('does nothing when neither side moved', () => expect(m('h', 'h', 'h')).toBe('noop'));
	it('pushes when only local moved', () => expect(m('x', 'h', 'h')).toBe('push'));
	it('applies when only remote moved', () => expect(m('h', 'x', 'h')).toBe('apply'));
	it('conflicts when both moved', () => expect(m('x', 'y', 'h')).toBe('conflict'));
	it('applies a remote deletion', () => expect(m('h', null, 'h')).toBe('apply-delete'));
	it('conflicts on local edit versus remote delete', () =>
		expect(m('x', null, 'h')).toBe('conflict'));
	it('pushes a local deletion', () => expect(m(null, 'h', 'h')).toBe('push-delete'));
	it('drops the link when both deleted', () => expect(m(null, null, 'h')).toBe('drop-link'));

	it('resolves a conflict to the newer side', () => {
		const out = merge({
			baseHash: 'h',
			localHash: 'x',
			remoteHash: 'y',
			localUpdatedAt: '2026-09-02T00:00:00Z',
			remoteUpdatedAt: '2026-09-01T00:00:00Z',
			generated: false,
			dateOnlyChange: false,
			binding: null
		});
		expect(out).toEqual({ kind: 'conflict', winner: 'local' });
	});

	it('re-asserts a non-date remote edit to a generated event', () => {
		const out = merge({
			baseHash: 'h',
			localHash: 'h',
			remoteHash: 'y',
			localUpdatedAt: '2026-09-01T00:00:00Z',
			remoteUpdatedAt: '2026-09-02T00:00:00Z',
			generated: true,
			dateOnlyChange: false,
			binding: { table: 'loan', rowId: 'l1', field: 'paymentDay' }
		});
		expect(out.kind).toBe('push');
	});

	it('writes back a pure date move on a bound generated event', () => {
		const out = merge({
			baseHash: 'h',
			localHash: 'h',
			remoteHash: 'y',
			localUpdatedAt: '2026-09-01T00:00:00Z',
			remoteUpdatedAt: '2026-09-02T00:00:00Z',
			generated: true,
			dateOnlyChange: true,
			newDate: '2026-09-20',
			binding: { table: 'loan', rowId: 'l1', field: 'paymentDay' }
		});
		expect(out).toEqual({ kind: 'write-back', field: 'paymentDay', value: '2026-09-20' });
	});

	it('re-asserts a date move on an unbound generated event', () => {
		const out = merge({
			baseHash: 'h',
			localHash: 'h',
			remoteHash: 'y',
			localUpdatedAt: '2026-09-01T00:00:00Z',
			remoteUpdatedAt: '2026-09-02T00:00:00Z',
			generated: true,
			dateOnlyChange: true,
			newDate: '2026-09-20',
			binding: null
		});
		expect(out.kind).toBe('push');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/calendar-merge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Pure. No imports beyond types. Generated-event rules are evaluated before the generic table: a generated event with a remote change is `write-back` when `dateOnlyChange && binding`, otherwise `push` (re-assert).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/calendar-merge.test.ts`
Expected: PASS — all twelve.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 14: Sync tables

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0039_calendar_sync.sql`

**Interfaces:**

- Produces: `calendarAccount`, `calendarSyncLink`, `calendarConflict`.

- [ ] **Step 1: Write the failing test**

```ts
it('declares the sync tables', () => {
	const snapshot = readSnapshot();
	expect(snapshot.tables['public.calendar_sync_link'].columns).toHaveProperty('pushed_hash');
	expect(snapshot.tables['public.calendar_sync_link'].columns).toHaveProperty('suppressed_at');
	expect(snapshot.tables['public.calendar_account'].columns).toHaveProperty('cursor');
	expect(snapshot.tables).toHaveProperty('public.calendar_conflict');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/migration-metadata.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the tables per the spec's Schema section**

`calendarSyncLink` uses a composite primary key on `(localKey, accountId)`.

- [ ] **Step 4: Confirm credentials stay out of the config export**

Add a test asserting `calendar_account` is absent from the `config-file.ts` export whitelist:

```ts
it('never exports calendar credentials', async () => {
	const payload = await buildConfigExport();
	expect(JSON.stringify(payload)).not.toContain('calendarAccount');
	expect(JSON.stringify(payload)).not.toContain('credential');
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 15: The provider seam and a fake provider

**Files:**

- Create: `src/lib/server/calendar/sync/provider.ts`, `tests/integration/calendar-sync.test.ts`

**Interfaces:**

- Produces: `CalendarProvider`, `PullResult`, `PushOp`, `PushResult`, `registerCalendarProvider`, `makeCalendarProvider`, `calendarProviderKinds`. Mirrors `src/lib/server/home/provider.ts` including `ProviderField[]`.

- [ ] **Step 1: Write the interface**

```ts
export interface PullResult {
	changes: Array<{ uid: string; series: EventSeries | null; etag: string }>;
	cursor: string;
	/** The cursor was rejected — Google 410, an invalidated CalDAV sync-token, or
	 *  a server with no sync-collection support. The caller must fully reconcile. */
	reset: boolean;
}

export interface CalendarProvider {
	id: string;
	label: string;
	probe(): Promise<{ ok: boolean; detail: string }>;
	listCalendars(): Promise<Array<{ id: string; name: string }>>;
	pull(cursor: string | null): Promise<PullResult>;
	push(ops: PushOp[]): Promise<PushResult[]>;
}
```

- [ ] **Step 2: Build the in-memory fake**

A `Map<uid, {series, etag}>` with a monotonic change log, supporting cursor issue, a `forceReset()` switch, and a `failNextPush()` switch for crash tests. This is a test double, placed under `tests/` — not shipped.

- [ ] **Step 3: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 16: The engine

**Files:**

- Create: `src/lib/server/calendar/sync/engine.ts`
- Modify: `tests/integration/calendar-sync.test.ts`

**Interfaces:**

- Produces: `syncAccount(accountId: string): Promise<SyncReport>`.

- [ ] **Step 1: Write the failing tests — the invariants**

```ts
it('a second pass over unchanged state issues zero writes', async () => {
	await syncAccount(id);
	fake.resetCounters();
	await syncAccount(id);
	expect(fake.pushCount).toBe(0); // the push-loop guard
});

it('never duplicates after a cursor reset', async () => {
	await syncAccount(id);
	fake.forceReset();
	await syncAccount(id);
	expect(fake.uids().length).toBe(new Set(fake.uids()).size);
});

it('does not resurrect a remotely deleted event', async () => {
	await syncAccount(id);
	fake.deleteRemote(uid);
	await syncAccount(id);
	await syncAccount(id);
	expect(fake.has(uid)).toBe(false);
});

it('re-fetches rather than skips when a pass dies mid-apply', async () => {
	fake.failNextPush();
	await expect(syncAccount(id)).rejects.toThrow();
	const before = await cursorOf(id);
	await syncAccount(id);
	expect(before).toBe(null); // cursor was never advanced by the failed pass
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/calendar-sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the pass**

Order is pull → reconcile → merge → push → commit. Take a transaction-scoped advisory lock keyed on the account id before any read, the same way pairing does. Advance the cursor **last**, inside the transaction that applies the pull. Re-check `updatedAt` at push time and defer any event that changed mid-pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/calendar-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the convergence test**

Randomised interleavings of local and remote edits across 200 iterations with a fixed seed, asserting after each round: no duplicate uids, and nothing previously deleted is present.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit. **The engine is now proven with no network.**

---

## Phase D — iCloud

### Task 17: CalDAV adapter

**Files:**

- Create: `src/lib/server/calendar/sync/icloud.ts`
- Test: `tests/unit/caldav.test.ts` (fixtures), `tests/acceptance/calendar-live.test.ts` (self-skipping)

**Interfaces:**

- Consumes: `CalendarProvider` from Task 15.
- Produces: a registered `icloud` provider with fields `appleId` and `appPassword` (secret).

- [ ] **Step 1: Write the fixture test**

Record real iCloud responses into `tests/fixtures/caldav/`. Assert: principal discovery from `/.well-known/caldav`; calendar-home-set parsing; a `sync-collection` REPORT producing changes and a sync-token; and a series with two exceptions serialising to **one** `.ics` containing three `VEVENT` blocks, the two exceptions carrying `RECURRENCE-ID`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/caldav.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Basic auth with the app-specific password. `PUT` with `If-Match: <etag>` for updates and `If-None-Match: *` for creates; treat `412` on a create as "already there", not an error. Fall back to ctag-then-ETag diffing and return `reset: true` when `sync-collection` is unsupported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/caldav.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the self-skipping live suite**

```ts
// Live iCloud. Never runs in CI — no credentials there, and this suite must not
// gate a pull request. Same mechanism as tests/acceptance/real-files.test.ts.
const live = Boolean(process.env.ICLOUD_TEST_APP_PASSWORD);
describe.skipIf(!live)('iCloud live round trip', () => {
	/* … */
});
```

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Confirm the live suite reports as skipped. Do not commit.

---

### Task 18: Calendar accounts in Settings

**Files:**

- Modify: `src/routes/(app)/settings/+page.server.ts`, `+page.svelte`

**Interfaces:**

- Consumes: `calendarProviderKinds()`, `syncAccount`.

- [ ] **Step 1: Render the panel from `ProviderField[]`**

Connect, choose remote calendar, sync now, last sync time, last error, disconnect — following the existing Home Assistant form, which already renders itself from its provider description.

- [ ] **Step 2: Add the marker toggle**

Bound to the `calendarMarkers` setting from Task 9.

- [ ] **Step 3: E2E**

Append to `tests/e2e/flow.spec.ts`: connect a fake account, assert it appears with a last-sync time, disconnect it.

- [ ] **Step 4: Verification checkpoint**

Run: `npm run build && npm run test:e2e && npm test && npm run check && npm run lint`
Report results. Do not commit. **This is the release cut line — Phases A, B, C and D ship as v0.3.7 without Google if needed.**

---

## Phase E — Google

### Task 19: Google Calendar adapter

**Files:**

- Create: `src/lib/server/calendar/sync/google.ts`
- Test: `tests/unit/google-calendar.test.ts`

**Interfaces:**

- Consumes: `CalendarProvider`.
- Produces: a registered `google` provider with fields `clientId`, `clientSecret` (secret), `refreshToken` (secret).

- [ ] **Step 1: Write the fixture test — the fan-out**

```ts
// Google models each exception as its OWN event resource, tied back by
// recurringEventId + originalStartTime. CalDAV puts them in one .ics. Keeping
// the transfer unit a whole series means this asymmetry stays in here.
it('fans a series with two exceptions out to three event resources', () => {
	const ops = toGoogleOps(seriesWithTwoExceptions);
	expect(ops).toHaveLength(3);
	expect(ops[0].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU']);
	expect(ops[1].body.recurringEventId).toBe(ops[0].body.id);
	expect(ops[1].body.originalStartTime.dateTime).toBe('2026-09-08T09:00:00Z');
});

it('reassembles three resources back into one series', () => {
	expect(fromGoogle(threeResources).exceptions).toHaveLength(2);
});

it('treats 410 Gone on a syncToken as a reset, not an error', async () => {
	const out = await providerWith410.pull('stale-token');
	expect(out.reset).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/google-calendar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

OAuth refresh against `https://oauth2.googleapis.com/token`. `events.list` with `syncToken` for incremental pulls, treating `410` as `reset: true`. `events.insert` supplies our own `id` from `toRemoteId`. Deletions arrive as `status: 'cancelled'`. On `invalid_grant`, write `last_error` and stop — do not retry in a loop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/google-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the self-skipping live suite**

Gated on `process.env.GOOGLE_TEST_REFRESH_TOKEN`. Never runs in CI.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Confirm both live suites report as skipped. Do not commit.

---

### Task 20: Google OAuth flow and setup guide

**Files:**

- Create: `src/routes/(app)/settings/google/callback/+server.ts`, `docs/google-calendar-setup.md`

- [ ] **Step 1: Implement the redirect flow**

Authorisation code flow with `access_type=offline` and `prompt=consent` (required to receive a refresh token on re-authorisation). Store the refresh token in `calendar_account.credential`. Validate the `state` parameter against a session-bound nonce.

- [ ] **Step 2: Write the setup guide**

`docs/google-calendar-setup.md` must lead with the publishing-status trap:

> **Set the OAuth consent screen to "In production" before connecting.** Left at
> "Testing", Google expires the refresh token after exactly 7 days — sync works
> for a week, then stops silently, every week. Publishing does not require
> verification. You will see a "Google hasn't verified this app" screen once;
> choose Advanced → Go to Continuum. The 100-user cap does not matter for a
> household using its own project.

Then: create a Cloud project, enable the Calendar API, configure the consent screen, create an OAuth client of type Web application, set the redirect URI, and paste the client ID and secret. Note that the API is free within a 1,000,000 requests/day quota and needs no billing account, and that a household already running the Home Assistant Google Calendar integration can reuse its existing Cloud project.

- [ ] **Step 3: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

## Phase F — Write-back and release

### Task 21: Origin bindings and write-back

**Files:**

- Create: `src/lib/server/calendar/bindings.ts`, `tests/unit/calendar-bindings.test.ts`
- Modify: `src/lib/server/calendar.ts`

**Interfaces:**

- Produces: `applyWriteBack(binding: OriginBinding, newDate: string): Promise<WriteBackResult>`.

- [ ] **Step 1: Write the failing test**

```ts
it('maps each generated event class to its owning row and field', () => {
	expect(bindingFor(loanPaymentEvent)).toEqual({ table: 'loan', rowId: 'l1', field: 'paymentDay' });
	expect(bindingFor(leaseEndEvent)).toEqual({ table: 'tenancy', rowId: 't1', field: 'endDate' });
	expect(bindingFor(documentExpiryEvent)).toEqual({
		table: 'document',
		rowId: 'd1',
		field: 'expiresOn'
	});
});

// No row behind a pure schedule rule, so nothing to write.
it('gives schedule-only rules no binding', () => {
	expect(bindingFor(importReminderEvent)).toBeNull();
	expect(bindingFor(quarterlyReportEvent)).toBeNull();
});

it('extracts the day of month when writing back loan.paymentDay', () => {
	expect(writeBackValue({ table: 'loan', rowId: 'l1', field: 'paymentDay' }, '2026-09-20')).toBe(
		20
	);
});

it('writes the whole date for single-date fields', () => {
	expect(writeBackValue({ table: 'tenancy', rowId: 't1', field: 'endDate' }, '2026-09-20')).toBe(
		'2026-09-20'
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/calendar-bindings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`applyWriteBack` runs in one transaction, updates the bound field, and inserts a `calendar_conflict` row with `resolution: 'wrote-back'` recording both sides.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/calendar-bindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Announce the `paymentDay` fan-out**

`loan.paymentDay` is a day-of-month integer, so moving one month's event moves every month. The write-back records a conflict row whose message states it in those terms, which Task 22 surfaces:

> The ČS mortgage payment day changed from 15 to 20 — every month, from a calendar edit.

- [ ] **Step 6: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 22: Briefing sources

**Files:**

- Modify: `src/lib/server/briefing.ts`
- Test: `tests/unit/briefing.test.ts`

**Interfaces:**

- Consumes: the `SOURCES` array convention already in `briefing.ts`.
- Produces: `calendarConflicts` and `syncFailures` appended to `SOURCES`.

- [ ] **Step 1: Write the failing test**

```ts
it('raises a briefing item for an undismissed calendar conflict', async () => {
	const items = await calendarConflicts();
	expect(items[0].hue).toBe('yellow');
	expect(items[0].text).toContain('calendar edit');
});

it('raises a red item when an account has failed several passes', async () => {
	const items = await syncFailures();
	expect(items[0].hue).toBe('red');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/briefing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both sources and append them to `SOURCES`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/briefing.test.ts`
Expected: PASS.

- [ ] **Step 5: Verification checkpoint**

Run: `npm test && npm run check && npm run lint`
Report results. Do not commit.

---

### Task 23: Documentation and release

**Files:**

- Modify: `ARCHITECTURE.md`, `CHANGELOG.md`, `package.json`, `docker/DOCKERHUB.md`, `README.md`

- [ ] **Step 1: Add the seam row to `ARCHITECTURE.md`**

| Calendar providers | `CalendarProvider` (`src/lib/server/calendar/sync/provider.ts`): probe / listCalendars / pull / push | iCloud CalDAV, Google Calendar | `registerCalendarProvider(id, label, factory, fields, hint)` — the Settings panel picks it up automatically |

- [ ] **Step 2: Add three correctness anchors**

Deterministic identity on both sides; the merge as a pure function; no-duplicates and no-resurrection as the two invariants the convergence test pins.

- [ ] **Step 3: Update `CHANGELOG.md` with an Upgrading note**

Cover the dropped `tenancy.tenantContact` column and the `unaccent` extension requirement.

- [ ] **Step 4: Bump the version**

`package.json` → `0.3.7`.

- [ ] **Step 5: Final verification**

Run: `npm run build && npm run test:e2e && npm test && npm run check && npm run lint`
Confirm both live suites report as skipped, and that `npm test` has no network access.
Report results. Do not commit.

---

### Task 24: Code review of the whole release

**Files:** the whole branch against `main`.

`main..HEAD` is now 81 files changed (+27997/−80), 57 of them new — the largest
change set the project has had, and none of it has been read by anything but the
process that wrote it.

The work is committed, so `git diff main` covers it. Check for uncommitted
stragglers before starting, and include them:

```
git diff main --stat | tail -1
git status --porcelain          # anything here is not in that diff
```

**Run it last.** A review before Phase F would miss write-back, the briefing
sources and the documentation, which is where the remaining risk is.

- [ ] **Step 1: Run the review**

Run: `/code-review max` against the branch. `max` rather than a lower level
because the failure modes here are subtle rather than obvious — a merge that
silently drops an edit reads as correct code.

- [ ] **Step 2: Read every finding against these four questions**

The review has no way to know which invariants matter, so judge its output
against the ones this release lives or dies by:

1. **Does anything reach the content hash that should not?** Decoration reaching
   it is the push loop; an author's own emoji being stripped from it is silent
   data loss. Both were live bugs during the build.
2. **Can any path duplicate or resurrect an event?** Those are the two
   invariants the convergence test pins, and they are the two that destroy trust
   in a calendar.
3. **Can a credential leave?** `calendar_account.credential` must not reach a
   load function, a page payload or the config export.
4. **Does any comment claim something the code does not do?** Three were found
   and corrected during the build (the MATERIALIZED claim, the iteration cap, the
   sync interval). Assume more survive.

- [ ] **Step 3: Verify each finding before acting on it**

A review of this much unfamiliar code will report things that are not true. For
each finding, reproduce it — write the failing test first — before changing
anything. A finding that cannot be reproduced is recorded as rejected, with the
reason, rather than silently dropped.

- [ ] **Step 4: Fix, with a regression test per real finding**

- [ ] **Step 5: Verification checkpoint**

Run: `npm run build && npm run test:e2e && npm test && npm run check && npm run lint`
Confirm both live suites still report as skipped. Report results. Do not commit.

---

## Self-Review

**Spec coverage.** Every section maps to a task: Schema → 1, 6, 14; Event identity → 8; Markers → 9; Provider seam → 15; Sync engine → 16; Write-back → 21; Contacts → 1–5; UI surfaces → 4, 11, 18; Google setup cost → 20; Briefing → 22; Testing → distributed with the feature each covers; Build order → the phase ordering.

**Type consistency.** `EventSeries` is defined once in Task 12 and consumed by 15, 17 and 19. `OriginBinding` is defined in Task 8 and consumed by 13 and 21. `MergeOutcome` is defined in Task 13 and consumed by 16. `normaliseSearch` (Task 2) and `strip` (Task 9) are distinct functions with distinct jobs and are not interchanged.

**Known gap, deliberate.** `expand()` in Task 7 handles `BYSETPOS` only for the monthly-by-weekday-position case the editor emits. A remote client authoring a more exotic `BYSETPOS` round-trips as an opaque string but will not expand correctly in our own month grid. Out of scope per the spec's "exotic recurrence authoring" exclusion; worth an issue.
