// SPDX-License-Identifier: AGPL-3.0-or-later
// Matching and deciding, kept pure so the same code answers both "what would
// this rule file?" during ingest and "what would this rule match?" in the
// editor's preview. There is deliberately no SQL translation of these rules —
// a second implementation would be free to drift from this one.

import { confidence } from '$lib/rules/confidence';

/** Starter evidence a learned rule begins with. See DEFAULT_AUTO_THRESHOLD. */
export const DEFAULT_RULE_PRIOR = 6;

/**
 * Confidence a rule needs before it files without asking. Paired with the prior
 * above: a clean rule at the prior sits at 0.6097 and files; one correction
 * takes it to 0.4869 and back into review.
 */
export const DEFAULT_AUTO_THRESHOLD = 0.5;

export type Condition =
	| { field: 'counterparty' | 'description'; op: 'contains'; value: string }
	| { field: 'counterAccount' | 'variableSymbol'; op: 'equals'; value: string }
	| {
			field: 'amount';
			op: 'between';
			min: string | null;
			max: string | null;
			/** Currency the bounds were authored in. Missing only on legacy rows. */
			currency?: string;
	  };

/** The conditions that carry a plain text value — everything but amount. */
export type ValueCondition = Extract<Condition, { value: string }>;

export interface RuleLike {
	id: string;
	enabled: boolean;
	conditions: Condition[];
	categoryId: string | null;
	tagIds: string[];
	acceptedCount: number;
	correctedCount: number;
	createdAt: string;
}

export interface RowLike {
	counterparty?: string | null;
	counterpartyAccount?: string | null;
	variableSymbol?: string | null;
	description?: string | null;
	amountMinor: bigint;
	currency?: string;
}

interface RuleDecision {
	kind: 'auto' | 'review';
	/** The winner, or the suggestion when kind is review. */
	categoryId: string | null;
	/** Union over every matching rule; tags cannot conflict. */
	tagIds: string[];
	/** Why it is held. Null when filed automatically. */
	reason: string | null;
	matched: { ruleId: string; categoryId: string | null }[];
}

/** Normalise merchant/counterparty text so rules match statement noise. */
export function normalise(raw: string): string {
	return raw
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // strip diacritics
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Whole-word match over normalised text. Both sides go through `normalise`:
 * the haystack has its diacritics stripped and its punctuation collapsed, so a
 * needle that keeps either can never match it. Rules the app writes itself
 * (learned ones) were already folded, but a hand-typed one was stored
 * with only `.toLowerCase()`, so every rule containing an accent or a hyphen
 * saved cleanly, listed cleanly, reported a confidence — and never once fired.
 * "Rohlík" missed ROHLIK.CZ, "T-Mobile" missed T-MOBILE, "Česká pošta" missed
 * CESKA POSTA. In a Czech household that is most of the rules a person writes.
 *
 * Normalising here rather than only on save also repairs rules already in the
 * database, and `normalise` is idempotent so pre-folded values are unaffected.
 *
 * The match is deliberately whole-word despite the operator being called
 * "contains": a counterparty can be as short as "pre", "o2" or "cez", and a
 * substring test would file every PREMIER, EXPRESS and similar under energy.
 * The cost is that "albert" does not match "ALBERTCZ" — write the rule as
 * "albertcz", which the editor's preview shows immediately.
 */
function containsWord(haystack: string | null | undefined, needle: string): boolean {
	if (!haystack) return false;
	const wanted = normalise(needle);
	if (!wanted) return false;
	return ` ${normalise(haystack)} `.includes(` ${wanted} `);
}

function conditionHolds(condition: Condition, row: RowLike): boolean {
	switch (condition.field) {
		case 'counterparty':
			return containsWord(row.counterparty, condition.value);
		case 'description':
			return containsWord(row.description, condition.value);
		case 'counterAccount':
			return (row.counterpartyAccount ?? '').replace(/\s/g, '') === condition.value;
		case 'variableSymbol':
			return (row.variableSymbol ?? '') === condition.value;
		case 'amount': {
			// Bounds are stored in the household base currency. Comparing those
			// minor units directly with (say) EUR cents would silently apply a
			// different economic threshold, so foreign rows do not match.
			if (
				!condition.currency ||
				!row.currency ||
				row.currency.toUpperCase() !== condition.currency.toUpperCase()
			) {
				return false;
			}
			// Magnitudes, so a bound reads the same either side of zero — the same
			// treatment the register's amount filter uses.
			const magnitude = row.amountMinor < 0n ? -row.amountMinor : row.amountMinor;
			if (condition.min !== null && magnitude < BigInt(condition.min)) return false;
			if (condition.max !== null && magnitude > BigInt(condition.max)) return false;
			return true;
		}
	}
}

export function ruleMatches(rule: RuleLike, row: RowLike): boolean {
	if (!rule.enabled) return false;
	if (rule.conditions.length === 0) return false;
	return rule.conditions.every((condition) => conditionHolds(condition, row));
}

/** Most confident first; ties go to the more specific rule, then the older one. */
function bestFirst(rules: RuleLike[]): RuleLike[] {
	return [...rules].sort((a, b) => {
		const byConfidence =
			confidence(b.acceptedCount, b.correctedCount) - confidence(a.acceptedCount, a.correctedCount);
		if (byConfidence !== 0) return byConfidence;
		const bySpecificity = b.conditions.length - a.conditions.length;
		if (bySpecificity !== 0) return bySpecificity;
		return a.createdAt < b.createdAt ? -1 : 1;
	});
}

export function decideWithRules(row: RowLike, rules: RuleLike[], threshold: number): RuleDecision {
	const matched = rules.filter((rule) => ruleMatches(rule, row));
	const tagIds = [...new Set(matched.flatMap((rule) => rule.tagIds))];
	const matchedRefs = matched.map((rule) => ({ ruleId: rule.id, categoryId: rule.categoryId }));

	const withCategory = bestFirst(matched.filter((rule) => rule.categoryId !== null));
	const categories = [...new Set(withCategory.map((rule) => rule.categoryId as string))];

	if (categories.length === 0) {
		return {
			kind: 'review',
			categoryId: null,
			tagIds,
			reason: 'first time seeing this counterparty',
			matched: matchedRefs
		};
	}

	const winner = withCategory[0];
	const suggestion = winner.categoryId as string;

	if (categories.length > 1) {
		return {
			kind: 'review',
			categoryId: suggestion,
			tagIds,
			reason: `rules disagree (${categories.join(' vs ')})`,
			matched: matchedRefs
		};
	}

	const trusted = confidence(winner.acceptedCount, winner.correctedCount) >= threshold;
	return {
		kind: trusted ? 'auto' : 'review',
		categoryId: suggestion,
		tagIds,
		reason: trusted ? null : 'rule not proven yet',
		matched: matchedRefs
	};
}

/**
 * Who earned what from a human's decision. A rule carrying no category had no
 * opinion to be right or wrong about, so it is not scored at all.
 */
export function scoreChanges(
	matched: { ruleId: string; categoryId: string | null }[],
	chosenCategoryId: string
): { ruleId: string; accepted: number; corrected: number }[] {
	return matched
		.filter((m) => m.categoryId !== null)
		.map((m) => ({
			ruleId: m.ruleId,
			accepted: m.categoryId === chosenCategoryId ? 1 : 0,
			corrected: m.categoryId === chosenCategoryId ? 0 : 1
		}));
}
