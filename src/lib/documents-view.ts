// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The decisions the Documents screen makes, taken out of the markup.
 *
 * There is no browser test suite in this repository, by design, so anything
 * that has to be held by automation has to be reachable without a page. That is
 * why the expiry treatment, the grouping and the sorting live here as pure
 * functions with a test each, and the component that uses them is thin enough
 * to verify by looking at it.
 */

/** How an expiry reads on a row: quietly, or as a traffic-light pill. */
export type ExpiryTreatment =
	{ kind: 'plain'; text: string } | { kind: 'pill'; hue: 'yellow' | 'red'; text: string };

/** Which of the three layouts is on screen. Decides A2's verb shedding. */
export type RowWidth = 'wide' | 'medium' | 'narrow';

export type GroupKey = 'type' | 'entity' | 'year' | 'expiry' | 'none';
export type SortKey = 'newest' | 'oldest' | 'name' | 'expiry';

/** What the row needs to decide how it reads. Deliberately not the whole row. */
export interface DocRow {
	id: string;
	name: string;
	type: string;
	shelfKey: string;
	shelfLabel: string;
	entities: string[];
	addedOn: string;
	periodOn: string | null;
	expiresOn: string | null;
	expiryVerb: string;
	subjectArchived: boolean;
}

export interface DocGroup<T extends DocRow = DocRow> {
	key: string;
	label: string;
	items: T[];
}

/** Amber inside this many days. Beyond it, a renewal is a fact, not a task. */
const SOON_DAYS = 60;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2027-01-12` → `12 Jan 2027`. Day first, because a household is Czech. */
export function readableDate(iso: string): string {
	const [y, m, d] = iso.split('-');
	const month = MONTHS[Number(m) - 1];
	return month ? `${Number(d)} ${month} ${y}` : iso;
}

function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.round((b - a) / 86_400_000);
}

/** The past tense of an expiry verb, for a date that has already gone by. */
function pastTense(verb: string): string {
	if (verb === 'expires') return 'expired';
	if (verb === 'ends') return 'ended';
	if (verb === 'renews') return 'renewed';
	if (verb === 'due') return 'was due';
	return verb;
}

/**
 * How a document's expiry reads, if it has one.
 *
 * The row that matters most is the last one: an expiry that has already passed
 * on an ARCHIVED subject is history, not a problem. A sold car's insurance
 * lapsed in April, and painting that red every time the list opens trains a
 * person to ignore red.
 *
 * A2: below 1200px the verb is shed only in the plain state. "due" and "renews"
 * change what a person has to do, and the urgent rows are few enough to afford
 * the twelve pixels; the quiet ones are not.
 */
export function expiryTreatment(
	doc: { expiresOn: string | null; expiryVerb: string },
	subjectArchived: boolean,
	today: string,
	width: RowWidth = 'wide'
): ExpiryTreatment | null {
	if (!doc.expiresOn) return null;
	const days = daysBetween(today, doc.expiresOn);
	const verb = doc.expiryVerb;

	if (days < 0) {
		if (subjectArchived) {
			// History. Plain, and dated rather than counted: "6 days ago" invites
			// action on a subject nobody is acting on any more.
			return { kind: 'plain', text: `${pastTense(verb)} ${doc.expiresOn}` };
		}
		const ago = Math.abs(days);
		return {
			kind: 'pill',
			hue: 'red',
			text: `${pastTense(verb)} ${ago === 1 ? '1 day' : `${ago} days`} ago`
		};
	}

	if (days <= SOON_DAYS && !subjectArchived) {
		return {
			kind: 'pill',
			hue: 'yellow',
			text: days === 0 ? `${verb} today` : `${verb} in ${days === 1 ? '1 day' : `${days} days`}`
		};
	}

	const date = readableDate(doc.expiresOn);
	return { kind: 'plain', text: width === 'wide' ? `${verb} ${date}` : date };
}

/** The labels a `document.type` code is shown under. Raw codes never surface. */
export const TYPE_LABELS: Record<string, string> = {
	contract: 'Contract',
	invoice: 'Invoice',
	receipt: 'Receipt',
	payslip: 'Payslip',
	bank_statement: 'Bank statement',
	insurance_policy: 'Insurance policy',
	claim: 'Claim',
	id_document: 'Identity document',
	certificate: 'Certificate',
	medical_record: 'Medical record',
	tax_document: 'Tax document',
	technical_plan: 'Technical plan',
	correspondence: 'Correspondence',
	warranty: 'Warranty',
	manual: 'Manual',
	other: 'Other'
};

export const typeLabel = (code: string): string => TYPE_LABELS[code] ?? TYPE_LABELS.other;

/** Which expiry bucket a document falls in. Presentation only. */
function expiryBucket(doc: DocRow, today: string): { key: string; label: string } {
	if (!doc.expiresOn) return { key: '4-none', label: 'No expiry' };
	const days = daysBetween(today, doc.expiresOn);
	if (days < 0) return { key: '1-expired', label: 'Expired' };
	if (days <= 30) return { key: '2-soon', label: 'Next 30 days' };
	return { key: '3-later', label: 'Later' };
}

/**
 * Split the list into groups for reading, never for filtering.
 *
 * A document belongs to exactly ONE group in any grouping — including `entity`,
 * where a document about two people would otherwise appear twice and be counted
 * twice. The first linked entity names the group; the rest are on the row.
 */
export function groupDocuments<T extends DocRow>(
	docs: T[],
	group: GroupKey,
	today: string
): DocGroup<T>[] {
	if (group === 'none') return [{ key: 'all', label: '', items: docs }];

	const groups = new Map<string, DocGroup<T>>();
	for (const doc of docs) {
		const { key, label } =
			group === 'type'
				? { key: doc.type, label: typeLabel(doc.type) }
				: group === 'entity'
					? doc.entities.length > 0
						? { key: doc.entities[0], label: doc.entities[0] }
						: { key: '￿', label: 'Not linked to anything' }
					: group === 'year'
						? (() => {
								const year = (doc.periodOn ?? doc.addedOn).slice(0, 4);
								return { key: year, label: year };
							})()
						: expiryBucket(doc, today);
		const existing = groups.get(key);
		if (existing) existing.items.push(doc);
		else groups.set(key, { key, label, items: [doc] });
	}

	return [...groups.values()].sort((a, b) =>
		group === 'year' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)
	);
}

/** Sorting is a separate control from grouping, and this is the whole of it. */
export function sortDocuments<T extends DocRow>(docs: T[], sort: SortKey): T[] {
	const copy = [...docs];
	if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
	if (sort === 'oldest') return copy.sort((a, b) => a.addedOn.localeCompare(b.addedOn));
	if (sort === 'expiry') {
		// Soonest first, and a document with no expiry is not "furthest away" —
		// it is a different thing, so it sorts to the end rather than to 9999.
		return copy.sort((a, b) => {
			if (!a.expiresOn && !b.expiresOn) return b.addedOn.localeCompare(a.addedOn);
			if (!a.expiresOn) return 1;
			if (!b.expiresOn) return -1;
			return a.expiresOn.localeCompare(b.expiresOn);
		});
	}
	return copy.sort((a, b) => b.addedOn.localeCompare(a.addedOn));
}

/** The row's second line: where it is filed, and what it is about. */
export function subLine(doc: DocRow): string {
	return [doc.shelfLabel, ...doc.entities].filter(Boolean).join(' · ');
}

/** What a search hit is labelled with. The vocabulary a person would use. */
export function matchLabel(matchedIn: string): string | null {
	if (matchedIn === 'contents') return 'Matched in contents';
	if (matchedIn === 'note') return 'Matched in note';
	return null;
}

/**
 * The three pieces of a snippet: before the term, the term, after it.
 *
 * Folded on both sides so `rezim` highlights `režim`, which is the whole point
 * of folding the query in the first place — a highlight that misses the word
 * the search matched reads as a bug in the search.
 */
export function splitSnippet(
	snippet: string,
	term: string
): { before: string; match: string; after: string } | null {
	const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	const folded = fold(snippet);
	const needle = fold(term.trim());
	if (!needle) return null;
	const at = folded.indexOf(needle);
	if (at < 0) return null;
	return {
		before: snippet.slice(0, at),
		match: snippet.slice(at, at + needle.length),
		after: snippet.slice(at + needle.length)
	};
}
