// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	groupNote,
	groupRules,
	matches,
	trustTone,
	type RuleRow
} from '../../src/lib/rules/grouping';

function rule(over: Partial<RuleRow> = {}): RuleRow {
	return {
		id: 'r1',
		name: 'Albert',
		enabled: true,
		confidencePct: 90,
		trusted: true,
		accepted: 9,
		corrected: 1,
		groupKey: 'living',
		groupLabel: 'Living',
		groupColor: '--series-living',
		...over
	};
}

describe('rule grouping', () => {
	it('collects rules under their category group', () => {
		const groups = groupRules([
			rule({ id: 'a' }),
			rule({ id: 'b' }),
			rule({ id: 'c', groupKey: 'bills', groupLabel: 'Bills', groupColor: '--series-bills' })
		]);
		expect(groups.map((g) => g.key).sort()).toEqual(['bills', 'living']);
		expect(groups.find((g) => g.key === 'living')?.rules).toHaveLength(2);
	});

	it('files a rule with no category under a name rather than a dash', () => {
		const [group] = groupRules([rule({ groupKey: null, groupLabel: null, groupColor: null })]);
		expect(group.label).toBe('No category');
		expect(group.color).toBe('--fg3');
	});

	it('orders the groups worst-first, so what is wrong is above the fold', () => {
		const groups = groupRules([
			rule({ id: 'ok', groupKey: 'a', groupLabel: 'A', confidencePct: 95 }),
			rule({
				id: 'bad',
				groupKey: 'b',
				groupLabel: 'B',
				confidencePct: 20,
				trusted: false
			})
		]);
		expect(groups[0].key).toBe('b');
	});

	it('averages confidence unweighted, so a rare bad rule still shows', () => {
		const [group] = groupRules([
			rule({ id: 'a', confidencePct: 100, accepted: 900, corrected: 0 }),
			rule({ id: 'b', confidencePct: 20, trusted: false, accepted: 0, corrected: 1 })
		]);
		expect(group.averagePct).toBe(60);
		expect(group.below).toBe(1);
		// The counts, unlike the average, ARE totals: they say what happened.
		expect(group.accepted).toBe(900);
		expect(group.corrected).toBe(1);
	});

	it('counts disabled rules in the header note', () => {
		const [group] = groupRules([
			rule({ id: 'a', enabled: false }),
			rule({ id: 'b', trusted: false, confidencePct: 30 })
		]);
		expect(group.disabled).toBe(1);
		expect(groupNote(group)).toBe('1 below the floor · 1 disabled');
	});

	it('says nothing about a group that is well', () => {
		const [group] = groupRules([rule()]);
		expect(groupNote(group)).toBe('');
	});

	it('drops a group the filter has emptied rather than showing it at zero', () => {
		expect(groupRules([rule()], 'below')).toEqual([]);
		expect(groupRules([rule()], 'disabled')).toEqual([]);
	});

	it('searches the rule name and its category', () => {
		const r = rule({ name: 'Albert Heijn' });
		expect(matches(r, 'all', 'heijn')).toBe(true);
		expect(matches(r, 'all', 'LIVING')).toBe(true);
		expect(matches(r, 'all', 'lidl')).toBe(false);
		// A blank box is not a filter.
		expect(matches(r, 'all', '   ')).toBe(true);
	});

	it('reads trust at the same three steps as the rest of the app', () => {
		expect(trustTone(80)).toBe('--green');
		expect(trustTone(79)).toBe('--yellow');
		expect(trustTone(50)).toBe('--yellow');
		expect(trustTone(49)).toBe('--red');
	});
});
