// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The decisions the Documents screen makes, taken out of the markup.
 *
 * There is no browser test suite in this repository, by design, so anything
 * that has to be held by automation has to be reachable without a page. That is
 * why the expiry treatment, the grouping and the sorting live here as pure
 * functions with a test each, and the component that uses them is thin enough
 * to verify by looking at it.
 */

/**
 * How an expiry reads on a row.
 *
 * Two layers. The QUIET hue says which channel the date is on — `--blue` when
 * an obligation stands behind it (`renews`: file the replacement; `due`: pay),
 * `--purple` when nothing does (`expires`: it simply stops). The kind of
 * obligation lives in the word, where there is unlimited room and no collision.
 *
 * A fired THRESHOLD replaces the verb hue rather than tinting it: `--yellow`
 * inside the window, `--red` once passed while the subject is still active. A
 * pill cannot be two colours, and the one a person needs is the warning.
 *
 * A document with no date is a pill too — `added 2 Nov 2024` — but an OUTLINE
 * one: same shape as its neighbours so the column reads as a column, and no
 * fill, because there is no logic behind it and fifty filled pills saying
 * nothing would be the loudest thing on the screen.
 */
export type ExpiryTreatment =
	| { kind: 'outline'; text: string }
	| { kind: 'pill'; hue: 'blue' | 'purple' | 'yellow' | 'red'; text: string };

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
/** Money owed two months out is rarely worth amber; a month is. */
const DUE_SOON_DAYS = 30;
/**
 * How long a lapsed `expires` stays red. Nothing replaces it and nothing is
 * owed, so after a month the alarm has said all it can and the date is history.
 * `renews` and `due` stay red until the date changes or the subject is
 * archived: nothing can know the replacement was filed or the bill was paid.
 */
const EXPIRED_RED_DAYS = 30;

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

/** The channel a verb is on: an obligation stands behind the date, or not. */
function quietHue(verb: string): 'blue' | 'purple' {
	return verb === 'expires' ? 'purple' : 'blue';
}

/** What a passed date says. Never "renewed": nothing knows that it was. */
function passed(verb: string, ago: string): string {
	if (verb === 'renews') return `renewal due ${ago} ago`;
	if (verb === 'due') return `overdue ${ago}`;
	return `expired ${ago} ago`;
}

/** The past tense, for a date that is history rather than a state. */
function pastTense(verb: string): string {
	if (verb === 'renews') return 'renewal was due';
	if (verb === 'due') return 'was due';
	return 'expired';
}

/**
 * How a document's expiry reads, if it has one.
 *
 * Passed on an ARCHIVED subject: the threshold override lifts and the verb hue
 * returns with the date. A sold car's lapsed insurance is history — it must not
 * be missed, and it must not be an alarm.
 *
 * A2: below 1200px the verb is shed only in the quiet state. "due" and
 * "renews" change what a person has to do, and the urgent rows are few enough
 * to afford the twelve pixels; the quiet ones are not.
 */
export function expiryTreatment(
	doc: { expiresOn: string | null; expiryVerb: string; addedOn?: string },
	subjectArchived: boolean,
	today: string,
	width: RowWidth = 'wide'
): ExpiryTreatment | null {
	if (!doc.expiresOn) {
		return doc.addedOn ? { kind: 'outline', text: `added ${readableDate(doc.addedOn)}` } : null;
	}
	const days = daysBetween(today, doc.expiresOn);
	const verb = doc.expiryVerb;
	const date = readableDate(doc.expiresOn);

	if (days < 0) {
		const ago = Math.abs(days);
		const stillRed = verb !== 'expires' || ago <= EXPIRED_RED_DAYS;
		if (subjectArchived || !stillRed) {
			// History: the verb hue, with the date rather than a count. "6 days
			// ago" invites action on something nobody is acting on any more.
			return { kind: 'pill', hue: quietHue(verb), text: `${pastTense(verb)} ${date}` };
		}
		return {
			kind: 'pill',
			hue: 'red',
			text: passed(verb, ago === 1 ? '1 day' : `${ago} days`)
		};
	}

	const window = verb === 'due' ? DUE_SOON_DAYS : SOON_DAYS;
	if (days <= window && !subjectArchived) {
		return {
			kind: 'pill',
			hue: 'yellow',
			text: days === 0 ? `${verb} today` : `${verb} in ${days === 1 ? '1 day' : `${days} days`}`
		};
	}

	return { kind: 'pill', hue: quietHue(verb), text: width === 'wide' ? `${verb} ${date}` : date };
}

/**
 * The three hues a documents CARD can paint a row's second line.
 *
 * A card has one line to say everything the Documents screen says with a pill,
 * so the four-hue vocabulary collapses to the part that changes what a person
 * does: red for a date that has passed, yellow for one inside its window,
 * otherwise the quiet grey every other row already has. The verb channel
 * (blue vs purple) is not carried here — an unstyled `--fg3` line reads as one
 * column, and two more hues on a six-row card would say a difference the card
 * has no room to explain.
 */
export type ExpiryTone = 'expired' | 'soon' | 'quiet';

/**
 * How a document's expiry reads on a record's card.
 *
 * Deliberately a projection of `expiryTreatment` rather than a second rule.
 * The property card used to say "anything with a date is amber, a passed date
 * is red", which made a lease renewing in three years the same colour as one
 * renewing next week; the Documents screen has known better since v0.7.0 and
 * this is how a card borrows that knowledge instead of restating it.
 *
 * `subjectArchived` is false by design: a card belongs to ONE record and shows
 * the paper filed against it, so there is no subject in the picture whose
 * archiving could turn an alarm into history.
 */
export function documentExpiryTone(
	doc: { expiresOn: string | null; expiryVerb: string; addedOn?: string },
	today: string
): ExpiryTone {
	const treatment = expiryTreatment(doc, false, today);
	if (treatment?.kind !== 'pill') return 'quiet';
	if (treatment.hue === 'red') return 'expired';
	return treatment.hue === 'yellow' ? 'soon' : 'quiet';
}

/**
 * The labels the SHIPPED types are shown under. Raw codes never surface.
 *
 * A household's own types are not here — they are rows, loaded per screen — so
 * anything drawing a type takes the loaded labels and falls back to these. The
 * fallback matters: a type removed while a page was open would otherwise draw
 * its raw key at the one moment somebody is looking at it.
 */
export const TYPE_LABELS: Record<string, string> = {
	contract: 'Contract',
	invoice: 'Invoice',
	receipt: 'Receipt',
	payslip: 'Payslip',
	bank_statement: 'Bank statement',
	broker_report: 'Broker report',
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

export const typeLabel = (code: string, labels: Record<string, string> = TYPE_LABELS): string =>
	labels[code] ?? TYPE_LABELS[code] ?? TYPE_LABELS.other;

/** The label map a screen draws with: what it loaded, over what ships. */
export function typeLabels(
	rows: readonly { key: string; label: string }[]
): Record<string, string> {
	return { ...TYPE_LABELS, ...Object.fromEntries(rows.map((r) => [r.key, r.label])) };
}

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
	today: string,
	/** This household's labels, so a type it added heads its own group by name. */
	labels: Record<string, string> = TYPE_LABELS
): DocGroup<T>[] {
	if (group === 'none') return [{ key: 'all', label: '', items: docs }];

	const groups = new Map<string, DocGroup<T>>();
	for (const doc of docs) {
		const { key, label } =
			group === 'type'
				? { key: doc.type, label: typeLabel(doc.type, labels) }
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

/**
 * Which of the three result-row shapes a hit takes.
 *
 * `metadata` is a plain row with the term highlighted in the name. The other
 * two carry a snippet behind a left rule and align to the TOP of the row rather
 * than the middle, because a two-line row centred against a one-line badge
 * reads as a misalignment rather than as more information.
 */
export type RowVariant = 'metadata' | 'content' | 'note';

export function rowVariant(match: { matchedIn: string } | null | undefined): RowVariant {
	if (match?.matchedIn === 'contents') return 'content';
	if (match?.matchedIn === 'note') return 'note';
	return 'metadata';
}

/** `412 kB`, `1.2 MB` — a size a person reads, not a byte count. */
export function readableSize(bytes: number | null): string | null {
	if (bytes === null) return null;
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} kB`;
	return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Which honesty card the search should show, if any.
 *
 * Four states, and they are not interchangeable: "nothing matched" and "nothing
 * matched YET" are different facts about the same empty screen, and a person
 * told the first when the second is true concludes the search is broken.
 */
export type HonestyState = 'none' | 'empty' | 'preparing' | 'archived-only' | 'not-searchable';

export function honestyState(
	query: string,
	hitCount: number,
	honesty: { pending: number; notSearchable: number; archivedOnly: number } | null
): HonestyState {
	if (!query || !honesty) return 'none';
	if (hitCount === 0) {
		if (honesty.archivedOnly > 0) return 'archived-only';
		if (honesty.pending > 0) return 'preparing';
		return 'empty';
	}
	// Results, but an incomplete corpus behind them — worth saying, quietly,
	// under the results rather than instead of them.
	return honesty.notSearchable > 0 ? 'not-searchable' : 'none';
}

/**
 * What a collapsed group says about itself.
 *
 * The Tax table's rows carry their figures closed; a group row here carries the
 * three things a person would open it to find out — how many, how many need
 * attention, and when the next one falls due. `soon` counts the amber window,
 * `expired` the red; a lapsed expiry on an archived subject counts as neither,
 * because it is history rather than a state.
 */
export interface GroupSummary {
	count: number;
	expired: number;
	soon: number;
	/** The nearest expiry still ahead, as an ISO date, or null. */
	nextExpiry: string | null;
}

/**
 * The four fields the summary actually reads.
 *
 * A whole `DocRow` was the parameter until the Overview's Paper panel wanted
 * the same three numbers over the whole archive: making it select eleven
 * columns it would never look at, and invent a shelf label per row, only to
 * satisfy a type is a cost paid for nothing. The rest of the row is the list
 * screen's business.
 */
export type ExpiringRow = Pick<DocRow, 'expiresOn' | 'expiryVerb' | 'addedOn' | 'subjectArchived'>;

export function groupSummary(items: ExpiringRow[], today: string): GroupSummary {
	let expired = 0;
	let soon = 0;
	let nextExpiry: string | null = null;
	for (const doc of items) {
		const treatment = expiryTreatment(doc, doc.subjectArchived, today);
		if (treatment?.kind === 'pill' && treatment.hue === 'red') expired++;
		if (treatment?.kind === 'pill' && treatment.hue === 'yellow') soon++;
		if (doc.expiresOn && doc.expiresOn >= today && (!nextExpiry || doc.expiresOn < nextExpiry)) {
			nextExpiry = doc.expiresOn;
		}
	}
	return { count: items.length, expired, soon, nextExpiry };
}

/**
 * One choice in the "what it is about" filter.
 *
 * The heading travels with the option rather than being worked out from the
 * name: which kind a record is is a fact the registry knows and a string does
 * not, and "Alza 2026-03-04" beside "Robert" in one flat list is a filter
 * nobody can read.
 */
export interface AboutOption {
	id: string;
	name: string;
	/** A second line where the name alone is ambiguous — an amount, a filer. */
	meta?: string;
	/** Plural, from the registry: the heading this option sits under. */
	groupLabel: string;
	/** How many documents on the shelf in view this choice would leave. */
	count: number;
}

export interface AboutOptionGroup<T extends { groupLabel: string }> {
	label: string;
	options: T[];
}

/**
 * The filter's options, under the heading each kind belongs to.
 *
 * Order is taken as given rather than re-sorted here: the load emits them in
 * registry order and then by how many documents each would leave, and a second
 * opinion about order in the view is how two screens end up disagreeing about
 * which record comes first.
 */
export function groupAboutOptions<T extends { groupLabel: string }>(
	options: T[]
): AboutOptionGroup<T>[] {
	const groups: AboutOptionGroup<T>[] = [];
	for (const option of options) {
		const existing = groups.find((group) => group.label === option.groupLabel);
		if (existing) existing.options.push(option);
		else groups.push({ label: option.groupLabel, options: [option] });
	}
	return groups;
}

/** `Alza 2026-03-04 · −1 234,50 CZK · 2` — name, what tells it apart, count. */
export function aboutOptionLabel(option: { name: string; meta?: string; count: number }): string {
	return [option.name, option.meta, String(option.count)].filter(Boolean).join(' · ');
}

/**
 * One subject as the rail draws it.
 *
 * `household` travels with the row rather than being worked out from the name:
 * the seeded subject may be renamed to anything, and a view that recognised it
 * by the word "Household" would offer to archive the household the first time
 * a Czech household called it "Domácnost".
 */
export interface RailSubject {
	id: string;
	name: string;
	emoji: string;
	archived: boolean;
	household: boolean;
	/** How much paper is filed under it, behind the reader's own read rule. */
	count: number;
}

/**
 * Which subjects the rail draws, and how many it is keeping back.
 *
 * Archived subjects appear only under "Include archived subjects" — the same
 * `?archived=1` that governs the list, so the rail and the documents beside it
 * are never showing two different scopes. `hidden` is what the rail says out
 * loud, because a subject that was archived and then vanished from the only
 * screen that can un-archive it is a one-way door.
 *
 * The household leads, because it is the one subject every document may belong
 * to; the rest are by name, folded, so "dog" and "Dog" sort together; archived
 * ones sit last, where a dimmed row is a footnote rather than a gap in the
 * middle of the list.
 */
export function railSubjects<T extends { archived: boolean; household: boolean; name: string }>(
	subjects: T[],
	includeArchived: boolean
): { shown: T[]; hidden: number } {
	const hidden = subjects.filter((s) => s.archived).length;
	const shown = subjects
		.filter((s) => includeArchived || !s.archived)
		.sort(
			(a, b) =>
				Number(a.archived) - Number(b.archived) ||
				Number(b.household) - Number(a.household) ||
				a.name.localeCompare(b.name)
		);
	return { shown, hidden: includeArchived ? 0 : hidden };
}
