// SPDX-License-Identifier: AGPL-3.0-or-later
// Permission rules, kept as pure functions so every guard is testable without
// a database and so the same rule cannot drift between two call sites.
//
// The invariant these protect: an instance always has at least one active
// administrator. Without it the only recovery is the documented database
// one-liner in the README.

import { error } from '@sveltejs/kit';

export type PersonRole = 'admin' | 'member';

interface PolicyPerson {
	id: string;
	role: PersonRole;
}

/**
 * The one definition of "this person could sign in and administer the instance
 * right now": not deactivated, and has a password (enrolled). Every guard
 * below rests on it. The SQL that produces the admin count must mirror it
 * exactly; see lockActiveAdminCount in the settings page.
 */
export function canSignIn(row: {
	deactivatedAt: Date | null;
	passwordHash: string | null;
}): boolean {
	return row.deactivatedAt === null && row.passwordHash !== null;
}

/**
 * The person an operation acts on, carrying whether they are one of the
 * administrators `activeAdminCount` counts. Deliberately not just `role`,
 * which conflates "is admin" with "counts toward the last-admin guard".
 */
export interface PolicyTarget extends PolicyPerson {
	canSignIn: boolean;
}

type PolicyResult = { ok: true } | { ok: false; reason: string };

const OK: PolicyResult = { ok: true };

function deny(reason: string): PolicyResult {
	return { ok: false, reason };
}

/**
 * `activeAdminCount` counts the administrators `canSignIn` accepts, including
 * the target when the target is one of them.
 */
export function canDeactivate(
	actor: PolicyPerson,
	target: PolicyTarget,
	activeAdminCount: number
): PolicyResult {
	if (actor.role !== 'admin') return deny('Only an administrator can deactivate someone.');
	if (actor.id === target.id) return deny('You cannot deactivate your own account.');
	if (target.role === 'admin' && target.canSignIn && activeAdminCount <= 1) {
		return deny('This is the last administrator — promote someone else first.');
	}
	return OK;
}

export function canChangeRole(
	actor: PolicyPerson,
	target: PolicyTarget,
	next: PersonRole,
	activeAdminCount: number
): PolicyResult {
	if (actor.role !== 'admin') return deny('Only an administrator can change roles.');
	if (target.role === next) return OK;
	if (next === 'member' && target.role === 'admin' && target.canSignIn && activeAdminCount <= 1) {
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

/**
 * May this person act on records that are about `personId` — file a payslip
 * or a tax statement for them, attach paper to it, remove it?
 *
 * A member acts for themself; an administrator acts for anybody; a request
 * with nobody signed in acts for no one.
 */
export function mayActFor(actor: PolicyPerson | null | undefined, personId: string): boolean {
	if (!actor) return false;
	return actor.role === 'admin' || actor.id === personId;
}
