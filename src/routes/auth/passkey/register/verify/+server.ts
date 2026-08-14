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
