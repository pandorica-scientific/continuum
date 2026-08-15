// Signature counters detect cloned authenticators — but only some hardware
// reports them. Synced passkeys (iCloud Keychain, and most platform
// authenticators) always send 0, so a clone is detectable only when both the
// stored and the incoming value are non-zero.
//
// This is the only counter policy in force. @simplewebauthn/server has its own,
// stricter rule — it rejects a non-increasing counter whenever *either* side is
// non-zero — which would refuse the synced-passkey case this exists to permit,
// and which fired first and made everything below unreachable. login/verify
// therefore hands the library a counter of 0 to stand its check down.

import { sql } from 'drizzle-orm';
import type { Queryable } from '$lib/server/db';
import { credential, person } from '$lib/server/db/schema';

export function isCloneSignal(stored: number, incoming: number): boolean {
	if (stored === 0 || incoming === 0) return false;
	return incoming <= stored;
}

/** Compare-and-swap the counter while the owning generation remains current. */
export async function advanceCredentialCounter(
	handle: Queryable,
	credentialId: string,
	expectedCounter: number,
	incomingCounter: number,
	expectedGeneration: number
): Promise<boolean> {
	const rows = await handle.execute(sql`
		update ${credential}
		set counter = ${incomingCounter}, last_used_at = now()
		where ${credential.id} = ${credentialId}
			and ${credential.counter} = ${expectedCounter}
			and ${credential.authGeneration} = ${expectedGeneration}
			and exists (
				select 1 from ${person}
				where ${person.id} = ${credential.personId}
					and ${person.authGeneration} = ${expectedGeneration}
					and ${person.deactivatedAt} is null
				for no key update
			)
		returning ${credential.id}
	`);
	return rows.length === 1;
}
