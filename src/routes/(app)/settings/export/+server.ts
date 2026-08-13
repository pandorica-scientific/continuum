import { exportConfig } from '$lib/server/config-file';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const config = await exportConfig();
	return new Response(JSON.stringify(config, null, '\t') + '\n', {
		headers: {
			'content-type': 'application/json',
			'content-disposition': 'attachment; filename="ledger.config.json"'
		}
	});
};
