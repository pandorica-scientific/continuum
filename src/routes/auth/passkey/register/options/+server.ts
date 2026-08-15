import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential, person } from '$lib/server/db/schema';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { getHouseholdName } from '$lib/server/settings';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import { reserveChallengeIssuance } from '$lib/server/auth/ratelimit';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies, getClientAddress }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');
	const address = getClientAddress();
	const wait = reserveChallengeIssuance(address);
	if (wait > 0) error(429, 'Too many passkey requests — try again later.');

	const existing = await db
		.select({ id: credential.id, transports: credential.transports })
		.from(credential)
		.where(eq(credential.personId, locals.person.id));
	const generationRows = await db
		.select({ authGeneration: person.authGeneration })
		.from(person)
		.where(eq(person.id, locals.person.id));
	const authGeneration = generationRows[0]?.authGeneration;
	if (authGeneration === undefined) error(401, 'Sign in first.');

	const options = await generateRegistrationOptions({
		rpName: await getHouseholdName(),
		rpID: relyingPartyId(currentOrigin()),
		userName: locals.person.name,
		userID: new TextEncoder().encode(locals.person.id),
		// No reason for a household ledger to identify authenticator models.
		attestationType: 'none',
		// Discoverable, so the sign-in screen can skip the person picker.
		//
		// 'required' rather than 'preferred' because the verifier enforces user
		// verification either way (SimpleWebAuthn defaults requireUserVerification
		// to true). Asking for less than we enforce meant an authenticator that
		// legitimately skipped the biometric — a security key with no PIN — was
		// rejected after the fact with an error nobody could act on.
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		// Stops one device silently registering itself twice.
		excludeCredentials: existing.map((c) => ({
			id: c.id,
			transports: c.transports as AuthenticatorTransportFuture[]
		}))
	});

	await storeChallenge(cookies, options.challenge, {
		address,
		personId: locals.person.id,
		authGeneration,
		authSnapshot: { [locals.person.id]: authGeneration }
	});
	return json(options);
};
