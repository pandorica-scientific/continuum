import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential, person } from '$lib/server/db/schema';
import { createSession } from '$lib/server/auth';
import { challengeGenerationMatches, takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { advanceCredentialCounter, isCloneSignal } from '$lib/server/auth/webauthn/counter';
import { readWebAuthnBody } from '$lib/server/auth/webauthn/payload';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import { blockedForSeconds, recordFailure } from '$lib/server/auth/ratelimit';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, request, getClientAddress }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	// Rate limited like every other credential check. No subject: a passkey
	// sign-in is usernameless, so there is no account to attribute an attempt to
	// until it verifies — which gives it its own per-address budget, separate
	// from the per-account ones the password form uses. Failures here therefore
	// no longer refuse everyone's password sign-in, which is what happened when
	// both shared one counter and every request behind Tailscale shares an
	// address.
	const address = getClientAddress();
	const wait = blockedForSeconds('login', address);
	if (wait > 0) {
		const minutes = Math.ceil(wait / 60);
		error(429, `Too many failed attempts — try again in ${minutes} minute${wait > 60 ? 's' : ''}.`);
	}

	const storedChallenge = await takeChallenge(cookies);
	if (!storedChallenge) error(400, 'That took too long — try again.');

	const body = await readWebAuthnBody<AuthenticationResponseJSON>(request);
	if (!body) {
		recordFailure('login', address);
		error(400, 'That passkey response was malformed.');
	}

	const rows = await db
		.select({
			id: credential.id,
			publicKey: credential.publicKey,
			counter: credential.counter,
			personId: credential.personId,
			authGeneration: credential.authGeneration,
			personAuthGeneration: person.authGeneration,
			deactivatedAt: person.deactivatedAt
		})
		.from(credential)
		.innerJoin(person, eq(credential.personId, person.id))
		.where(eq(credential.id, body.response.id));

	const row = rows[0];
	// A deactivated person's credentials are kept so reactivation is a clean
	// undo, so the check has to happen here rather than by deleting them.
	if (!row || row.deactivatedAt || row.authGeneration !== row.personAuthGeneration) {
		recordFailure('login', address);
		error(400, 'That passkey is not recognised.');
	}
	if (!challengeGenerationMatches(storedChallenge, row.personId, row.authGeneration)) {
		recordFailure('login', address);
		error(400, 'Authentication changed during passkey verification — try again.');
	}

	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response: body.response,
			expectedChallenge: storedChallenge.challenge,
			expectedOrigin: currentOrigin(),
			expectedRPID: relyingPartyId(currentOrigin()),
			credential: {
				id: row.id,
				publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')),
				// Deliberately zero. The library refuses any counter that does not
				// increase, including the 0 that synced passkeys always report — so a
				// credential that once reported a real value and then moved to iCloud
				// Keychain could never sign in again. Clone detection here is
				// isCloneSignal's job precisely because it has to tolerate that, and
				// handing the library a zero is what lets it run at all: its check
				// fires first and covers every case isCloneSignal would have caught.
				counter: 0
			}
		});
	} catch {
		// The library throws rather than returning a verdict for most mismatches,
		// a misconfigured ORIGIN being the likely one. Its message names internals
		// and belongs in neither a 500 nor the browser.
		recordFailure('login', address);
		error(400, 'That passkey could not be verified.');
	}

	if (!verification.verified) {
		recordFailure('login', address);
		error(400, 'That passkey could not be verified.');
	}

	const incoming = verification.authenticationInfo.newCounter;
	if (isCloneSignal(row.counter, incoming)) {
		recordFailure('login', address);
		error(400, 'That passkey looks cloned and has been refused.');
	}

	if (!(await advanceCredentialCounter(db, row.id, row.counter, incoming, row.authGeneration))) {
		recordFailure('login', address);
		error(400, 'Authentication changed during passkey verification — try again.');
	}

	if (!(await createSession(cookies, row.personId, row.authGeneration))) {
		recordFailure('login', address);
		error(400, 'Authentication changed during passkey verification — try again.');
	}
	return json({ ok: true });
};
