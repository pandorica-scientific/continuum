// SPDX-License-Identifier: AGPL-3.0-or-later
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { json } from '$lib/server/api/respond';
import { money } from '$lib/api/serialise';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(account).orderBy(account.createdAt, account.id);
	return json({
		accounts: rows.map((a) => ({
			id: a.id,
			name: a.name,
			bank: a.bank,
			kind: a.kind,
			balance: money(a.balanceMinor, a.currency),
			balanceAsOf: a.balanceOn
		}))
	});
};
