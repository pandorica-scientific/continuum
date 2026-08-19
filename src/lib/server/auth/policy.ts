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
 * right now". Two things disqualify an administrator: being deactivated, and
 * having been created by an administrator but never having opened their
 * enrollment link to choose a password.
 *
 * Both halves of every guard below rest on it — the count of administrators
 * still standing, and whether the person being acted on is one of them — so it
 * lives here rather than being spelled out twice in slightly different words.
 * The SQL that produces the count has to mirror it exactly; see
 * lockActiveAdminCount in the settings page.
 */
export function canSignIn(row: {
	deactivatedAt: Date | null;
	passwordHash: string | null;
}): boolean {
	return row.deactivatedAt === null && row.passwordHash !== null;
}

/**
 * The person an operation acts on, carrying whether they are one of the
 * administrators `activeAdminCount` counts.
 *
 * Testing `role === 'admin'` alone conflated two different people. It refused
 * demoting an administrator who was already deactivated — an operation that
 * cannot reduce the count, reported with a message naming somebody else as the
 * last administrator — and, worse in the other direction, it let an
 * administrator who had never enrolled stand in for a real one.
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
