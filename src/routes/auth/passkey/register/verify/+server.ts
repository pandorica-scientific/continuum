import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential } from '$lib/server/db/schema';
import { takeChallenge } from '$lib/server/auth/webauthn/challenge';
import { readWebAuthnBody } from '$lib/server/auth/webauthn/payload';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const expectedChallenge = takeChallenge(cookies);
	if (!expectedChallenge) error(400, 'That took too long — try again.');

	const body = await readWebAuthnBody<RegistrationResponseJSON>(request);
	if (!body) error(400, 'That passkey response was malformed.');

	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response: body.response,
			expectedChallenge,
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
	const owner = await db
		.select({ personId: credential.personId })
		.from(credential)
		.where(eq(credential.id, info.id));
	if (owner[0] && owner[0].personId !== locals.person.id) {
		error(400, 'That passkey is already registered to someone else.');
	}

	const values = {
		publicKey: Buffer.from(info.publicKey).toString('base64url'),
		counter: info.counter,
		transports: info.transports ?? [],
		label
	};
	const stored = await db
		.insert(credential)
		.values({ id: info.id, personId: locals.person.id, ...values })
		.onConflictDoUpdate({
			target: credential.id,
			set: values,
			// Re-registering your own device is a rename. The check above already
			// rejects someone else's credential with a message; this makes the same
			// rule hold when two requests race, rather than reassigning the row.
			setWhere: eq(credential.personId, locals.person.id)
		})
		.returning({ id: credential.id });

	// Empty only when setWhere skipped the update — the race the check above
	// cannot see. Reporting success there would claim a passkey was added when
	// nothing was written.
	if (!stored[0]) error(400, 'That passkey is already registered to someone else.');

	return json({ ok: true });
};
