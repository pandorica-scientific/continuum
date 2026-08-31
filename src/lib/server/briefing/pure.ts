// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The briefing's judgements that need no database.
 *
 * Every source in `index.ts` reaches a database on its first line, so anything
 * decided inside one can only be tested by standing a Postgres up. These are
 * the decisions that are not about data at all — plural grammar, which of a
 * document's jobs is the current one, how the strip describes itself — and
 * they live here so a unit test can hold them.
 *
 * It is also where the wording stops being per-source. "1 document" and "2
 * documents" were spelled out at each title, which is two chances to write
 * "1 documents", and the about line was assembled in place by the one source
 * that had it.
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
 * A document keeps every attempt it has ever had, so asking the database for
 * `state = 'failed'` answers "has this ever failed", which is a different
 * question: a file that failed on Monday and was re-read on Tuesday is not a
 * document anybody has to do anything about.
 *
 * Order-independent rather than trusting the query's `order by`, because the
 * rule is about `queued_at` and reading it off the row order would make this
 * untestable without the query that produced it.
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
 * An unnamed link comes back as an empty string, and "about  and Mortgage ČS"
 * reads as a missing word rather than as a missing record, so it is dropped
 * here rather than at each call site.
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
 * The sentence under the strip's title.
 *
 * `items` is what is ON the strip and `total` how many the briefing found in
 * all: the sentence counts the cards a person can see, and the "+N more"
 * button beside it carries the rest. `total` answers the only question the
 * cards cannot — whether anything needed anyone at all.
 */
export function briefingCaption(items: readonly { hue: string }[], total: number): string {
	if (total === 0) return 'nothing needs you today';
	const urgent = items.filter((item) => item.hue === 'red').length;
	if (urgent > 0) return `${items.length} things, ${urgent} of them urgent`;
	if (items.length === 1) return 'one thing, none of them urgent today';
	return `${WORDS[items.length] ?? items.length} things, none of them urgent today`;
}
