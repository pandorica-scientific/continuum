# Passkey Authentication and Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passkey sign-in alongside the existing passwords, and close the account-management gaps (password change, enrollment links, deactivation, an administrator gate) that Continuum has lacked since setup was the only moment authentication was designed for.

**Architecture:** Passkeys are additive — `person.password_hash` stays, a new `credential` table sits alongside `person`, and both sign-in paths converge on the existing `createSession`. WebAuthn requires a secure context, so the deployment moves onto Tailscale, which is private by default. All risky logic (signature-counter comparison, token lifecycle, permission guards, origin classification) is factored into pure functions so it is unit-testable without a database, matching how this repository already tests.

**Tech Stack:** SvelteKit 2 / Svelte 5, Drizzle ORM on Postgres, `@node-rs/argon2`, vitest for unit tests, Playwright for end-to-end, Docker Compose. Two new runtime dependencies: `@simplewebauthn/server` and `@simplewebauthn/browser`.

**Spec:** `docs/superpowers/specs/2026-08-14-passkey-auth-design.md`

## Global Constraints

- **Commits are made by the repository owner, never by the implementer.** Each task ends with a Checkpoint step that runs verification and reports which files are ready. Do not run `git commit` or `git add`.
- **The spec is committed together with the code**, not separately.
- `person.role` has exactly two values: `'admin'` and `'member'`. No other value may be written anywhere, including the demo seeder and the setup wizard.
- The relying-party ID is always derived from `ORIGIN` via `new URL(origin).hostname`. It is never a separate configuration value.
- Passkey interface elements render only when the secure-context flag is true. Over plain HTTP they are absent, not disabled.
- The signature-counter check treats `0` as "not reported". A clone is signalled only when stored and incoming are both non-zero and the incoming value has not advanced.
- Invalid, expired and already-used enrollment tokens must produce an identical message to the visitor.
- Passwords remain a permanent sign-in method. No task removes them.
- Existing end-to-end tests sign in by password throughout. They must pass unchanged after every task; a failure there is a regression in the existing path.
- Follow existing repository conventions: tab indentation, `$lib/server/...` import aliases, explanatory comments in the style already present in `auth/index.ts` and `api/tokens.ts`.

## Verification commands

```bash
npm run check      # svelte-check, expect 0 errors
npm run lint       # eslint + prettier
npm run test:unit  # vitest
npm run test:e2e   # playwright
```

---

# Phase 1 — Account management

Phase 1 ships on the current plain-HTTP deployment, needs no new dependencies, and is independently useful. Phase 2 depends on its schema work but nothing else.

---

### Task 1: Schema migration and role semantics

Gives `person.role` a single meaning, makes `password_hash` nullable so a person can exist before choosing a password, adds `deactivated_at`, and creates the `enrollment_token` table.

**Files:**

- Modify: `src/lib/server/db/schema.ts:19-27` (the `person` table)
- Modify: `src/routes/setup/+page.server.ts:44-60` (wizard must set `role`)
- Create: `drizzle/0018_*.sql` (generated, then hand-edited)
- Test: `tests/unit/auth-policy.test.ts` (created in Task 3; no test in this task — schema changes are verified by `npm run check` and the existing end-to-end suite)

**Interfaces:**

- Consumes: nothing.
- Produces: `person.role` typed as `'admin' | 'member'`; `person.deactivatedAt: Date | null`; `person.passwordHash: string | null`; the `enrollmentToken` table export.

- [ ] **Step 1: Change the `person` table**

In `src/lib/server/db/schema.ts`, replace the `person` table with:

```ts
export const person = pgTable('person', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	initials: text('initials').notNull(),
	// Permission, not household relationship: 'admin' may manage people and API
	// tokens, 'member' may not. These are the only two valid values.
	role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
	birthYear: integer('birth_year'),
	// Null between "created by an admin" and "enrolled via the one-time link".
	// A null hash can never satisfy a sign-in — see verifyPassword.
	passwordHash: text('password_hash'),
	// Set to suspend sign-in without deleting a person other tables reference.
	deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

- [ ] **Step 2: Add the `enrollment_token` table**

Directly after the `apiToken` table in the same file:

```ts
// A one-time link letting a new person set their own password, so the admin
// who created them never knows it. Only the hash is stored — the raw token
// appears once, exactly as sessions and API tokens are handled.
export const enrollmentToken = pgTable('enrollment_token', {
	// sha256 hex of the raw token
	id: text('id').primaryKey(),
	personId: text('person_id')
		.notNull()
		.references(() => person.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true })
});
```

- [ ] **Step 3: Make the setup wizard assign roles**

In `src/routes/setup/+page.server.ts`, inside the `for (const p of people)` loop at line 45, the insert currently omits `role`. Add it so the first person created becomes the administrator:

```ts
await db.insert(person).values({
	id,
	name: p.name,
	initials: p.name
		.split(/\s+/)
		.map((w) => w[0] ?? '')
		.join('')
		.slice(0, 2)
		.toUpperCase(),
	// The person who runs the wizard administers the instance; anyone
	// else added here is an ordinary member.
	role: firstId === id ? 'admin' : 'member',
	birthYear: p.birthYear ? Number(p.birthYear) : null,
	passwordHash: await hashPassword(p.password)
});
```

Note `firstId` is assigned immediately above, so `firstId === id` is true only on the first iteration.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`

Expected: a new `drizzle/0018_<name>.sql` containing the `ALTER TABLE` statements and the `CREATE TABLE enrollment_token`.

- [ ] **Step 5: Hand-edit the migration to carry the data forward**

`drizzle-kit` generates schema changes but not data migrations. Append to the generated `drizzle/0018_<name>.sql`:

```sql
--> statement-breakpoint
-- Existing installs predate the two-value role. Everyone becomes a member,
-- then the earliest person by created_at is promoted, matching the rule the
-- setup wizard now applies to fresh installs.
UPDATE "person" SET "role" = 'member';--> statement-breakpoint
UPDATE "person" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "person" ORDER BY "created_at" ASC LIMIT 1);
```

Verify the generated file already contains, and add by hand if it does not:

```sql
ALTER TABLE "person" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "deactivated_at" timestamp with time zone;
```

- [ ] **Step 6: Check the demo seeder still agrees**

Read `src/lib/server/demo.ts:52,56`. It already writes `role: 'admin'` and `role: 'member'`, which are the two valid values, so no change is needed. Confirm by reading, do not edit.

- [ ] **Step 7: Verify**

Run: `npm run check`
Expected: 0 errors. If `passwordHash` being nullable produces type errors in `login/+page.server.ts`, leave them — Task 3 fixes that file. Record which files error so Task 3 can confirm it addressed all of them.

- [ ] **Step 8: Checkpoint**

Run `npm run test:e2e`. The wizard journey must still pass, proving the migration applies cleanly to a fresh database.

Ready for the owner to commit: `src/lib/server/db/schema.ts`, `src/routes/setup/+page.server.ts`, `drizzle/0018_*.sql`, `drizzle/meta/*`.

---

### Task 2: Enrollment token module

A module mirroring `src/lib/server/api/tokens.ts`, with the lifecycle decision extracted as a pure function so it can be unit tested.

**Files:**

- Create: `src/lib/server/auth/enrollment.ts`
- Test: `tests/unit/enrollment.test.ts`

**Interfaces:**

- Consumes: `enrollmentToken` table from Task 1.
- Produces:
  - `enrollmentStatus(row: EnrollmentRow | undefined, now: Date): EnrollmentStatus`
  - `type EnrollmentStatus = 'valid' | 'expired' | 'used' | 'unknown'`
  - `createEnrollmentToken(personId: string): Promise<{ raw: string }>`
  - `consumeEnrollmentToken(raw: string): Promise<{ personId: string } | null>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/enrollment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { enrollmentStatus } from '$lib/server/auth/enrollment';

const now = new Date('2026-08-14T12:00:00Z');
const later = new Date('2026-08-20T12:00:00Z');
const earlier = new Date('2026-08-10T12:00:00Z');

describe('enrollmentStatus', () => {
	it('is valid when unused and not yet expired', () => {
		expect(enrollmentStatus({ expiresAt: later, usedAt: null }, now)).toBe('valid');
	});

	it('is used once consumed, even if still within its window', () => {
		expect(enrollmentStatus({ expiresAt: later, usedAt: earlier }, now)).toBe('used');
	});

	it('is expired when the window has closed', () => {
		expect(enrollmentStatus({ expiresAt: earlier, usedAt: null }, now)).toBe('expired');
	});

	it('treats the exact expiry instant as expired, not valid', () => {
		expect(enrollmentStatus({ expiresAt: now, usedAt: null }, now)).toBe('expired');
	});

	it('is unknown when no row exists', () => {
		expect(enrollmentStatus(undefined, now)).toBe('unknown');
	});

	it('reports used before expired, so a consumed old token is not mislabelled', () => {
		expect(enrollmentStatus({ expiresAt: earlier, usedAt: earlier }, now)).toBe('used');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/enrollment.test.ts`
Expected: FAIL — cannot resolve `$lib/server/auth/enrollment`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/auth/enrollment.ts`:

```ts
// One-time enrollment links. A person created by an administrator has no
// password until they open their link and choose one, so the administrator
// never knows it. Only the hash is stored — the raw token is shown once, the
// same handling sessions and API tokens already use.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { enrollmentToken } from '$lib/server/db/schema';

const LIFETIME_DAYS = 7;

export type EnrollmentStatus = 'valid' | 'expired' | 'used' | 'unknown';

export interface EnrollmentRow {
	expiresAt: Date;
	usedAt: Date | null;
}

/**
 * Pure lifecycle decision, split out so it is testable without a database.
 * "used" outranks "expired": a consumed token is spent regardless of its
 * window. Callers must render every non-valid status identically — the
 * distinction is for logs, never for the visitor.
 */
export function enrollmentStatus(row: EnrollmentRow | undefined, now: Date): EnrollmentStatus {
	if (!row) return 'unknown';
	if (row.usedAt) return 'used';
	if (row.expiresAt <= now) return 'expired';
	return 'valid';
}

function hashToken(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}

export async function createEnrollmentToken(personId: string): Promise<{ raw: string }> {
	const raw = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);
	// One live link per person: reissuing invalidates the previous one.
	await db.delete(enrollmentToken).where(eq(enrollmentToken.personId, personId));
	await db.insert(enrollmentToken).values({ id: hashToken(raw), personId, expiresAt });
	return { raw };
}

/** Reads without consuming, for rendering the enrollment page. */
export async function lookupEnrollmentToken(
	raw: string
): Promise<{ personId: string; status: EnrollmentStatus }> {
	const rows = await db
		.select()
		.from(enrollmentToken)
		.where(eq(enrollmentToken.id, hashToken(raw)));
	const row = rows[0];
	return {
		personId: row?.personId ?? '',
		status: enrollmentStatus(row, new Date())
	};
}

/**
 * Marks the token used and returns its person, or null when it was not valid.
 * The update is conditional on usedAt still being null, so two simultaneous
 * submissions cannot both succeed.
 */
export async function consumeEnrollmentToken(raw: string): Promise<{ personId: string } | null> {
	const id = hashToken(raw);
	const updated = await db
		.update(enrollmentToken)
		.set({ usedAt: new Date() })
		.where(and(eq(enrollmentToken.id, id), isNull(enrollmentToken.usedAt)))
		.returning({ personId: enrollmentToken.personId, expiresAt: enrollmentToken.expiresAt });
	const row = updated[0];
	if (!row) return null;
	if (row.expiresAt <= new Date()) return null;
	return { personId: row.personId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/enrollment.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Checkpoint**

Run `npm run check` and `npm run lint`. Expected: 0 errors.

Ready for the owner to commit: `src/lib/server/auth/enrollment.ts`, `tests/unit/enrollment.test.ts`.

---

### Task 3: Permission policy, session role, deactivation checks

Extracts the permission guards as pure functions, teaches `validateSession` about deactivation, and adds `role` to the session person.

**Files:**

- Create: `src/lib/server/auth/policy.ts`
- Modify: `src/lib/server/auth/index.ts:16-18` (`verifyPassword` null guard), `:40-67` (`SessionPerson`, `validateSession`)
- Modify: `src/routes/login/+page.server.ts:13-19` (filter deactivated), `:35-40` (null hash)
- Modify: `src/app.d.ts` (the `locals.person` type, if declared there)
- Test: `tests/unit/auth-policy.test.ts`

**Interfaces:**

- Consumes: `person.role`, `person.deactivatedAt`, `person.passwordHash` from Task 1.
- Produces:
  - `type PersonRole = 'admin' | 'member'`
  - `interface PolicyPerson { id: string; role: PersonRole }`
  - `type PolicyResult = { ok: true } | { ok: false; reason: string }`
  - `canDeactivate(actor: PolicyPerson, target: PolicyPerson, activeAdminCount: number): PolicyResult`
  - `canChangeRole(actor: PolicyPerson, target: PolicyPerson, next: PersonRole, activeAdminCount: number): PolicyResult`
  - `requireAdmin(person: PolicyPerson | null): void` — throws a SvelteKit 403 `error`
  - `SessionPerson` gains `role: PersonRole`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canChangeRole, canDeactivate, requireAdmin } from '$lib/server/auth/policy';

const admin = { id: 'a', role: 'admin' as const };
const otherAdmin = { id: 'b', role: 'admin' as const };
const member = { id: 'c', role: 'member' as const };

describe('canDeactivate', () => {
	it('lets an admin deactivate a member', () => {
		expect(canDeactivate(admin, member, 1)).toEqual({ ok: true });
	});

	it('refuses a member acting on anyone', () => {
		expect(canDeactivate(member, admin, 2).ok).toBe(false);
	});

	it('refuses deactivating yourself', () => {
		expect(canDeactivate(admin, admin, 2).ok).toBe(false);
	});

	it('refuses deactivating the last admin', () => {
		expect(canDeactivate(admin, otherAdmin, 1).ok).toBe(false);
	});

	it('allows deactivating an admin while another remains', () => {
		expect(canDeactivate(admin, otherAdmin, 2)).toEqual({ ok: true });
	});
});

describe('canChangeRole', () => {
	it('lets an admin promote a member', () => {
		expect(canChangeRole(admin, member, 'admin', 1)).toEqual({ ok: true });
	});

	it('refuses a member changing any role', () => {
		expect(canChangeRole(member, member, 'admin', 1).ok).toBe(false);
	});

	it('refuses demoting the last admin', () => {
		expect(canChangeRole(admin, admin, 'member', 1).ok).toBe(false);
	});

	it('allows demoting yourself while another admin remains', () => {
		expect(canChangeRole(admin, admin, 'member', 2)).toEqual({ ok: true });
	});

	it('is a no-op success when the role is already what was asked for', () => {
		expect(canChangeRole(admin, member, 'member', 1)).toEqual({ ok: true });
	});
});

describe('requireAdmin', () => {
	it('passes an admin through', () => {
		expect(() => requireAdmin(admin)).not.toThrow();
	});

	it('throws for a member', () => {
		expect(() => requireAdmin(member)).toThrow();
	});

	it('throws for nobody signed in', () => {
		expect(() => requireAdmin(null)).toThrow();
	});

	it('throws a 403, not a 500 — this is a refusal, not a crash', () => {
		try {
			requireAdmin(member);
			expect.unreachable('requireAdmin should have thrown');
		} catch (err) {
			expect((err as { status: number }).status).toBe(403);
		}
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/auth-policy.test.ts`
Expected: FAIL — cannot resolve `$lib/server/auth/policy`.

- [ ] **Step 3: Write the policy module**

Create `src/lib/server/auth/policy.ts`:

```ts
// Permission rules, kept as pure functions so every guard is testable without
// a database and so the same rule cannot drift between two call sites.
//
// The invariant these protect: an instance always has at least one active
// administrator. Without it the only recovery is the documented database
// one-liner in the README.

import { error } from '@sveltejs/kit';

export type PersonRole = 'admin' | 'member';

export interface PolicyPerson {
	id: string;
	role: PersonRole;
}

export type PolicyResult = { ok: true } | { ok: false; reason: string };

const OK: PolicyResult = { ok: true };

function deny(reason: string): PolicyResult {
	return { ok: false, reason };
}

/**
 * `activeAdminCount` counts admins who are not already deactivated, including
 * the target when the target is an active admin.
 */
export function canDeactivate(
	actor: PolicyPerson,
	target: PolicyPerson,
	activeAdminCount: number
): PolicyResult {
	if (actor.role !== 'admin') return deny('Only an administrator can deactivate someone.');
	if (actor.id === target.id) return deny('You cannot deactivate your own account.');
	if (target.role === 'admin' && activeAdminCount <= 1) {
		return deny('This is the last administrator — promote someone else first.');
	}
	return OK;
}

export function canChangeRole(
	actor: PolicyPerson,
	target: PolicyPerson,
	next: PersonRole,
	activeAdminCount: number
): PolicyResult {
	if (actor.role !== 'admin') return deny('Only an administrator can change roles.');
	if (target.role === next) return OK;
	if (next === 'member' && target.role === 'admin' && activeAdminCount <= 1) {
		return deny('This is the last administrator — promote someone else first.');
	}
	return OK;
}

/** Throws 403 unless the person is an active administrator. */
export function requireAdmin(person: PolicyPerson | null): void {
	if (!person || person.role !== 'admin') {
		error(403, 'That action needs an administrator account.');
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/auth-policy.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Guard `verifyPassword` against a null hash**

In `src/lib/server/auth/index.ts`, replace `verifyPassword`:

```ts
export async function verifyPassword(
	passwordHash: string | null,
	password: string
): Promise<boolean> {
	// A person created by an administrator has no hash until they enrol. Argon2
	// would throw on null; returning false keeps "not yet enrolled" a plain
	// failed sign-in rather than a 500.
	if (!passwordHash) return false;
	return argonVerify(passwordHash, password);
}
```

- [ ] **Step 6: Add `role` to the session person and reject deactivated people**

In the same file, replace `SessionPerson` and the select inside `validateSession`:

```ts
export interface SessionPerson {
	id: string;
	name: string;
	initials: string;
	role: PersonRole;
}
```

Add `import type { PersonRole } from './policy';` at the top, add `role: person.role` and `deactivatedAt: person.deactivatedAt` to the selected columns, and after the existing expiry check insert:

```ts
// A person deactivated mid-session loses access on their next request.
if (row.deactivatedAt) {
	await db.delete(session).where(eq(session.id, row.sessionId));
	return null;
}
```

Then return `{ id: row.id, name: row.name, initials: row.initials, role: row.role }`.

- [ ] **Step 7: Keep deactivated people out of the sign-in picker**

In `src/routes/login/+page.server.ts`, change the `load` to filter them out:

```ts
import { asc, eq, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	const people = await db
		.select({ id: person.id, name: person.name, initials: person.initials })
		.from(person)
		// Deactivated people would otherwise sit in the picker failing every
		// attempt, which reads as a broken password rather than a closed account.
		.where(isNull(person.deactivatedAt))
		.orderBy(asc(person.createdAt));
	return { people };
};
```

- [ ] **Step 8: Reject deactivated people in the password sign-in action**

In the same file's action, after the existing row lookup, before `createSession`:

```ts
if (!row || row.deactivatedAt || !(await verifyPassword(row.passwordHash, password))) {
	recordLoginFailure(address);
	return fail(400, { message: 'Wrong person or password.' });
}
```

This replaces the existing `if (!row || !(await verifyPassword(...)))` condition. The message is deliberately unchanged: a deactivated account must not be distinguishable from a wrong password.

- [ ] **Step 9: Update the `locals.person` type**

Find where `App.Locals` declares `person` (search `src/app.d.ts` for `person`). It must reference `SessionPerson` from `$lib/server/auth` so the new `role` field flows through. If it inlines the shape, replace it with the imported type.

- [ ] **Step 10: Verify**

Run: `npm run check` — expected 0 errors, including the errors Task 1 recorded.
Run: `npm run test:unit` — expected all pass.

- [ ] **Step 11: Checkpoint**

Run `npm run test:e2e`. The existing password sign-in journeys must pass unchanged — this is the regression gate for the whole plan.

Ready for the owner to commit: `src/lib/server/auth/policy.ts`, `src/lib/server/auth/index.ts`, `src/routes/login/+page.server.ts`, `src/app.d.ts`, `tests/unit/auth-policy.test.ts`.

---

### Task 4: Change your own password

The smallest user-facing gap, and it exercises the session-revocation code the later tasks rely on.

**Files:**

- Create: `src/lib/server/auth/password.ts`
- Modify: `src/routes/(app)/settings/+page.server.ts` (new `changePassword` action)
- Modify: `src/routes/(app)/settings/+page.svelte` (form)
- Test: covered by the Task 7 end-to-end journey; the logic here is two database calls with no branching worth a unit test

**Interfaces:**

- Consumes: `verifyPassword`, `hashPassword` from `$lib/server/auth`; `session` table.
- Produces: `changeOwnPassword(personId, current, next): Promise<{ ok: true } | { ok: false; message: string }>`, `revokeOtherSessions(personId, keepSessionId)`.

- [ ] **Step 1: Write the implementation**

Create `src/lib/server/auth/password.ts`:

```ts
// Changing your own password. Every other session is revoked on success —
// changing a password after a scare should actually eject the other device,
// which is the entire point of changing it.

import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, session } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from './index';

const MIN_LENGTH = 8;

export async function revokeOtherSessions(personId: string, keepSessionId: string): Promise<void> {
	await db
		.delete(session)
		.where(and(eq(session.personId, personId), ne(session.id, keepSessionId)));
}

export async function changeOwnPassword(
	personId: string,
	current: string,
	next: string
): Promise<{ ok: true } | { ok: false; message: string }> {
	if (next.length < MIN_LENGTH) {
		return { ok: false, message: `New password needs at least ${MIN_LENGTH} characters.` };
	}
	const rows = await db
		.select({ passwordHash: person.passwordHash })
		.from(person)
		.where(eq(person.id, personId));
	const row = rows[0];
	if (!row || !(await verifyPassword(row.passwordHash, current))) {
		return { ok: false, message: 'Current password is wrong.' };
	}
	await db
		.update(person)
		.set({ passwordHash: await hashPassword(next) })
		.where(eq(person.id, personId));
	return { ok: true };
}
```

- [ ] **Step 2: Expose the current session id**

`revokeOtherSessions` needs the id of the session to keep. `validateSession` in `src/lib/server/auth/index.ts` already computes it as `hashToken(token)`. Export a helper from that file:

```ts
/** The current session's row id, or null when there is no session cookie. */
export function currentSessionId(cookies: Cookies): string | null {
	const token = cookies.get(SESSION_COOKIE);
	return token ? hashToken(token) : null;
}
```

- [ ] **Step 3: Add the settings action**

In `src/routes/(app)/settings/+page.server.ts`, add to `actions`:

```ts
	changePassword: async ({ request, cookies, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const current = String(form.get('currentPassword') ?? '');
		const next = String(form.get('newPassword') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		if (next !== confirm) return fail(400, { message: 'The two new passwords do not match.' });

		const result = await changeOwnPassword(locals.person.id, current, next);
		if (!result.ok) return fail(400, { message: result.message });

		const keep = currentSessionId(cookies);
		if (keep) await revokeOtherSessions(locals.person.id, keep);
		return { ok: true };
	},
```

Import `changeOwnPassword` and `revokeOtherSessions` from `$lib/server/auth/password`, and `currentSessionId` from `$lib/server/auth`.

- [ ] **Step 4: Add the form**

In `src/routes/(app)/settings/+page.svelte`, inside the people section, add a form for the signed-in person. Match the existing markup conventions in that file — reuse the same input and button classes the neighbouring `add-form` uses rather than inventing new ones:

```svelte
<form method="POST" action="?/changePassword" use:enhance class="add-form">
	<input name="currentPassword" type="password" placeholder="Current password" required />
	<input name="newPassword" type="password" placeholder="New password (8+ characters)" required />
	<input name="confirmPassword" type="password" placeholder="Repeat new password" required />
	<button type="submit">Change password</button>
</form>
```

- [ ] **Step 5: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors.

Manually: `npm run dev`, sign in, change your password, sign out, sign in with the new password.

- [ ] **Step 6: Checkpoint**

Ready for the owner to commit: `src/lib/server/auth/password.ts`, `src/lib/server/auth/index.ts`, `src/routes/(app)/settings/+page.server.ts`, `src/routes/(app)/settings/+page.svelte`.

---

### Task 5: People management component and admin-gated actions

Moves the people section out of the settings page, which already carries module toggles, backup and currency settings, and adds the administrator-only actions.

**Files:**

- Create: `src/lib/components/PeopleSettings.svelte`
- Modify: `src/routes/(app)/settings/+page.server.ts` (rewrite `addPerson`, add `deactivatePerson`, `reactivatePerson`, `changePersonRole`, `reissueEnrollment`; extend `load`)
- Modify: `src/routes/(app)/settings/+page.svelte:83-101` (replace the inline people markup with the component)

**Interfaces:**

- Consumes: `requireAdmin`, `canDeactivate`, `canChangeRole` from Task 3; `createEnrollmentToken` from Task 2.
- Produces: `load` returns `people` as `{ id, name, initials, role, birthYear, deactivatedAt, pending }[]`, where `pending` is `passwordHash === null`; and `enrollmentLink: string | null` returned by the actions that mint one.

- [ ] **Step 1: Extend the `load` to carry the new columns and the signed-in person**

First, the signed-in person is not currently available to this page — `(app)/+layout.server.ts` does not return it and neither does this `load`. Change the signature to `async ({ locals })` and add to the returned object:

```ts
		// The component needs to know who you are to decide which controls are
		// yours and whether you may administer anyone.
		me: locals.person,
```

Then the people select at lines 30-37 gains the new fields:

```ts
			people: await db
				.select({
					id: person.id,
					name: person.name,
					initials: person.initials,
					role: person.role,
					birthYear: person.birthYear,
					deactivatedAt: person.deactivatedAt,
					// Created but never enrolled: no password chosen yet.
					pending: sql<boolean>`${person.passwordHash} is null`
				})
				.from(person)
				.orderBy(person.createdAt),
```

Import `sql` from `drizzle-orm`.

- [ ] **Step 2: Add a helper for the active-admin count**

The policy functions need it. Add near the top of the same file:

```ts
async function activeAdminCount(): Promise<number> {
	const rows = await db
		.select({ id: person.id })
		.from(person)
		.where(and(eq(person.role, 'admin'), isNull(person.deactivatedAt)));
	return rows.length;
}
```

Import `and`, `eq`, `isNull` from `drizzle-orm`.

- [ ] **Step 3: Rewrite `addPerson` to mint an enrollment link**

Replace the existing `addPerson` action (lines 122-142) entirely:

```ts
	addPerson: async ({ request, locals, url }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const birthYear = String(form.get('birthYear') ?? '').trim();
		const role = form.get('role') === 'admin' ? 'admin' : 'member';
		if (!name) return fail(400, { message: 'A person needs a name.' });

		const id = randomUUID();
		await db.insert(person).values({
			id,
			name,
			initials: name
				.split(/\s+/)
				.map((w) => w[0] ?? '')
				.join('')
				.slice(0, 2)
				.toUpperCase(),
			role,
			birthYear: birthYear ? Number(birthYear) : null,
			// No password: they choose their own through the enrollment link, so
			// the administrator creating them never knows it.
			passwordHash: null
		});

		const { raw } = await createEnrollmentToken(id);
		return { ok: true, enrollmentLink: `${url.origin}/enroll/${raw}` };
	},
```

- [ ] **Step 4: Add the remaining administrator actions**

```ts
	reissueEnrollment: async ({ request, locals, url }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const { raw } = await createEnrollmentToken(personId);
		return { ok: true, enrollmentLink: `${url.origin}/enroll/${raw}` };
	},

	deactivatePerson: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const rows = await db
			.select({ id: person.id, role: person.role })
			.from(person)
			.where(eq(person.id, personId));
		const target = rows[0];
		if (!target) return fail(404, { message: 'No such person.' });

		const verdict = canDeactivate(locals.person!, target, await activeAdminCount());
		if (!verdict.ok) return fail(400, { message: verdict.reason });

		await db.update(person).set({ deactivatedAt: new Date() }).where(eq(person.id, personId));
		// Credentials and the password hash are left intact so reactivation is a
		// clean undo; only live sessions are cut.
		await db.delete(session).where(eq(session.personId, personId));
		return { ok: true };
	},

	reactivatePerson: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		await db.update(person).set({ deactivatedAt: null }).where(eq(person.id, personId));
		return { ok: true };
	},

	changePersonRole: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const next = form.get('role') === 'admin' ? 'admin' : 'member';
		const rows = await db
			.select({ id: person.id, role: person.role })
			.from(person)
			.where(eq(person.id, personId));
		const target = rows[0];
		if (!target) return fail(404, { message: 'No such person.' });

		const verdict = canChangeRole(locals.person!, target, next, await activeAdminCount());
		if (!verdict.ok) return fail(400, { message: verdict.reason });

		await db.update(person).set({ role: next }).where(eq(person.id, personId));
		return { ok: true };
	},
```

Import `session` from the schema, `requireAdmin`, `canDeactivate`, `canChangeRole` from `$lib/server/auth/policy`, and `createEnrollmentToken` from `$lib/server/auth/enrollment`.

- [ ] **Step 5: Gate the existing API-token actions**

Find the API-token actions already in this file and add `requireAdmin(locals.person);` as their first line, adding `locals` to their destructured parameters. Do not change module toggles, currency or backup actions — those stay open to any member.

- [ ] **Step 6: Create the component**

Create `src/lib/components/PeopleSettings.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';

	interface PersonRow {
		id: string;
		name: string;
		initials: string;
		role: 'admin' | 'member';
		birthYear: number | null;
		deactivatedAt: Date | null;
		pending: boolean;
	}

	let {
		people,
		me,
		enrollmentLink = null
	}: {
		people: PersonRow[];
		me: { id: string; role: 'admin' | 'member' };
		enrollmentLink?: string | null;
	} = $props();

	let adding = $state(false);
	const isAdmin = $derived(me.role === 'admin');

	function note(p: PersonRow): string {
		const bits = [p.role];
		if (p.birthYear) bits.push(`born ${p.birthYear}`);
		if (p.pending) bits.push('not enrolled yet');
		if (p.deactivatedAt) bits.push('deactivated');
		return bits.join(' · ');
	}
</script>

<div class="card people">
	{#each people as p (p.id)}
		<div class="person-row" class:dimmed={p.deactivatedAt}>
			<span class="avatar">{p.initials}</span>
			<span class="mod-label">
				<span>{p.name}</span>
				<span class="note">{note(p)}</span>
			</span>

			{#if isAdmin && p.id !== me.id}
				<span class="row-actions">
					{#if p.pending}
						<form method="POST" action="?/reissueEnrollment" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">New link</button>
						</form>
					{/if}
					<form method="POST" action="?/changePersonRole" use:enhance>
						<input type="hidden" name="personId" value={p.id} />
						<input type="hidden" name="role" value={p.role === 'admin' ? 'member' : 'admin'} />
						<button type="submit" class="btn">
							{p.role === 'admin' ? 'Make member' : 'Make admin'}
						</button>
					</form>
					{#if p.deactivatedAt}
						<form method="POST" action="?/reactivatePerson" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">Reactivate</button>
						</form>
					{:else}
						<form method="POST" action="?/deactivatePerson" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">Deactivate</button>
						</form>
					{/if}
				</span>
			{/if}
		</div>
	{/each}

	{#if enrollmentLink}
		<p class="note">Send this link to the new person — it is shown once and lasts seven days.</p>
		<code class="reveal">{enrollmentLink}</code>
	{/if}

	{#if isAdmin}
		{#if adding}
			<form method="POST" action="?/addPerson" use:enhance class="add-form">
				<input name="name" placeholder="Name" />
				<input name="birthYear" placeholder="Birth year" inputmode="numeric" />
				<select name="role">
					<option value="member">Member</option>
					<option value="admin">Administrator</option>
				</select>
				<button type="submit" class="btn">Add</button>
			</form>
		{:else}
			<button type="button" class="btn" onclick={() => (adding = true)}>➕ Add a person</button>
		{/if}
	{/if}
</div>

<style>
	.person-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.person-row.dimmed {
		opacity: 0.55;
	}
	.row-actions {
		margin-left: auto;
		display: flex;
		gap: 6px;
	}
	.reveal {
		display: block;
		word-break: break-all;
		font-size: 12px;
		padding: 9px 11px;
		border: 1px solid var(--bd2);
		border-radius: 8px;
		background: var(--card2);
	}
</style>
```

There is no password field: the new person chooses their own through the enrollment link.

Move the remaining `.person-row` rules from `settings/+page.svelte:346-360` into this component's `<style>` block, merging them with the rule above, and delete them from the page. Check the `.reveal` presentation against how the existing API-token section shows its one-time token and reuse that class instead if one already exists.

- [ ] **Step 7: Swap the component into the settings page**

Replace the people markup at `src/routes/(app)/settings/+page.svelte:81-104` — the whole `<div class="card people">` block, keeping the surrounding `<section>` and its `<Eyebrow>` — with:

```svelte
<PeopleSettings people={data.people} me={data.me} enrollmentLink={form?.enrollmentLink ?? null} />
```

and import the component. `data.me` is what Step 1 added; there is no `data.person`.

- [ ] **Step 8: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors.

Manually with `npm run dev`: add a person and confirm a link appears; deactivate someone and confirm they leave the sign-in picker; confirm you cannot deactivate yourself or the last administrator.

- [ ] **Step 9: Checkpoint**

Ready for the owner to commit: `src/lib/components/PeopleSettings.svelte`, `src/routes/(app)/settings/+page.server.ts`, `src/routes/(app)/settings/+page.svelte`.

---

### Task 6: The enrollment page

**Files:**

- Create: `src/routes/enroll/[token]/+page.server.ts`
- Create: `src/routes/enroll/[token]/+page.svelte`
- Modify: `src/hooks.server.ts:57` (`PUBLIC_PATHS`)

**Interfaces:**

- Consumes: `lookupEnrollmentToken`, `consumeEnrollmentToken` from Task 2; `hashPassword`, `createSession` from `$lib/server/auth`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Make the route public**

In `src/hooks.server.ts`, extend the constant and its comment:

```ts
// /ics/<token> is public by design: calendar apps subscribe without a session,
// authenticated by the secret token in the URL. /api authenticates itself the
// same way, with a bearer token instead of a cookie. /enroll/<token> is the
// same shape again — the visitor has no session yet, and the token in the URL
// is what authorises them to set a password.
//
// This exempts them from the redirect to /login, NOT from authentication —
// every /api route calls requireToken itself, and one that forgets to would be
// wide open. The E2E journey asserts an unauthenticated request gets a 401.
const PUBLIC_PATHS = ['/login', '/setup', '/ics', '/api', '/enroll'];
```

- [ ] **Step 2: Write the page server**

Create `src/routes/enroll/[token]/+page.server.ts`:

```ts
import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { consumeEnrollmentToken, lookupEnrollmentToken } from '$lib/server/auth/enrollment';
import {
	loginBlockedForSeconds,
	recordLoginFailure,
	recordLoginSuccess
} from '$lib/server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

// Every unusable token reads the same to the visitor. Distinguishing "expired"
// from "never existed" would confirm whether a guessed token was ever real.
const UNUSABLE = 'This link is not valid. Ask whoever invited you for a new one.';

export const load: PageServerLoad = async ({ params }) => {
	const { personId, status } = await lookupEnrollmentToken(params.token);
	if (status !== 'valid') return { valid: false as const, name: '' };
	const rows = await db.select({ name: person.name }).from(person).where(eq(person.id, personId));
	return { valid: true as const, name: rows[0]?.name ?? '' };
};

export const actions: Actions = {
	default: async ({ request, cookies, params, getClientAddress }) => {
		const address = getClientAddress();
		const wait = loginBlockedForSeconds(address);
		if (wait > 0) {
			return fail(429, {
				message: `Too many attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		if (password.length < 8) {
			return fail(400, { message: 'Password needs at least 8 characters.' });
		}
		if (password !== confirm) {
			return fail(400, { message: 'The two passwords do not match.' });
		}

		const consumed = await consumeEnrollmentToken(params.token);
		if (!consumed) {
			recordLoginFailure(address);
			return fail(400, { message: UNUSABLE });
		}

		recordLoginSuccess(address);
		await db
			.update(person)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(person.id, consumed.personId));
		await createSession(cookies, consumed.personId);
		redirect(303, '/overview');
	}
};
```

- [ ] **Step 3: Write the page**

Create `src/routes/enroll/[token]/+page.svelte`. It mirrors the sign-in page's shell, since both sit outside the app layout:

```svelte
<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Continuum — set your password</title></svelte:head>

<div class="wrap">
	<div class="brand">
		<BrandMark size={26} />
		<span class="wordmark">Continuum</span>
	</div>

	{#if form?.message}
		<div class="error">{form.message}</div>
	{/if}

	{#if data.valid}
		<form method="POST" class="card form">
			<p class="lead">Welcome, {data.name}. Choose a password to finish setting up your account.</p>
			<input
				name="password"
				type="password"
				placeholder="Password (8+ characters)"
				autocomplete="new-password"
			/>
			<input
				name="confirmPassword"
				type="password"
				placeholder="Repeat password"
				autocomplete="new-password"
			/>
			<button type="submit" class="btn btn-primary">Set password</button>
		</form>
	{:else}
		<div class="error">This link is not valid. Ask whoever invited you for a new one.</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 380px;
		margin: 0 auto;
		padding: 90px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.wordmark {
		font-size: 15.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
	}
	.lead {
		font-size: 13.5px;
		color: var(--fg2);
		margin: 0;
	}
	input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 9px 11px;
		font-size: 13.5px;
	}
</style>
```

Note the invalid-link message is duplicated here as literal text rather than imported from the server module — server constants do not cross into the browser bundle. Keep the two strings identical.

- [ ] **Step 4: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors.

Manually: add a person in Settings, open the link in a private window, set a password, confirm you land on `/overview` signed in as that person, then reload the link and confirm it now reads as unusable.

- [ ] **Step 5: Checkpoint**

Ready for the owner to commit: `src/routes/enroll/[token]/+page.server.ts`, `src/routes/enroll/[token]/+page.svelte`, `src/hooks.server.ts`.

---

### Task 7: Phase 1 end-to-end journey

**Files:**

- Create: `tests/e2e/accounts.spec.ts`

**Interfaces:**

- Consumes: everything in Tasks 1-6.
- Produces: nothing.

- [ ] **Step 1: Write the journey**

Create `tests/e2e/accounts.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// One ordered journey through account management: invite → enrol → deactivate.
// Auth is carried via the storage state the main flow spec saved, matching the
// convention in tests/e2e/flow.spec.ts.

const AUTH_STATE = 'test-results/e2e-auth.json';

test.describe.configure({ mode: 'serial' });

let enrollmentLink = '';

test.describe('as the administrator', () => {
	test.use({ storageState: AUTH_STATE });

	test('adding a person reveals a one-time enrollment link', async ({ page }) => {
		await page.goto('/settings');
		await page.getByRole('button', { name: '➕ Add a person' }).click();
		await page.getByPlaceholder('Name').fill('Tomáš Dvořák');
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const link = page.locator('code');
		await expect(link).toContainText('/enroll/');
		enrollmentLink = (await link.innerText()).trim();
	});

	test('the new person shows as not yet enrolled', async ({ page }) => {
		await page.goto('/settings');
		await expect(page.getByText('not enrolled yet')).toBeVisible();
	});
});

test('the enrollment link sets a password and signs the person in', async ({ browser }) => {
	// A fresh context: the new person is not the administrator.
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(enrollmentLink);
	await expect(page.getByText('Welcome, Tomáš Dvořák')).toBeVisible();
	await page.getByPlaceholder('Password (8+ characters)').fill('parallel-anchor-tin');
	await page.getByPlaceholder('Repeat password').fill('parallel-anchor-tin');
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page).toHaveURL(/\/overview/);
	await context.close();
});

test('the same link cannot be used twice', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(enrollmentLink);
	await expect(page.getByText('This link is not valid')).toBeVisible();
	await context.close();
});

test.describe('deactivation', () => {
	test.use({ storageState: AUTH_STATE });

	test('an administrator cannot deactivate themselves', async ({ page }) => {
		await page.goto('/settings');
		// The guard is enforced server-side; the control is not even rendered for
		// your own row, which is the first line of defence.
		const ownRow = page.locator('.person-row', { hasText: 'Jana Nováková' });
		await expect(ownRow.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
	});

	test('deactivating a person removes them from the sign-in picker', async ({ page }) => {
		await page.goto('/settings');
		const row = page.locator('.person-row', { hasText: 'Tomáš Dvořák' });
		await row.getByRole('button', { name: 'Deactivate' }).click();
		await expect(page.getByText('deactivated')).toBeVisible();
	});

	test('the deactivated person is gone from /login', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto('/login');
		await expect(page.getByText('Jana Nováková')).toBeVisible();
		await expect(page.getByText('Tomáš Dvořák')).toHaveCount(0);
		await context.close();
	});
});
```

The person name `Jana Nováková` comes from the wizard journey in `flow.spec.ts:23`. If that fixture name has changed, update it here to match rather than inventing a new one.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e`
Expected: the new journey passes and every existing test still passes.

- [ ] **Step 3: Checkpoint**

Phase 1 is complete and shippable on the current plain-HTTP deployment.

Ready for the owner to commit: `tests/e2e/accounts.spec.ts`.

---

# Phase 2 — Tailscale and passkeys

Phase 2 depends on Phase 1's schema and policy work. It changes how the instance is reached, so the deployment step is sequenced last and deliberately non-destructive.

---

### Task 8: Dependencies, origin classification, relying-party derivation

**Files:**

- Modify: `package.json`
- Create: `src/lib/server/auth/webauthn/origin.ts`
- Test: `tests/unit/webauthn-origin.test.ts`

**Interfaces:**

- Consumes: `env.ORIGIN`.
- Produces:
  - `isSecureOrigin(origin: string): boolean`
  - `relyingPartyId(origin: string): string`
  - `passkeysAvailable(): boolean` — reads `env.ORIGIN`

- [ ] **Step 1: Install the dependencies**

Run: `npm install @simplewebauthn/server @simplewebauthn/browser`

Record the installed major version. The API shape below assumes v13; if a different major installs, check the shape of `verifyRegistrationResponse`'s `registrationInfo` before Task 10, because it changed between majors.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/webauthn-origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSecureOrigin, relyingPartyId } from '$lib/server/auth/webauthn/origin';

describe('isSecureOrigin', () => {
	it('accepts https', () => {
		expect(isSecureOrigin('https://continuum.tail1234.ts.net')).toBe(true);
	});

	it('accepts http on localhost, so dev and E2E can exercise passkeys', () => {
		expect(isSecureOrigin('http://localhost')).toBe(true);
		expect(isSecureOrigin('http://localhost:5173')).toBe(true);
		expect(isSecureOrigin('http://127.0.0.1:4173')).toBe(true);
	});

	it('rejects http on a LAN name — the browser would refuse WebAuthn there', () => {
		expect(isSecureOrigin('http://continuum.local')).toBe(false);
	});

	it('rejects nonsense rather than throwing', () => {
		expect(isSecureOrigin('')).toBe(false);
		expect(isSecureOrigin('not a url')).toBe(false);
	});
});

describe('relyingPartyId', () => {
	it('is the hostname, without scheme or port', () => {
		expect(relyingPartyId('https://continuum.tail1234.ts.net')).toBe('continuum.tail1234.ts.net');
		expect(relyingPartyId('http://localhost:5173')).toBe('localhost');
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/webauthn-origin.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 4: Write the implementation**

Create `src/lib/server/auth/webauthn/origin.ts`:

```ts
// WebAuthn refuses to run outside a secure context, and the relying-party ID
// must match the origin exactly. Deriving the ID from ORIGIN rather than
// configuring it separately makes the classic mismatch impossible.

import { env } from '$env/dynamic/private';

export function isSecureOrigin(origin: string): boolean {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol === 'https:') return true;
	// Browsers treat loopback as a secure context, which is what keeps
	// `npm run dev` and the E2E suite able to exercise passkeys over plain HTTP.
	return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

export function relyingPartyId(origin: string): string {
	return new URL(origin).hostname;
}

/**
 * `env.ORIGIN` is `string | undefined`, and every WebAuthn call needs a definite
 * string. Narrowing here once keeps the null handling out of four endpoints.
 */
export function currentOrigin(): string {
	return env.ORIGIN ?? '';
}

/** False on a plain-HTTP LAN deployment, where the passkey UI must be absent. */
export function passkeysAvailable(): boolean {
	return isSecureOrigin(currentOrigin());
}
```

Every endpoint in Tasks 10 and 11 uses `currentOrigin()` in place of `env.ORIGIN`, for both `expectedOrigin` and the argument to `relyingPartyId`. Passing `env.ORIGIN` directly is a type error.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/webauthn-origin.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Checkpoint**

Run `npm run check` and `npm run lint`.

Ready for the owner to commit: `package.json`, `package-lock.json`, `src/lib/server/auth/webauthn/origin.ts`, `tests/unit/webauthn-origin.test.ts`.

---

### Task 9: Credential table, challenge cookie, counter rule

**Files:**

- Modify: `src/lib/server/db/schema.ts` (new `credential` table)
- Create: `drizzle/0019_*.sql` (generated)
- Create: `src/lib/server/auth/webauthn/challenge.ts`
- Create: `src/lib/server/auth/webauthn/counter.ts`
- Test: `tests/unit/webauthn-counter.test.ts`

**Interfaces:**

- Consumes: `person` table.
- Produces:
  - `credential` table export
  - `storeChallenge(cookies, challenge)`, `takeChallenge(cookies): string | null`
  - `isCloneSignal(stored: number, incoming: number): boolean`

- [ ] **Step 1: Write the failing counter test**

Create `tests/unit/webauthn-counter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isCloneSignal } from '$lib/server/auth/webauthn/counter';

describe('isCloneSignal', () => {
	it('does not flag synced passkeys, which always report zero', () => {
		// iCloud Keychain and most platform authenticators never increment.
		// A naive `incoming > stored` check rejects every Apple passkey on its
		// second use — this is the regression this test exists to prevent.
		expect(isCloneSignal(0, 0)).toBe(false);
	});

	it('does not flag an authenticator that starts reporting', () => {
		expect(isCloneSignal(0, 5)).toBe(false);
	});

	it('does not flag an authenticator that stops reporting', () => {
		expect(isCloneSignal(5, 0)).toBe(false);
	});

	it('accepts a counter that advanced', () => {
		expect(isCloneSignal(5, 6)).toBe(false);
	});

	it('flags a counter that repeated', () => {
		expect(isCloneSignal(5, 5)).toBe(true);
	});

	it('flags a counter that went backwards', () => {
		expect(isCloneSignal(5, 4)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/webauthn-counter.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the counter rule**

Create `src/lib/server/auth/webauthn/counter.ts`:

```ts
// Signature counters detect cloned authenticators — but only some hardware
// reports them. Synced passkeys (iCloud Keychain, and most platform
// authenticators) always send 0, so a clone is detectable only when both the
// stored and the incoming value are non-zero.

export function isCloneSignal(stored: number, incoming: number): boolean {
	if (stored === 0 || incoming === 0) return false;
	return incoming <= stored;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/webauthn-counter.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the `credential` table**

In `src/lib/server/db/schema.ts`, after `enrollmentToken`:

```ts
// A registered passkey. The public key is public by construction — the private
// half never leaves the authenticator, which is the whole point.
export const credential = pgTable('credential', {
	// base64url credential ID as the authenticator reports it
	id: text('id').primaryKey(),
	personId: text('person_id')
		.notNull()
		.references(() => person.id, { onDelete: 'cascade' }),
	publicKey: text('public_key').notNull(),
	// See webauthn/counter.ts: 0 means "not reported", not "never used".
	counter: bigint('counter', { mode: 'number' }).notNull().default(0),
	transports: jsonb('transports').$type<string[]>().notNull().default([]),
	label: text('label').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true })
});
```

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0019_<name>.sql` creating `credential`. No hand-editing needed — there is no data to carry.

- [ ] **Step 7: Write the challenge store**

Create `src/lib/server/auth/webauthn/challenge.ts`:

```ts
// WebAuthn challenges are per-browser and live for a moment, so they go in an
// httpOnly cookie rather than a table that would need a cleanup job. The
// cookie is read once and cleared, so a challenge cannot be replayed.

import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const CHALLENGE_COOKIE = 'continuum_webauthn_challenge';
const TTL_SECONDS = 5 * 60;

export function storeChallenge(cookies: Cookies, challenge: string): void {
	cookies.set(CHALLENGE_COOKIE, challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: (env.ORIGIN ?? '').startsWith('https://'),
		maxAge: TTL_SECONDS
	});
}

/** Reads and clears in one step — a challenge is good for exactly one attempt. */
export function takeChallenge(cookies: Cookies): string | null {
	const value = cookies.get(CHALLENGE_COOKIE) ?? null;
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	return value;
}
```

- [ ] **Step 8: Verify**

Run: `npm run check`, `npm run lint`, `npm run test:unit`. Expected: 0 errors, all tests pass.

- [ ] **Step 9: Checkpoint**

Ready for the owner to commit: `src/lib/server/db/schema.ts`, `drizzle/0019_*.sql`, `drizzle/meta/*`, `src/lib/server/auth/webauthn/challenge.ts`, `src/lib/server/auth/webauthn/counter.ts`, `tests/unit/webauthn-counter.test.ts`.

---

### Task 10: Passkey registration endpoints

**Files:**

- Create: `src/routes/auth/passkey/register/options/+server.ts`
- Create: `src/routes/auth/passkey/register/verify/+server.ts`

**Interfaces:**

- Consumes: `passkeysAvailable`, `relyingPartyId` (Task 8); `storeChallenge`, `takeChallenge`, `credential` (Task 9).
- Produces: two POST endpoints returning JSON, both requiring a session.

- [ ] **Step 1: Write the options endpoint**

Create `src/routes/auth/passkey/register/options/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential } from '$lib/server/db/schema';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const existing = await db
		.select({ id: credential.id, transports: credential.transports })
		.from(credential)
		.where(eq(credential.personId, locals.person.id));

	const options = await generateRegistrationOptions({
		rpName: 'Continuum',
		rpID: relyingPartyId(currentOrigin()),
		userName: locals.person.name,
		userID: new TextEncoder().encode(locals.person.id),
		// No reason for a household ledger to identify authenticator models.
		attestationType: 'none',
		// Discoverable, so the sign-in screen can skip the person picker.
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		// Stops one device silently registering itself twice.
		excludeCredentials: existing.map((c) => ({
			id: c.id,
			transports: c.transports as AuthenticatorTransportFuture[]
		}))
	});

	storeChallenge(cookies, options.challenge);
	return json(options);
};
```

Import `AuthenticatorTransportFuture` as a type from `@simplewebauthn/server`. If the installed major is not v13, check whether `userID` takes a string rather than a `Uint8Array`.

- [ ] **Step 2: Write the verify endpoint**

Create `src/routes/auth/passkey/register/verify/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential } from '$lib/server/db/schema';
import { takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const expectedChallenge = takeChallenge(cookies);
	if (!expectedChallenge) error(400, 'That took too long — try again.');

	const body = await request.json();
	const verification = await verifyRegistrationResponse({
		response: body.response,
		expectedChallenge,
		expectedOrigin: currentOrigin(),
		expectedRPID: relyingPartyId(currentOrigin())
	});

	if (!verification.verified || !verification.registrationInfo) {
		error(400, 'That passkey could not be verified.');
	}

	const info = verification.registrationInfo.credential;
	await db.insert(credential).values({
		id: info.id,
		personId: locals.person.id,
		publicKey: Buffer.from(info.publicKey).toString('base64url'),
		counter: info.counter,
		transports: info.transports ?? [],
		label: String(body.label ?? '').trim() || 'Passkey'
	});

	return json({ ok: true });
};
```

- [ ] **Step 3: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors. Behaviour is exercised by Task 14's end-to-end test, since these endpoints cannot be meaningfully unit tested without a real authenticator.

- [ ] **Step 4: Checkpoint**

Ready for the owner to commit: both new `+server.ts` files.

---

### Task 11: Passkey sign-in endpoints

**Files:**

- Create: `src/routes/auth/passkey/login/options/+server.ts`
- Create: `src/routes/auth/passkey/login/verify/+server.ts`
- Modify: `src/hooks.server.ts` (`PUBLIC_PATHS`)

**Interfaces:**

- Consumes: `isCloneSignal` (Task 9); `createSession` (`$lib/server/auth`); `credential`, `person`.
- Produces: two public POST endpoints.

- [ ] **Step 1: Make the sign-in endpoints public**

In `src/hooks.server.ts`, extend `PUBLIC_PATHS` to `['/login', '/setup', '/ics', '/api', '/enroll', '/auth/passkey/login']`. Note the prefix is the sign-in path specifically — the registration endpoints under `/auth/passkey/register` must stay behind a session.

- [ ] **Step 2: Write the options endpoint**

Create `src/routes/auth/passkey/login/options/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const options = await generateAuthenticationOptions({
		rpID: relyingPartyId(currentOrigin()),
		// Empty: credentials are discoverable, so the authenticator tells us who
		// the person is via the user handle. That is what removes the picker.
		allowCredentials: [],
		userVerification: 'preferred'
	});

	storeChallenge(cookies, options.challenge);
	return json(options);
};
```

- [ ] **Step 3: Write the verify endpoint**

Create `src/routes/auth/passkey/login/verify/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential, person } from '$lib/server/db/schema';
import { createSession } from '$lib/server/auth';
import { takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { isCloneSignal } from '$lib/server/auth/webauthn/counter';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import { recordLoginFailure, recordLoginSuccess } from '$lib/server/auth/ratelimit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, request, getClientAddress }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const expectedChallenge = takeChallenge(cookies);
	if (!expectedChallenge) error(400, 'That took too long — try again.');

	const body = await request.json();
	const rows = await db
		.select({
			id: credential.id,
			publicKey: credential.publicKey,
			counter: credential.counter,
			personId: credential.personId,
			deactivatedAt: person.deactivatedAt
		})
		.from(credential)
		.innerJoin(person, eq(credential.personId, person.id))
		.where(eq(credential.id, body.response.id));

	const row = rows[0];
	// A deactivated person's credentials are kept so reactivation is a clean
	// undo, so the check has to happen here rather than by deleting them.
	if (!row || row.deactivatedAt) {
		recordLoginFailure(getClientAddress());
		error(400, 'That passkey is not recognised.');
	}

	const verification = await verifyAuthenticationResponse({
		response: body.response,
		expectedChallenge,
		expectedOrigin: currentOrigin(),
		expectedRPID: relyingPartyId(currentOrigin()),
		credential: {
			id: row.id,
			publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')),
			counter: row.counter
		}
	});

	if (!verification.verified) {
		recordLoginFailure(getClientAddress());
		error(400, 'That passkey could not be verified.');
	}

	const incoming = verification.authenticationInfo.newCounter;
	if (isCloneSignal(row.counter, incoming)) {
		recordLoginFailure(getClientAddress());
		error(400, 'That passkey looks cloned and has been refused.');
	}

	await db
		.update(credential)
		.set({ counter: incoming, lastUsedAt: new Date() })
		.where(eq(credential.id, row.id));

	recordLoginSuccess(getClientAddress());
	await createSession(cookies, row.personId);
	return json({ ok: true });
};
```

- [ ] **Step 4: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors.

- [ ] **Step 5: Checkpoint**

Ready for the owner to commit: both new `+server.ts` files, `src/hooks.server.ts`.

---

### Task 12: Passkey interface

**Files:**

- Create: `src/lib/components/PasskeyButton.svelte`
- Modify: `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts` (expose the flag)
- Modify: `src/lib/components/PeopleSettings.svelte` (Task 5), `src/routes/(app)/settings/+page.server.ts` (list and remove credentials)
- Modify: `src/routes/enroll/[token]/+page.svelte`, `+page.server.ts` (offer registration)

**Interfaces:**

- Consumes: the four endpoints from Tasks 10-11; `passkeysAvailable` from Task 8.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Expose the flag from every page that needs it**

Add `passkeys: passkeysAvailable()` to the returned data of `src/routes/login/+page.server.ts`, `src/routes/(app)/settings/+page.server.ts` and `src/routes/enroll/[token]/+page.server.ts`.

- [ ] **Step 2: Write the sign-in button component**

Create `src/lib/components/PasskeyButton.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { startAuthentication } from '@simplewebauthn/browser';

	let error = $state('');
	let busy = $state(false);

	async function signIn() {
		error = '';
		busy = true;
		try {
			const options = await (await fetch('/auth/passkey/login/options', { method: 'POST' })).json();
			const response = await startAuthentication({ optionsJSON: options });
			const verify = await fetch('/auth/passkey/login/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ response })
			});
			if (!verify.ok) throw new Error('That passkey was not accepted.');
			await goto('/overview');
		} catch (err) {
			// Cancelling the system prompt is a deliberate act, not a failure, so
			// it must not paint the screen red.
			const name = (err as { name?: string }).name;
			if (name !== 'NotAllowedError' && name !== 'AbortError') {
				error = err instanceof Error ? err.message : 'Passkey sign-in failed.';
			}
		} finally {
			busy = false;
		}
	}
</script>

<button type="button" onclick={signIn} disabled={busy}>
	{busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
</button>
{#if error}<p class="error">{error}</p>{/if}
```

Match the button and error classes already used on the sign-in page rather than inventing new ones.

- [ ] **Step 3: Put it on the sign-in page**

In `src/routes/login/+page.svelte`, render `{#if data.passkeys}<PasskeyButton />{/if}` above the existing person picker and password form, which stay exactly as they are.

- [ ] **Step 4: Add registration and credential management to Settings**

In `src/routes/(app)/settings/+page.server.ts`, add to the `load` return:

```ts
			myPasskeys: locals.person
				? await db
						.select({
							id: credential.id,
							label: credential.label,
							createdAt: credential.createdAt,
							lastUsedAt: credential.lastUsedAt
						})
						.from(credential)
						.where(eq(credential.personId, locals.person.id))
				: [],
```

and a new action:

```ts
	removePasskey: async ({ request, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const id = String(form.get('credentialId') ?? '');
		// Scoped to the signed-in person, so one person cannot remove another's.
		await db
			.delete(credential)
			.where(and(eq(credential.id, id), eq(credential.personId, locals.person.id)));
		return { ok: true };
	},
```

Then add to `PeopleSettings.svelte`'s script:

```ts
import { invalidateAll } from '$app/navigation';
import { startRegistration } from '@simplewebauthn/browser';

let passkeyError = $state('');
let registering = $state(false);

async function addPasskey() {
	passkeyError = '';
	registering = true;
	try {
		const options = await (
			await fetch('/auth/passkey/register/options', { method: 'POST' })
		).json();
		const response = await startRegistration({ optionsJSON: options });
		const label = window.prompt('Name this passkey', 'This device') ?? 'Passkey';
		const verify = await fetch('/auth/passkey/register/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ response, label })
		});
		if (!verify.ok) throw new Error('That passkey was not accepted.');
		await invalidateAll();
	} catch (err) {
		const name = (err as { name?: string }).name;
		if (name !== 'NotAllowedError' && name !== 'AbortError') {
			passkeyError = err instanceof Error ? err.message : 'Could not add that passkey.';
		}
	} finally {
		registering = false;
	}
}
```

Extend the props with `passkeys: boolean` and `myPasskeys: { id: string; label: string; createdAt: Date; lastUsedAt: Date | null }[]`, and render below the people list:

```svelte
{#if passkeys}
	<div class="passkeys">
		{#each myPasskeys as k (k.id)}
			<div class="person-row">
				<span class="mod-label">
					<span>{k.label}</span>
					<span class="note">
						{k.lastUsedAt
							? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
							: 'never used'}
					</span>
				</span>
				<form method="POST" action="?/removePasskey" use:enhance class="row-actions">
					<input type="hidden" name="credentialId" value={k.id} />
					<button type="submit" class="btn">Remove</button>
				</form>
			</div>
		{/each}
		<button type="button" class="btn" onclick={addPasskey} disabled={registering}>
			{registering ? 'Waiting for your device…' : '🔑 Add a passkey'}
		</button>
		{#if passkeyError}<p class="note">{passkeyError}</p>{/if}
	</div>
{/if}
```

Import `credential` from the schema and `and` from `drizzle-orm` in the server file. Pass `passkeys={data.passkeys}` and `myPasskeys={data.myPasskeys}` from `settings/+page.svelte`, alongside the `people`, `me` and `enrollmentLink` props Task 5 added.

- [ ] **Step 5: Offer registration during enrollment**

In `src/routes/enroll/[token]/+page.svelte`, after a password has been set, show the same add-a-passkey control, gated on `data.passkeys`.

- [ ] **Step 6: Verify**

Run: `npm run check` and `npm run lint`. Expected: 0 errors.

Manually with `npm run dev` at `http://localhost:5173`, which is a secure context: register a passkey in Settings, sign out, sign in with it.

- [ ] **Step 7: Checkpoint**

Ready for the owner to commit: `src/lib/components/PasskeyButton.svelte`, `src/lib/components/PeopleSettings.svelte`, `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`, `src/routes/(app)/settings/+page.server.ts`, `src/routes/enroll/[token]/+page.svelte`, `src/routes/enroll/[token]/+page.server.ts`.

---

### Task 13: Passkey end-to-end journey

**Files:**

- Create: `tests/e2e/passkey.spec.ts`

- [ ] **Step 1: Write the journey using a virtual authenticator**

Chromium exposes a software authenticator over CDP, so this needs no hardware. Create `tests/e2e/passkey.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Chromium's CDP virtual authenticator registers and asserts real credentials
// in software. Requires a secure context — the E2E base URL is localhost,
// which browsers treat as secure, so passkeys are available.
test.describe.configure({ mode: 'serial' });

const AUTH_STATE = 'test-results/e2e-auth.json';

test('registering a passkey, then signing in with it', async ({ browser }) => {
	const context = await browser.newContext({ storageState: AUTH_STATE });
	const page = await context.newPage();

	const client = await context.newCDPSession(page);
	await client.send('WebAuthn.enable');
	await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});

	// The label prompt is a window.prompt; answer it before it blocks.
	page.on('dialog', (dialog) => dialog.accept('Test device'));

	await page.goto('/settings');
	await page.getByRole('button', { name: '🔑 Add a passkey' }).click();
	await expect(page.getByText('Test device')).toBeVisible();

	// Sign out, then back in using only the passkey.
	await page.goto('/logout');
	await expect(page).toHaveURL(/\/login/);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page).toHaveURL(/\/overview/);

	// Second use is the regression guard: a synced authenticator reports a
	// counter of 0 every time, and a naive counter check would reject this.
	await page.goto('/logout');
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page).toHaveURL(/\/overview/);

	await context.close();
});

test('the passkey button is absent without a secure context', async ({ page }) => {
	// The E2E base URL is localhost, which browsers treat as secure, so this
	// asserts the flag is wired rather than hard-coded true. If the suite ever
	// runs against a non-localhost HTTP origin, this is the test that catches a
	// passkey button being offered where it cannot work.
	await page.goto('/login');
	const secure = await page.evaluate(() => window.isSecureContext);
	const button = page.getByRole('button', { name: 'Sign in with a passkey' });
	await expect(button).toHaveCount(secure ? 1 : 0);
});
```

`/logout` is the existing sign-out route. Confirm it clears the session cookie and redirects to `/login`; if it requires a POST, submit the form the app layout already uses rather than navigating.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e`
Expected: the new journey passes and every existing test still passes.

- [ ] **Step 3: Checkpoint**

Ready for the owner to commit: `tests/e2e/passkey.spec.ts`.

---

### Task 14: Tailscale deployment and documentation

Last deliberately: it changes how the instance is reached, and the sequencing keeps that reversible.

**Files:**

- Modify: `compose.yaml`
- Create: `docker/tailscale-serve.json`
- Modify: `README.md`, `ARCHITECTURE.md`, `docker/DOCKERHUB.md`, `CHANGELOG.md`, `package.json` (version)

- [ ] **Step 1: Add the serve configuration**

Create `docker/tailscale-serve.json`:

```json
{
	"TCP": { "443": { "HTTPS": true } },
	"Web": {
		"${TS_CERT_DOMAIN}:443": {
			"Handlers": { "/": { "Proxy": "http://app:3000" } }
		}
	}
}
```

`${TS_CERT_DOMAIN}` is expanded by the Tailscale container itself. The proxy targets the app over the compose network by service name, so the two containers do **not** need to share a network namespace — that avoids Tailscale's MagicDNS interfering with resolving the `db` service.

- [ ] **Step 2: Add the sidecar**

In `compose.yaml`, add:

```yaml
tailscale:
  image: tailscale/tailscale:latest
  hostname: continuum
  environment:
    TS_AUTHKEY: ${TS_AUTHKEY:?set TS_AUTHKEY in .env}
    TS_STATE_DIR: /var/lib/tailscale
    TS_SERVE_CONFIG: /config/serve.json
  volumes:
    - tailscale-state:/var/lib/tailscale
    - ./docker/tailscale-serve.json:/config/serve.json:ro
  devices:
    - /dev/net/tun:/dev/net/tun
  cap_add:
    - NET_ADMIN
  restart: unless-stopped
```

Add `tailscale-state:` to the `volumes:` block. Leave the app's existing `ports:` mapping in place for now — Step 4 documents removing it after a successful passkey sign-in.

- [ ] **Step 3: Verify the sidecar actually serves**

Run: `docker compose up -d` with `TS_AUTHKEY` set, then `docker compose logs tailscale`.
Expected: the node joins the tailnet and reports a certificate for the `.ts.net` name. Browse to `https://continuum.<tailnet>.ts.net` from another tailnet device.

If the proxy cannot reach `app:3000`, that is the assumption in Step 1 failing — fall back to `network_mode: service:tailscale` on the app service and verify the `db` service still resolves.

- [ ] **Step 4: Document it**

- `README.md`: the sidecar setup, `TS_AUTHKEY`, setting `ORIGIN` to the `.ts.net` URL; the host-installed alternative for a machine already on a tailnet; the cutover note — keep the LAN port published until a passkey sign-in over the tailnet is confirmed, then remove the `ports:` mapping; the administrator escape hatch as a `docker compose exec` one-liner setting `role = 'admin'`; and that `/ics` and `/api` become tailnet-only, so a phone subscribing to the calendar needs Tailscale connected.
- `ARCHITECTURE.md`: rewrite the authentication section — two sign-in paths converging on one session, the credential table, the derived relying-party ID, the secure-context flag, enrollment links, the administrator gate.
- `docker/DOCKERHUB.md`: add `TS_AUTHKEY` to the environment table and update `ORIGIN`'s description.
- `CHANGELOG.md`: a **0.3.0** entry, flagged as a breaking deployment change.
- `package.json`: version `0.3.0`.

- [ ] **Step 5: Final verification**

Run all four commands: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`.
Expected: 0 errors, all tests pass.

- [ ] **Step 6: Checkpoint**

Ready for the owner to commit: `compose.yaml`, `docker/tailscale-serve.json`, `README.md`, `ARCHITECTURE.md`, `docker/DOCKERHUB.md`, `CHANGELOG.md`, `package.json`, and the spec at `docs/superpowers/specs/2026-08-14-passkey-auth-design.md` together with this plan.
