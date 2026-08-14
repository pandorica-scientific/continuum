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
