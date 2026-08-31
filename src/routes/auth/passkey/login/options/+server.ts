// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, json } from '@sveltejs/kit';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import { reserveChallengeIssuance } from '$lib/server/auth/ratelimit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, getClientAddress }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');
	const address = getClientAddress();
	const wait = reserveChallengeIssuance(address);
	if (wait > 0) error(429, 'Too many passkey requests — try again later.');

	const options = await generateAuthenticationOptions({
		rpID: relyingPartyId(currentOrigin()),
		// Empty: credentials are discoverable, so the authenticator tells us who
		// the person is via the user handle. That is what removes the picker.
		allowCredentials: [],
		// Matches what the verifier enforces — see the note in register/options.
		// A passkey that authenticated on possession alone would be a bearer
		// token with extra steps.
		userVerification: 'required'
	});

	const generations = await db
		.select({ id: person.id, authGeneration: person.authGeneration })
		.from(person);
	await storeChallenge(cookies, options.challenge, {
		address,
		authSnapshot: Object.fromEntries(generations.map((row) => [row.id, row.authGeneration]))
	});
	return json(options);
};
