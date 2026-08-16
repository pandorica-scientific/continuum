import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarAccount } from '$lib/server/db/schema';
import { exchangeCode, stateMatches } from '$lib/server/calendar/sync/google-oauth';
import type { RequestHandler } from './$types';

/**
 * Where Google sends the browser back to.
 *
 * The half-finished account row created when the flow started is waiting with
 * the client id, the client secret and the hash of the state nonce. This
 * completes it or removes it — a row with no refresh token can never sync, so
 * leaving one behind would put a permanently broken account in the list.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	// Guarded like everything else under (app): the callback writes a credential.
	if (locals.person?.role !== 'admin') redirect(303, '/settings');

	const back = (message: string) =>
		redirect(303, `/settings?calendar=${encodeURIComponent(message)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	// The person pressed Cancel on Google's consent screen.
	if (error === 'access_denied') {
		await db.delete(calendarAccount).where(eq(calendarAccount.provider, 'google'));
		back('Authorisation cancelled.');
	}
	if (!code || !state) back('Google sent back an incomplete answer.');

	const pending = (
		await db.select().from(calendarAccount).where(eq(calendarAccount.provider, 'google'))
	)
		.map((row) => ({ row, config: JSON.parse(row.credential) as Record<string, string> }))
		// Only rows still waiting for a token — a working account has no state hash.
		.filter((entry) => entry.config.stateHash);

	// Matched by the state nonce rather than by "the most recent row": that check
	// is the whole defence against a third party completing an authorisation on
	// this household's behalf.
	const match = pending.find((entry) => stateMatches(state!, entry.config.stateHash));
	if (!match) back('That authorisation did not match one this app started.');

	const result = await exchangeCode(code!, {
		clientId: match!.config.clientId,
		clientSecret: match!.config.clientSecret,
		stateHash: match!.config.stateHash,
		redirectUri: `${url.origin}/settings/google/callback`
	});

	if (!result.ok) {
		await db.delete(calendarAccount).where(eq(calendarAccount.id, match!.row.id));
		back(result.message);
	}

	// The state hash goes as the token arrives: it is single-use, and a row that
	// still carries one would be picked up as pending by a later callback.
	await db
		.update(calendarAccount)
		.set({
			credential: JSON.stringify({
				clientId: match!.config.clientId,
				clientSecret: match!.config.clientSecret,
				refreshToken: (result as { ok: true; refreshToken: string }).refreshToken
			}),
			lastError: null
		})
		.where(eq(calendarAccount.id, match!.row.id));

	redirect(303, '/settings?calendar=Google+connected.+Choose+a+calendar+to+sync+with.');
};
