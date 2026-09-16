// SPDX-License-Identifier: AGPL-3.0-or-later
import { exportConfig } from '$lib/server/system/config-file';
import { requireAdmin } from '$lib/server/auth/policy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	// Admin-only: the export includes the backup destination, a path on the host filesystem.
	requireAdmin(locals.person);
	const config = await exportConfig();
	return new Response(JSON.stringify(config, null, '\t') + '\n', {
		headers: {
			'content-type': 'application/json',
			'content-disposition': 'attachment; filename="ledger.config.json"'
		}
	});
};
