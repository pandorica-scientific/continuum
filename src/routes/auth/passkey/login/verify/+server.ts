import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential, person } from '$lib/server/db/schema';
import { createSession } from '$lib/server/auth';
import { takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { isCloneSignal } from '$lib/server/auth/webauthn/counter';
import { readWebAuthnBody } from '$lib/server/auth/webauthn/payload';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import {
	loginBlockedForSeconds,
	recordLoginFailure,
	recordLoginSuccess
} from '$lib/server/auth/ratelimit';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, request, getClientAddress }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	// This endpoint feeds the same per-address counter that gates the password
	// form, so it has to honour it too. Skipping the check left it unlimited
	// while its own failures locked the household out of signing in with a
	// password — and behind a reverse proxy or Tailscale every request shares
	// one address, so one caller could do that to everyone.
	const address = getClientAddress();
	const wait = loginBlockedForSeconds(address);
	if (wait > 0) {
		const minutes = Math.ceil(wait / 60);
		error(429, `Too many failed attempts — try again in ${minutes} minute${wait > 60 ? 's' : ''}.`);
	}

	const expectedChallenge = takeChallenge(cookies);
	if (!expectedChallenge) error(400, 'That took too long — try again.');

	const body = await readWebAuthnBody<AuthenticationResponseJSON>(request);
	if (!body) {
		recordLoginFailure(address);
		error(400, 'That passkey response was malformed.');
	}

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
		recordLoginFailure(address);
		error(400, 'That passkey is not recognised.');
	}

	let verification;
	try {
		verification = await verifyAuthenticationResponse({
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
	} catch {
		// The library throws rather than returning a verdict for most mismatches,
		// a misconfigured ORIGIN being the likely one. Its message names internals
		// and belongs in neither a 500 nor the browser.
		recordLoginFailure(address);
		error(400, 'That passkey could not be verified.');
	}

	if (!verification.verified) {
		recordLoginFailure(address);
		error(400, 'That passkey could not be verified.');
	}

	const incoming = verification.authenticationInfo.newCounter;
	if (isCloneSignal(row.counter, incoming)) {
		recordLoginFailure(address);
		error(400, 'That passkey looks cloned and has been refused.');
	}

	await db
		.update(credential)
		.set({ counter: incoming, lastUsedAt: new Date() })
		.where(eq(credential.id, row.id));

	recordLoginSuccess(address);
	await createSession(cookies, row.personId);
	return json({ ok: true });
};
