// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { exportConfig } from '$lib/server/system/config-file';
import { requireAdmin } from '$lib/server/auth/policy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	// The read counterpart of ?/importConfig, which is administrator-only. This
	// hands back the backup destination — a path on the host filesystem — along
	// with the household name, modules and learned labels, so it has to be too.
	requireAdmin(locals.person);
	const config = await exportConfig();
	return new Response(JSON.stringify(config, null, '\t') + '\n', {
		headers: {
			'content-type': 'application/json',
			'content-disposition': 'attachment; filename="ledger.config.json"'
		}
	});
};
