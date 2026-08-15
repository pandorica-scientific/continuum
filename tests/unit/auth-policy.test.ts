import { describe, expect, it } from 'vitest';
import {
	canChangeRole,
	canDeactivate,
	canSignIn,
	requireAdmin,
	type PolicyTarget
} from '$lib/server/auth/policy';

const admin = { id: 'a', role: 'admin' as const };
const member = { id: 'c', role: 'member' as const };

/** A target who is one of the administrators the count counts. */
const target = (id: string, role: 'admin' | 'member'): PolicyTarget => ({
	id,
	role,
	canSignIn: true
});

/** An administrator on paper only: deactivated, or created and never enrolled. */
const idleTarget = (id: string, role: 'admin' | 'member'): PolicyTarget => ({
	id,
	role,
	canSignIn: false
});

const otherAdmin = target('b', 'admin');
const memberTarget = target('c', 'member');

describe('canSignIn', () => {
	// The predicate the guards and the SQL count both depend on. If these two
	// ever disagree, the invariant they protect is not protected by either.
	it('accepts an enrolled, active person', () => {
		expect(canSignIn({ deactivatedAt: null, passwordHash: 'argon2…' })).toBe(true);
	});

	it('rejects someone who has never chosen a password', () => {
		expect(canSignIn({ deactivatedAt: null, passwordHash: null })).toBe(false);
	});

	it('rejects a deactivated person, enrolled or not', () => {
		const when = new Date('2026-01-01T00:00:00Z');
		expect(canSignIn({ deactivatedAt: when, passwordHash: 'argon2…' })).toBe(false);
		expect(canSignIn({ deactivatedAt: when, passwordHash: null })).toBe(false);
	});
});

describe('canDeactivate', () => {
	it('lets an admin deactivate a member', () => {
		expect(canDeactivate(admin, memberTarget, 1)).toEqual({ ok: true });
	});

	it('refuses a member acting on anyone', () => {
		expect(canDeactivate(member, otherAdmin, 2).ok).toBe(false);
	});

	it('refuses deactivating yourself', () => {
		expect(canDeactivate(admin, target('a', 'admin'), 2).ok).toBe(false);
	});

	it('refuses deactivating the last admin', () => {
		expect(canDeactivate(admin, otherAdmin, 1).ok).toBe(false);
	});

	it('allows deactivating an admin while another remains', () => {
		expect(canDeactivate(admin, otherAdmin, 2)).toEqual({ ok: true });
	});

	// The count already excludes an administrator who cannot sign in, so acting
	// on one cannot reduce it. Refusing anyway named the wrong person as the last
	// administrator and blocked a perfectly safe tidy-up.
	it('allows deactivating an admin who could not sign in anyway', () => {
		expect(canDeactivate(admin, idleTarget('b', 'admin'), 1)).toEqual({ ok: true });
	});
});

describe('canChangeRole', () => {
	it('lets an admin promote a member', () => {
		expect(canChangeRole(admin, memberTarget, 'admin', 1)).toEqual({ ok: true });
	});

	it('refuses a member changing any role', () => {
		expect(canChangeRole(member, memberTarget, 'admin', 1).ok).toBe(false);
	});

	it('refuses demoting the last admin', () => {
		expect(canChangeRole(admin, target('a', 'admin'), 'member', 1).ok).toBe(false);
	});

	it('allows demoting yourself while another admin remains', () => {
		expect(canChangeRole(admin, target('a', 'admin'), 'member', 2)).toEqual({ ok: true });
	});

	it('is a no-op success when the role is already what was asked for', () => {
		expect(canChangeRole(admin, memberTarget, 'member', 1)).toEqual({ ok: true });
	});

	// The mirror of the deactivation case: a pending or deactivated administrator
	// was never in the count, so demoting them takes nothing away.
	it('allows demoting an admin who could not sign in anyway', () => {
		expect(canChangeRole(admin, idleTarget('b', 'admin'), 'member', 1)).toEqual({ ok: true });
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
