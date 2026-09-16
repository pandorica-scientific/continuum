// SPDX-License-Identifier: AGPL-3.0-or-later
import { asOptionalRowId, asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { rule, ruleTag, settings, tag } from '$lib/server/db/schema';
import { autoThreshold, previewMatches } from '$lib/server/rules';
import { pairAndCategorise } from '$lib/server/import/pairing-run';
import { mutateRuleAndReplay, saveRuleDefinition } from '$lib/server/rules/mutations';
import { confidence } from '$lib/rules/confidence';
import { DEFAULT_RULE_PRIOR, normalise, type Condition } from '$lib/rules/match';
import { loadCategoryGroups } from '$lib/server/categorize/groups';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

const FIELD_LABELS: Record<string, string> = {
	counterparty: 'Counterparty',
	description: 'Note',
	counterAccount: 'Counter-account',
	variableSymbol: 'Variable symbol',
	amount: 'Amount'
};

/** A condition as a person would read it. */
function describe(condition: Condition, currency: string): string {
	if (condition.field === 'amount') {
		const authoredCurrency = condition.currency ?? currency;
		const unit = displayCurrency(authoredCurrency);
		const from = condition.min ? formatMinor(BigInt(condition.min), authoredCurrency) : null;
		const to = condition.max ? formatMinor(BigInt(condition.max), authoredCurrency) : null;
		if (from && to) return `Amount between ${from} and ${to} ${unit}`;
		if (from) return `Amount at least ${from} ${unit}`;
		if (to) return `Amount at most ${to} ${unit}`;
		return 'Amount (no bounds)';
	}
	const verb = condition.op === 'contains' ? 'contains' : 'is';
	return `${FIELD_LABELS[condition.field]} ${verb} “${condition.value}”`;
}

export const load: PageServerLoad = async ({ url }) => {
	const [rows, categories, tags, threshold, base] = await Promise.all([
		db.select().from(rule),
		loadCategories(),
		db.select().from(tag).orderBy(tag.name),
		autoThreshold(),
		getBaseCurrency()
	]);
	const tagRows = await db.select().from(ruleTag);

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	const tagName = new Map(tags.map((t) => [t.id, t.name]));

	// A rule's colour comes from its category's GROUP (`categoryGroup.colorToken`),
	// so the swatch matches whichever screen groups on the same axis.
	const groups = await loadCategoryGroups();
	const groupByKey = new Map(groups.map((g) => [g.key, g]));
	const groupOfCategory = new Map(categories.map((c) => [c.id, groupByKey.get(c.groupKey)]));

	return {
		/**
		 * Prefill from a transaction's "Make a rule" link (counterparty + category
		 * from the URL) so the editor opens describing the row you came from.
		 * These are only form defaults — save still validates what is submitted.
		 */
		prefill:
			url.searchParams.has('counterparty') || url.searchParams.has('category')
				? {
						counterparty: url.searchParams.get('counterparty')?.trim() || null,
						categoryId: url.searchParams.get('category')?.trim() || null
					}
				: null,
		baseCurrency: displayCurrency(base),
		thresholdPct: Math.round(threshold * 100),
		rules: rows
			.map((r) => {
				const score = confidence(r.acceptedCount, r.correctedCount);
				// Seeded/learned rules carry a starter prior inside acceptedCount so they
				// file from day one, but the numbers *shown* are only what a human did.
				const priorShare = r.provenance === 'manual' ? 0 : DEFAULT_RULE_PRIOR;
				return {
					id: r.id,
					name: r.name,
					enabled: r.enabled,
					provenance: r.provenance,
					conditions: (r.conditions as Condition[]).map((c) => describe(c, base)),
					category: r.categoryId ? (categoryName.get(r.categoryId) ?? null) : null,
					tags: tagRows
						.filter((t) => t.ruleId === r.id)
						.map((t) => tagName.get(t.tagId) ?? '')
						.filter(Boolean),
					groupKey: r.categoryId ? (groupOfCategory.get(r.categoryId)?.key ?? null) : null,
					groupLabel: r.categoryId ? (groupOfCategory.get(r.categoryId)?.label ?? null) : null,
					groupColor: r.categoryId ? (groupOfCategory.get(r.categoryId)?.colorToken ?? null) : null,
					accepted: Math.max(0, r.acceptedCount - priorShare),
					corrected: r.correctedCount,
					startsTrusted: priorShare > 0,
					confidencePct: Math.round(score * 100),
					trusted: score >= threshold
				};
			})
			// Most-corrected first: a rule that keeps being overridden is the one
			// worth looking at.
			.sort((a, b) => b.corrected - a.corrected || a.name.localeCompare(b.name)),
		categories: groups
			.map((group) => ({
				key: group.key,
				label: group.label,
				items: categories.filter((c) => c.groupKey === group.key)
			}))
			.filter((g) => g.items.length > 0),
		knownTags: tags.map((t) => ({ id: t.id, name: t.name }))
	};
};

/** Form fields → conditions, or null when a value will not parse. */
async function conditionsFromForm(form: FormData): Promise<Condition[] | null> {
	const fields = form.getAll('conditionField').map(String);
	const values = form.getAll('conditionValue').map(String);
	const mins = form.getAll('conditionMin').map(String);
	const maxes = form.getAll('conditionMax').map(String);
	const currency = await getBaseCurrency();

	const out: Condition[] = [];
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (field === 'amount') {
			const min = mins[i]?.trim();
			const max = maxes[i]?.trim();
			if (!min && !max) continue;
			try {
				out.push({
					field: 'amount',
					op: 'between',
					min: min ? parseAmountToMinor(min, currency).toString() : null,
					max: max ? parseAmountToMinor(max, currency).toString() : null,
					currency
				});
			} catch {
				return null;
			}
			continue;
		}
		const value = values[i]?.trim();
		if (!value) continue;
		if (field === 'counterparty' || field === 'description') {
			// Store the folded form: the matcher compares against diacritic-stripped,
			// punctuation-collapsed text, so `.toLowerCase()` alone would not match.
			out.push({ field, op: 'contains', value: normalise(value) });
		} else if (field === 'counterAccount' || field === 'variableSymbol') {
			out.push({ field, op: 'equals', value: value.replace(/\s/g, '') });
		}
	}
	return out;
}

export const actions: Actions = {
	/**
	 * Move the confidence floor. Clamped rather than validated into an error: a
	 * slider cannot produce out-of-range values, and a hand-posted 900 should
	 * land at the ceiling rather than fail.
	 */
	threshold: async ({ request }) => {
		const form = await request.formData();
		const pct = Number(form.get('pct'));
		if (!Number.isFinite(pct)) return fail(400, { message: 'That is not a percentage.' });
		const value = Math.min(95, Math.max(5, Math.round(pct))) / 100;
		await db
			.insert(settings)
			.values({ key: 'rules.autoThreshold', value })
			.onConflictDoUpdate({ target: settings.key, set: { value } });
		// Everything already filed keeps its filing; the floor decides what files
		// NEXT, which is what the note under the slider says.
		return { ok: true };
	},

	toggle: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const changed = await mutateRuleAndReplay(async (tx) => {
			const rows = await tx
				.update(rule)
				.set({ enabled: sql`not ${rule.enabled}` })
				.where(eq(rule.id, id))
				.returning({ id: rule.id });
			return rows[0]?.id ?? null;
		}, pairAndCategorise);
		if (changed === null) return fail(404, { message: 'Rule not found.' });
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const changed = await mutateRuleAndReplay(async (tx) => {
			const rows = await tx.delete(rule).where(eq(rule.id, id)).returning({ id: rule.id });
			return rows[0]?.id ?? null;
		}, pairAndCategorise);
		if (changed === null) return fail(404, { message: 'Rule not found.' });
		return { ok: true };
	},

	preview: async ({ request }) => {
		const form = await request.formData();
		const conditions = await conditionsFromForm(form);
		if (conditions === null) return fail(400, { message: 'An amount will not parse.' });
		const result = await previewMatches(conditions);
		const currency = await getBaseCurrency();
		return {
			preview: {
				count: result.count,
				rows: result.rows.map((r) => ({
					id: r.id,
					date: r.date,
					merchant: r.merchant,
					amount: `${formatMinor(r.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`
				})),
				currency: displayCurrency(currency)
			}
		};
	},

	save: async ({ request }) => {
		const form = await request.formData();
		// Optional: no id means "create", which is not the same as an id that
		// cannot exist — and the nil uuid is truthy, so `|| uuidv7()` would not fire.
		const id = asOptionalRowId(form.get('id')) ?? uuidv7();
		const name = String(form.get('name') ?? '').trim();
		const categoryId = String(form.get('categoryId') ?? '') || null;
		const tagNames = String(form.get('tagNames') ?? '')
			.split(',')
			.map((n) => n.trim())
			.filter(Boolean);

		const conditions = await conditionsFromForm(form);
		if (conditions === null) return fail(400, { message: 'An amount will not parse.' });
		if (conditions.length === 0)
			return fail(400, { message: 'A rule needs at least one condition.' });
		if (!name) return fail(400, { message: 'Give the rule a name.' });

		await saveRuleDefinition({ id, name, conditions, categoryId, tagNames }, pairAndCategorise);
		return { ok: true };
	}
};
