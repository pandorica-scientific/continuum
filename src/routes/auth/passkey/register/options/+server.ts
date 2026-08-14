import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { credential } from '$lib/server/db/schema';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.person) error(401, 'Sign in first.');
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const existing = await db
		.select({ id: credential.id, transports: credential.transports })
		.from(credential)
		.where(eq(credential.personId, locals.person.id));

	const options = await generateRegistrationOptions({
		rpName: 'Continuum',
		rpID: relyingPartyId(currentOrigin()),
		userName: locals.person.name,
		userID: new TextEncoder().encode(locals.person.id),
		// No reason for a household ledger to identify authenticator models.
		attestationType: 'none',
		// Discoverable, so the sign-in screen can skip the person picker.
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		// Stops one device silently registering itself twice.
		excludeCredentials: existing.map((c) => ({
			id: c.id,
			transports: c.transports as AuthenticatorTransportFuture[]
		}))
	});

	storeChallenge(cookies, options.challenge);
	return json(options);
};
