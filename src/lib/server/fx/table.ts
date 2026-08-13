import { db } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';

/** All known rates, newest first per code: code → [{day, czkPerUnit}]. */
export type RateTable = Map<string, { day: string; rate: number }[]>;

export async function loadRateTable(): Promise<RateTable> {
	const rows = await db.select().from(currencyRate);
	const table: RateTable = new Map();
	for (const row of rows) {
		if (!table.has(row.code)) table.set(row.code, []);
		table.get(row.code)!.push({ day: row.day, rate: Number(row.rate) });
	}
	for (const list of table.values()) {
		list.sort((a, b) => (a.day < b.day ? 1 : -1));
	}
	return table;
}

function czkPerUnit(table: RateTable, code: string, day: string): number | null {
	if (code === 'CZK') return 1;
	const list = table.get(code);
	if (!list) return null;
	const hit = list.find((r) => r.day <= day) ?? list[list.length - 1];
	return hit ? hit.rate : null;
}

/** Synchronous conversion over a preloaded table, for tight loops. */
export function convertMinorSync(
	table: RateTable,
	amountMinor: bigint,
	from: string,
	to: string,
	day: string
): bigint | null {
	if (from === to) return amountMinor;
	const fromCzk = czkPerUnit(table, from, day);
	const toCzk = czkPerUnit(table, to, day);
	if (fromCzk === null || toCzk === null) return null;
	return BigInt(Math.round(Number(amountMinor) * (fromCzk / toCzk)));
}
