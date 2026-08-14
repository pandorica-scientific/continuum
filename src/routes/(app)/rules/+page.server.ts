import { fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { category, rule, ruleTag, tag } from '$lib/server/db/schema';
import { autoThreshold, previewMatches } from '$lib/server/rules';
import { pairAndCategorise } from '$lib/server/import/ingest';
import { upsertTag } from '$lib/server/tags';
import { confidence } from '$lib/rules/confidence';
import { type Condition } from '$lib/rules/match';
import { CATEGORY_GROUPS } from '$lib/categories';
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
		const from = condition.min ? formatMinor(BigInt(condition.min), currency) : null;
		const to = condition.max ? formatMinor(BigInt(condition.max), currency) : null;
		if (from && to) return `Amount between ${from} and ${to}`;
		if (from) return `Amount at least ${from}`;
		if (to) return `Amount at most ${to}`;
		return 'Amount (no bounds)';
	}
	const verb = condition.op === 'contains' ? 'contains' : 'is';
	return `${FIELD_LABELS[condition.field]} ${verb} “${condition.value}”`;
}

export const load: PageServerLoad = async () => {
	const [rows, categories, tags, threshold, base] = await Promise.all([
		db.select().from(rule),
		db.select().from(category).orderBy(category.groupKey, category.sort),
		db.select().from(tag).orderBy(tag.name),
		autoThreshold(),
		getBaseCurrency()
	]);
	const tagRows = await db.select().from(ruleTag);

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	const tagName = new Map(tags.map((t) => [t.id, t.name]));

	return {
		baseCurrency: displayCurrency(base),
		thresholdPct: Math.round(threshold * 100),
		rules: rows
			.map((r) => {
				const score = confidence(r.acceptedCount, r.correctedCount);
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
					accepted: r.acceptedCount,
					corrected: r.correctedCount,
					confidencePct: Math.round(score * 100),
					trusted: score >= threshold
				};
			})
			// Most-corrected first: a rule that keeps being overridden is the one
			// worth looking at.
			.sort((a, b) => b.corrected - a.corrected || a.name.localeCompare(b.name)),
		categories: CATEGORY_GROUPS.map((group) => ({
			key: group.key,
			label: group.label,
			items: categories.filter((c) => c.groupKey === group.key)
		})).filter((g) => g.items.length > 0),
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
					max: max ? parseAmountToMinor(max, currency).toString() : null
				});
			} catch {
				return null;
			}
			continue;
		}
		const value = values[i]?.trim();
		if (!value) continue;
		if (field === 'counterparty' || field === 'description') {
			out.push({ field, op: 'contains', value: value.toLowerCase() });
		} else if (field === 'counterAccount' || field === 'variableSymbol') {
			out.push({ field, op: 'equals', value: value.replace(/\s/g, '') });
		}
	}
	return out;
}

export const actions: Actions = {
	toggle: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const rows = await db.select().from(rule).where(eq(rule.id, id));
		if (!rows[0]) return fail(404, { message: 'Rule not found.' });
		await db.update(rule).set({ enabled: !rows[0].enabled }).where(eq(rule.id, id));
		await pairAndCategorise();
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		await db.delete(rule).where(eq(rule.id, String(form.get('id') ?? '')));
		await pairAndCategorise();
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
		const id = String(form.get('id') ?? '') || randomUUID();
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

		const existing = await db.select().from(rule).where(eq(rule.id, id));
		if (existing[0]) {
			await db.update(rule).set({ name, conditions, categoryId }).where(eq(rule.id, id));
		} else {
			// A hand-written rule starts from no evidence and earns its confidence.
			await db.insert(rule).values({ id, name, provenance: 'manual', conditions, categoryId });
		}

		await db.delete(ruleTag).where(eq(ruleTag.ruleId, id));
		for (const tagName of tagNames) {
			const t = await upsertTag(tagName);
			await db.insert(ruleTag).values({ ruleId: id, tagId: t.id }).onConflictDoNothing();
		}

		// Take effect immediately on everything not yet confirmed.
		await pairAndCategorise();
		return { ok: true };
	}
};
