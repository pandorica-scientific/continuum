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
