import { error, json } from '@sveltejs/kit';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { createCredentialAtGeneration } from '$lib/server/auth/generation';
import { takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { readWebAuthnBody } from '$lib/server/auth/webauthn/payload';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const storedChallenge = await takeChallenge(cookies);
	if (!storedChallenge) error(400, 'That took too long — try again.');
	if (
		storedChallenge.personId !== locals.person.id ||
		typeof storedChallenge.authGeneration !== 'number'
	) {
		error(400, 'Authentication changed during registration — try again.');
	}

	const body = await readWebAuthnBody<RegistrationResponseJSON>(request);
	if (!body) error(400, 'That passkey response was malformed.');

	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response: body.response,
			expectedChallenge: storedChallenge.challenge,
			expectedOrigin: currentOrigin(),
			expectedRPID: relyingPartyId(currentOrigin())
		});
	} catch {
		// A malformed attestation object or a mismatched origin throws here. Both
		// are the user's problem to retry, not a server fault to report as 500.
		error(400, 'That passkey could not be verified.');
	}

	if (!verification.verified || !verification.registrationInfo) {
		error(400, 'That passkey could not be verified.');
	}

	const info = verification.registrationInfo.credential;
	// Typed by the person and stored in a Postgres text column, so it gets the
	// same treatment as the credential id: a NUL byte would make the insert throw
	// 22021 and turn a device name into a 500. Control and formatting characters
	// have no business in one regardless, and the bound keeps the list readable.
	const label =
		String(body.label ?? '')
			.replace(/[\p{Cc}\p{Cf}]/gu, '')
			.trim()
			.slice(0, 64) || 'Passkey';

	// excludeCredentials only lists this person's own credentials and is advisory
	// — an authenticator may ignore it, and a double click races it outright. So
	// a credential id arriving twice is expected rather than exceptional.
	const stored = await createCredentialAtGeneration(db, {
		id: info.id,
		personId: locals.person.id,
		authGeneration: storedChallenge.authGeneration,
		publicKey: Buffer.from(info.publicKey).toString('base64url'),
		counter: info.counter,
		transports: info.transports ?? [],
		label
	});

	// Empty only when setWhere skipped the update — the race the check above
	// cannot see. Reporting success there would claim a passkey was added when
	// nothing was written.
	if (!stored) error(400, 'Authentication changed or that passkey belongs to someone else.');

	return json({ ok: true });
};
