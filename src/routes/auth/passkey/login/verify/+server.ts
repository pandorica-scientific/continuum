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
