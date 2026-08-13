import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { category, categoryRule } from '$lib/server/db/schema';
import { CATEGORY_SEED } from '$lib/categories';

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

export interface RuleLike {
	id: string;
	matcherType: string; // counterparty | counterparty_account | variable_symbol
	pattern: string;
	categoryId: string;
}

export interface RowLike {
	counterparty?: string | null;
	counterpartyAccount?: string | null;
	variableSymbol?: string | null;
	amountMinor: bigint;
}

export type Decision =
	{ kind: 'auto'; categoryId: string; ruleId: string } | { kind: 'ambiguous'; reason: string };

/**
 * Deterministic decision: exact match on counter-account and variable symbol,
 * whole-word containment on the normalised counterparty text. No match or a
 * conflicting match surfaces the row for review — never a silent guess.
 */
export function decide(row: RowLike, rules: RuleLike[]): Decision {
	const matches: RuleLike[] = [];

	const accountKey = row.counterpartyAccount?.replace(/\s/g, '') ?? '';
	const vs = row.variableSymbol ?? '';
	const text = row.counterparty ? ` ${normalise(row.counterparty)} ` : '';

	for (const rule of rules) {
		if (rule.matcherType === 'counterparty_account' && accountKey && rule.pattern === accountKey) {
			matches.push(rule);
		} else if (rule.matcherType === 'variable_symbol' && vs && rule.pattern === vs) {
			matches.push(rule);
		} else if (rule.matcherType === 'counterparty' && text && text.includes(` ${rule.pattern} `)) {
			matches.push(rule);
		}
	}

	const categories = [...new Set(matches.map((m) => m.categoryId))];
	if (categories.length === 1) {
		return { kind: 'auto', categoryId: categories[0], ruleId: matches[0].id };
	}
	if (categories.length > 1) {
		return { kind: 'ambiguous', reason: `two rules disagree (${categories.join(' vs ')})` };
	}
	if (!row.counterparty && !row.counterpartyAccount) {
		return { kind: 'ambiguous', reason: 'no counterparty to match on' };
	}
	return { kind: 'ambiguous', reason: 'first time seeing this counterparty' };
}

/** Store the rule a user correction implies, so next time is automatic. */
export async function learnRule(
	row: RowLike,
	categoryId: string,
	provenance: 'seeded' | 'learned' = 'learned'
): Promise<void> {
	let matcherType: string;
	let pattern: string;
	if (row.counterpartyAccount) {
		matcherType = 'counterparty_account';
		pattern = row.counterpartyAccount.replace(/\s/g, '');
	} else if (row.counterparty) {
		matcherType = 'counterparty';
		pattern = normalise(row.counterparty);
	} else if (row.variableSymbol) {
		matcherType = 'variable_symbol';
		pattern = row.variableSymbol;
	} else {
		return; // nothing stable to key a rule on
	}
	await db
		.insert(categoryRule)
		.values({ id: randomUUID(), matcherType, pattern, categoryId, provenance })
		.onConflictDoUpdate({
			target: [categoryRule.matcherType, categoryRule.pattern],
			set: { categoryId, provenance }
		});
}

// Common Czech/Polish merchants so a fresh install starts useful. Patterns are
// normalised counterparty substrings.
const SEED_RULES: Array<[string, string]> = [
	['albert', 'groceries'],
	['lidl', 'groceries'],
	['kaufland', 'groceries'],
	['billa', 'groceries'],
	['tesco', 'groceries'],
	['penny', 'groceries'],
	['globus', 'groceries'],
	['rohlik', 'groceries'],
	['kosik', 'groceries'],
	['biedronka', 'groceries'],
	['zabka', 'groceries'],
	['mcdonald', 'eating-out'],
	['kfc', 'eating-out'],
	['starbucks', 'eating-out'],
	['bolt food', 'eating-out'],
	['wolt', 'eating-out'],
	['foodora', 'eating-out'],
	['netflix', 'internet-phone'],
	['spotify', 'internet-phone'],
	['o2', 'internet-phone'],
	['vodafone', 'internet-phone'],
	['t mobile', 'internet-phone'],
	['upc', 'internet-phone'],
	['cez', 'energy'],
	['pre', 'energy'],
	['innogy', 'energy'],
	['shell', 'fuel-tolls'],
	['omv', 'fuel-tolls'],
	['benzina', 'fuel-tolls'],
	['orlen', 'fuel-tolls'],
	['easypark', 'fuel-tolls'],
	['bolt', 'fuel-tolls'],
	['uber', 'fuel-tolls'],
	['csob leasing', 'car-loan'],
	['financni urad', 'taxes-fees'],
	['cssz', 'other-income'],
	['xtb', 'brokerage'],
	['degiro', 'brokerage'],
	['zooplus', 'everything-else'],
	['alza', 'everything-else'],
	['dm drogerie', 'everything-else'],
	['ikea', 'everything-else']
];

/** Idempotent: seeds categories and starter rules on boot. */
export async function seedCategories(): Promise<void> {
	for (const def of CATEGORY_SEED) {
		await db.insert(category).values(def).onConflictDoNothing();
	}
	for (const [pattern, categoryId] of SEED_RULES) {
		await db
			.insert(categoryRule)
			.values({
				id: randomUUID(),
				matcherType: 'counterparty',
				pattern,
				categoryId,
				provenance: 'seeded'
			})
			.onConflictDoNothing();
	}
}
