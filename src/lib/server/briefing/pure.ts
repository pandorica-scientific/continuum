// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The briefing's judgements that need no database — plural grammar, which of
 * a document's jobs is current, how the strip describes itself — so a unit
 * test can hold them without standing a Postgres up.
 */

/** One `job` row, as the extraction source reads it. */
export interface ExtractionJobRow {
	documentId: string;
	state: string;
	queuedAt: Date;
}

/**
 * Each document's CURRENT extraction state — the newest attempt wins.
 *
 * A document keeps every attempt it has ever had, so `state = 'failed'` alone
 * answers "has this ever failed", a different question. Order-independent
 * rather than trusting the query's `order by`, so this is testable on its own.
 */
export function latestJobPerDocument(rows: readonly ExtractionJobRow[]): Map<string, string> {
	const newest = new Map<string, ExtractionJobRow>();
	for (const row of rows) {
		const held = newest.get(row.documentId);
		if (!held || row.queuedAt.getTime() > held.queuedAt.getTime()) {
			newest.set(row.documentId, row);
		}
	}
	return new Map([...newest].map(([documentId, row]) => [documentId, row.state]));
}

/**
 * A document's second line: where it is filed, and what it is about.
 *
 * An unnamed link comes back as an empty string, dropped here so "about  and
 * Mortgage ČS" cannot read as a missing word.
 */
export function aboutLine(shelfLabel: string, names: readonly string[]): string {
	const named = names.filter(Boolean);
	return named.length > 0
		? `Filed under ${shelfLabel}, about ${named.join(' and ')}.`
		: `Filed under ${shelfLabel}.`;
}

/** "1 document waiting to be filed" / "2 documents waiting to be filed". */
export function countTitle(n: number, singular: string, plural: string): string {
	return `${n} ${n === 1 ? singular : plural}`;
}

/** Small counts read as words; past the strip's own size there is no word for it. */
const WORDS = ['', 'one', 'two', 'three', 'four'];

/**
 * The sentence under the strip's title. `items` is what is ON the strip and
 * `total` how many the briefing found in all — the "+N more" button carries
 * the rest.
 */
export function briefingCaption(items: readonly { hue: string }[], total: number): string {
	if (total === 0) return 'nothing needs you today';
	const urgent = items.filter((item) => item.hue === 'red').length;
	if (urgent > 0) return `${items.length} things, ${urgent} of them urgent`;
	if (items.length === 1) return 'one thing, none of them urgent today';
	return `${WORDS[items.length] ?? items.length} things, none of them urgent today`;
}

/** Whole days from `from` to `to`, both ISO days. Negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Whole months from `from` to `to`, counting a part month only once it completes. */
export function monthsBetween(from: string, to: string): number {
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = to.split('-').map(Number);
	const months = (ty - fy) * 12 + (tm - fm);
	return td < fd ? months - 1 : months;
}

/** One tranche, as the two equity sources read it. */
export interface TrancheTiming {
	vestsOn: string;
	settledOn: string | null;
	forfeitedOn: string | null;
}

/**
 * A tranche that vested and was never written down. Not simply "vested and
 * unsettled" — the shares behind a vest reach the broker days later, so the
 * grace period avoids asking about something that hasn't happened yet.
 */
export function settlementOverdue(
	tranche: TrancheTiming,
	today: string,
	graceDays: number
): boolean {
	if (tranche.forfeitedOn || tranche.settledOn) return false;
	return daysBetween(tranche.vestsOn, today) > graceDays;
}

/**
 * The tax year worth asking about today, or null while it is too early to ask.
 * A briefing nagging from the second of January is one people learn to read
 * past, so the month it starts from is the household's to set.
 */
export function taxYearToChase(today: string, reminderMonth: number): number | null {
	const month = Number(today.slice(5, 7));
	if (month < reminderMonth) return null;
	return Number(today.slice(0, 4)) - 1;
}

/**
 * How far behind a lane is, judged by its LAST expected period.
 *
 * A lane with an old hole but this month's paper filed is not something to act
 * on today — the shelf's own ribbon already draws it. What belongs on the
 * briefing is a rhythm that has stopped.
 */
export function laneShortfall(cells: readonly { state: string }[]): number {
	const expected = cells.filter((cell) => cell.state === 'filed' || cell.state === 'gap');
	if (expected.length === 0) return 0;
	if (expected[expected.length - 1].state !== 'gap') return 0;
	return expected.filter((cell) => cell.state === 'gap').length;
}

/** Whether a drawn year says anything at all about a lane: a year of "not arrived yet" does not. */
export function laneJudgeable(cells: readonly { state: string }[]): boolean {
	return cells.some((cell) => cell.state === 'filed' || cell.state === 'gap');
}
