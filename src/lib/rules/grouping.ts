// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Rules screen's arithmetic, kept pure: no DOM, no Svelte, no database.
 *
 * A household that has been filing for a year has dozens of rules, and the
 * screen used to be all of them in one flat list behind a pager — which meant
 * the question people actually arrive with ("which of my rules is wrong?")
 * was answered by reading every row. Grouping by category answers it in the
 * headers: a group whose average trust is red has a rule in it worth opening.
 *
 * Written here rather than in the component for the same reason `layout.ts`
 * is: every subtle bug on that screen will be a bug in this file, and there is
 * no browser suite to catch it in a rendered page.
 */

/** One rule as the screen needs it. A subset of what the loader returns. */
export interface RuleRow {
	id: string;
	name: string;
	enabled: boolean;
	confidencePct: number;
	trusted: boolean;
	accepted: number;
	corrected: number;
	/** The category group this rule files into; null for a rule that only tags. */
	groupKey: string | null;
	groupLabel: string | null;
	/** A CSS custom property name, e.g. `--series-housing`. Never a literal. */
	groupColor: string | null;
}

export interface RuleGroup<T extends RuleRow = RuleRow> {
	key: string;
	label: string;
	color: string;
	rules: T[];
	/** Rules that would not file on their own — the reason to open the group. */
	below: number;
	disabled: number;
	/**
	 * The mean confidence across the group, rounded.
	 *
	 * A plain mean rather than one weighted by how often each rule fired: the
	 * bar answers "can I trust this group", and a single badly-behaved rule
	 * being rare is exactly the thing a weighted mean would hide.
	 */
	averagePct: number;
	accepted: number;
	corrected: number;
}

/** Rules that only tag, filed under a name that says so rather than "—". */
export const UNFILED_GROUP = {
	key: '',
	label: 'No category',
	color: '--fg3'
} as const;

export type RuleFilter = 'all' | 'below' | 'disabled';

/** Does this rule survive the chip that is lit, and the search box? */
export function matches(rule: RuleRow, filter: RuleFilter, query: string): boolean {
	if (filter === 'below' && rule.trusted) return false;
	if (filter === 'disabled' && rule.enabled) return false;
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	return (
		rule.name.toLowerCase().includes(needle) ||
		(rule.groupLabel ?? '').toLowerCase().includes(needle)
	);
}

/**
 * Group the rules that survive the filter, ordered worst-first.
 *
 * Worst-first for the same reason the flat list was most-corrected-first: the
 * groups holding something wrong are the ones somebody came to this screen
 * for, and they should not be below the fold. An empty group never appears —
 * a category with no rules is not a thing this screen has anything to say
 * about.
 */
export function groupRules<T extends RuleRow>(
	rules: readonly T[],
	filter: RuleFilter = 'all',
	query = ''
): RuleGroup<T>[] {
	// Generic over the row so the loader's extra fields — the conditions a
	// person reads, the category name, the provenance — survive the grouping.
	// Narrowing to `RuleRow` here would mean the screen re-joining them by id.
	const groups = new Map<string, RuleGroup<T>>();
	for (const rule of rules) {
		if (!matches(rule, filter, query)) continue;
		const key = rule.groupKey ?? UNFILED_GROUP.key;
		let group = groups.get(key);
		if (!group) {
			group = {
				key,
				label: rule.groupLabel ?? UNFILED_GROUP.label,
				color: rule.groupColor ?? UNFILED_GROUP.color,
				rules: [],
				below: 0,
				disabled: 0,
				averagePct: 0,
				accepted: 0,
				corrected: 0
			};
			groups.set(key, group);
		}
		group.rules.push(rule);
		if (!rule.trusted) group.below += 1;
		if (!rule.enabled) group.disabled += 1;
		group.accepted += rule.accepted;
		group.corrected += rule.corrected;
	}

	for (const group of groups.values()) {
		const total = group.rules.reduce((sum, r) => sum + r.confidencePct, 0);
		group.averagePct = Math.round(total / group.rules.length);
	}

	return [...groups.values()].sort(
		(a, b) => b.below - a.below || a.averagePct - b.averagePct || a.label.localeCompare(b.label)
	);
}

/**
 * The bar's colour, which is the whole point of the header row.
 *
 * The same three steps the rest of the app uses for a proportion that is
 * either fine, worth a look, or wrong — see the coverage ribbon and the
 * retirement gauge, which read at the same thresholds.
 */
export function trustTone(pct: number): string {
	if (pct >= 80) return '--green';
	if (pct >= 50) return '--yellow';
	return '--red';
}

/** "3 below the floor · 1 disabled", or nothing at all when the group is well. */
export function groupNote(group: RuleGroup<RuleRow>): string {
	const parts: string[] = [];
	if (group.below > 0) parts.push(`${group.below} below the floor`);
	if (group.disabled > 0) parts.push(`${group.disabled} disabled`);
	return parts.join(' · ');
}
