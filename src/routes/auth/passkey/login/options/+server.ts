import { error, json } from '@sveltejs/kit';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { storeChallenge } from '$lib/server/auth/webauthn/challenge';
import { currentOrigin, passkeysAvailable, relyingPartyId } from '$lib/server/auth/webauthn/origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	if (!passkeysAvailable()) error(400, 'Passkeys need an HTTPS address.');

	const options = await generateAuthenticationOptions({
		rpID: relyingPartyId(currentOrigin()),
		// Empty: credentials are discoverable, so the authenticator tells us who
		// the person is via the user handle. That is what removes the picker.
		allowCredentials: [],
		userVerification: 'preferred'
	});

	storeChallenge(cookies, options.challenge);
	return json(options);
};
