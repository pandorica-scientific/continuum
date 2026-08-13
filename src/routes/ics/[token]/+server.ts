import { error } from '@sveltejs/kit';
import { buildIcs, icsToken } from '$lib/server/calendar';
import type { RequestHandler } from './$types';

// The published ledger.ics feed. Calendar apps cannot log in, so the URL
// carries a secret token instead of a session.
export const GET: RequestHandler = async ({ params }) => {
	const token = await icsToken();
	if (params.token !== token) error(404, 'Not found');
	return new Response(await buildIcs(), {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': 'inline; filename="ledger.ics"'
		}
	});
};
