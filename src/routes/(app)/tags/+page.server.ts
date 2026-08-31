// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The Tags view lives in the Documents rail now. Old links and bookmarks land
// where it went rather than on a 404.
export const load: PageServerLoad = async () => {
	redirect(303, '/documents?view=tags');
};
