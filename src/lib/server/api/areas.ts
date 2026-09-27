// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which part of the household an API request touches, and whether a token
 * reaches it.
 *
 * A token is limited by AREA, not table by table: a trip is eight tables, and
 * somebody handing a travel planner "trips" should not have to know that, nor
 * tick a ninth box when a release adds one. Each table is placed in one area in
 * `tables.ts`; each curated endpoint is placed here.
 */
import type { EnumValue } from '$lib/enums';

export type ApiAccess = EnumValue<'api_token.access'>;
export type ApiArea = EnumValue<'api_token.area'>;

/**
 * Where a table or endpoint sits: a grantable area, or `shared` — people,
 * tags, the entity registry, anything that serves every area at once and so
 * would leak all of them to a token limited to one. Only an unlimited token
 * reaches `shared`.
 */
export type Reach = ApiArea | 'shared';

/** What one token may do: its access, and its areas (null for all of them). */
export interface ApiGrant {
	access: ApiAccess;
	areas: readonly ApiArea[] | null;
}

export function reaches(grant: ApiGrant, where: Reach): boolean {
	if (grant.areas === null) return true;
	return where !== 'shared' && grant.areas.includes(where);
}

/**
 * Kinds of paper that belong to an area as well as to the archive. A token
 * reaches one only when it also reaches that area, whatever else it reaches: a
 * payslip states somebody's pay, which is Salary's to hand out, not the
 * archive's.
 */
type BuiltinDocumentType = EnumValue<'document.type'>;

const DOCUMENT_TYPE_REACH: Partial<Record<BuiltinDocumentType, ApiArea>> = { payslip: 'salary' };

/** The kinds of paper this grant does not reach, each with the area it would need. */
export function documentTypesOutOfReach(
	grant: ApiGrant
): { type: BuiltinDocumentType; area: ApiArea }[] {
	return Object.entries(DOCUMENT_TYPE_REACH)
		.map(([type, area]) => ({ type: type as BuiltinDocumentType, area: area as ApiArea }))
		.filter(({ area }) => !reaches(grant, area));
}

/**
 * The curated endpoints, by the segment after `/api/v1/`. Tags hang off every
 * kind of record and net worth adds all of them up, so both are `shared`.
 */
const ENDPOINT_REACH: Record<string, Reach> = {
	accounts: 'ledger',
	transactions: 'ledger',
	categories: 'ledger',
	cashflow: 'ledger',
	tags: 'shared',
	networth: 'shared'
};

/**
 * The area a request under `/api` touches, decided before any handler runs.
 *
 * Null for the two routes that answer row by row and check each row
 * themselves: the table list, which shows a token only its own tables, and
 * files, whose area is the record a file is attached to. Anything nobody has
 * placed is `shared`, so a route added later is refused to a limited token
 * until somebody decides otherwise.
 */
export function reachOfPath(
	pathname: string,
	tableReach: (table: string) => Reach | undefined
): Reach | null {
	const [version, first, second] = pathname.replace(/^\/api\/?/, '').split('/');
	if (version !== 'v1' || !first) return 'shared';
	if (first === 'tables') return second ? (tableReach(second) ?? 'shared') : null;
	if (first === 'files') return null;
	return ENDPOINT_REACH[first] ?? 'shared';
}

/** "trips, cookbook", for a refusal that says what the token does reach. */
export function describeAreas(areas: readonly ApiArea[]): string {
	return areas.length === 0 ? 'nothing' : areas.join(', ');
}
