// SPDX-License-Identifier: AGPL-3.0-or-later
import { grantOf, json } from '$lib/server/api/respond';
import { describeTables } from '$lib/server/api/tables';
import type { RequestHandler } from './$types';

// Every table this token reaches, with its columns and primary key.
export const GET: RequestHandler = async ({ locals }) =>
	json({ tables: describeTables(grantOf(locals)) });
