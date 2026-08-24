// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { asc } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { retirementInputs } from '$lib/server/retirement';
import {
	getBaseCurrency,
	getRevisionedSetting,
	isRevisionWriterId,
	setRevisionedSetting
} from '$lib/server/settings';
import {
	MAX_RETIREMENT_AGE,
	MIN_RETIREMENT_AGE,
	RETIRE_DEFAULTS,
	RETIRE_LABELS,
	type RetireConfig
} from '$lib/retire';
import type { Actions, PageServerLoad } from './$types';

const RETIRE_NUMBER_KEYS = [
	'spend',
	'swr',
	'realReturn',
	'contributionGrowth',
	'propertyGrowth',
	'pensionOne',
	'pensionTwo',
	'ageOne',
	'ageTwo'
] as const;

/**
 * Name the assumption that is out of range rather than refusing the snapshot
 * as a whole.
 *
 * This page autosaves, so there is no moment where a person is submitting and
 * can see what was wrong. One generic refusal meant an out-of-range value that
 * stayed in the form refused every later edit too — changing spending or a
 * growth slider silently did nothing behind the same line of text, for as long
 * as the offending field held its value.
 */
function retireConfigFromForm(form: FormData): { config: RetireConfig } | { message: string } {
	type NumberKey = (typeof RETIRE_NUMBER_KEYS)[number];
	const numbers = Object.fromEntries(
		RETIRE_NUMBER_KEYS.map((key) => {
			const raw = String(form.get(key) ?? '')
				.trim()
				.replace(',', '.');
			const value = raw ? Number(raw) : Number.NaN;
			return [key, Number.isFinite(value) ? value : null];
		})
	) as Record<NumberKey, number | null>;
	const missing = RETIRE_NUMBER_KEYS.find((key) => numbers[key] === null);
	if (missing) return { message: `${RETIRE_LABELS[missing]} must be a number.` };

	const values = numbers as Record<NumberKey, number>;
	const plan = String(form.get('plan') ?? '');
	const problems: [boolean, string][] = [
		[values.spend < 0, `${RETIRE_LABELS.spend} cannot be negative.`],
		[![3, 3.5, 4].includes(values.swr), 'Choose a withdrawal rate of 3, 3.5 or 4%.'],
		[
			values.realReturn < 0 || values.realReturn > 8,
			`${RETIRE_LABELS.realReturn} must be between 0 and 8%.`
		],
		[
			values.contributionGrowth < -5 || values.contributionGrowth > 10,
			`${RETIRE_LABELS.contributionGrowth} must be between -5 and 10%.`
		],
		[
			values.propertyGrowth < -5 || values.propertyGrowth > 10,
			`${RETIRE_LABELS.propertyGrowth} must be between -5 and 10%.`
		],
		[values.pensionOne < 0 || values.pensionTwo < 0, 'A pension cannot be negative.'],
		[
			!Number.isInteger(values.ageOne) || !Number.isInteger(values.ageTwo),
			'Retirement ages must be whole years.'
		],
		[
			values.ageOne < MIN_RETIREMENT_AGE || values.ageTwo < MIN_RETIREMENT_AGE,
			`Retirement age must be at least ${MIN_RETIREMENT_AGE}.`
		],
		[
			values.ageOne > MAX_RETIREMENT_AGE || values.ageTwo > MAX_RETIREMENT_AGE,
			`Retirement age must be at most ${MAX_RETIREMENT_AGE}.`
		],
		[plan !== 'keep' && plan !== 'rent' && plan !== 'sell', 'Choose what happens to the property.']
	];
	const failed = problems.find(([bad]) => bad);
	if (failed) return { message: failed[1] };

	return { config: { ...values, plan: plan as RetireConfig['plan'] } };
}

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();

	const [inputs, people, stored] = await Promise.all([
		retirementInputs(baseCurrency),
		db.select().from(person).orderBy(asc(person.createdAt), asc(person.id)),
		getRevisionedSetting<Partial<RetireConfig>>('retirement', {})
	]);

	return {
		inputs,
		config: { ...RETIRE_DEFAULTS, ...stored.value },
		autosaveWriterId: uuidv7(),
		autosaveBaseVersion: stored.version,
		personNames: [people[0]?.name ?? 'Person one', people[1]?.name ?? 'Person two'],
		peopleOptions: people.map((p) => ({ id: p.id, name: p.name })),
		peopleList: people.map((p) => p.name),
		baseCurrency
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const revision = Number(form.get('revision'));
		const writerId = asRowId(form.get('writerId'));
		const baseVersion = Number(form.get('baseVersion'));
		if (!isRevisionWriterId(writerId)) {
			return fail(400, { message: 'The save writer is invalid.' });
		}
		if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
			return fail(400, { message: 'The save base version is invalid.' });
		}
		if (!Number.isSafeInteger(revision) || revision < 1) {
			return fail(400, { message: 'The save revision is invalid.' });
		}
		const parsed = retireConfigFromForm(form);
		if ('message' in parsed) return fail(400, { message: parsed.message });
		const saved = await setRevisionedSetting(
			'retirement',
			writerId,
			baseVersion,
			revision,
			parsed.config
		);
		if (!saved) {
			return fail(409, {
				message:
					'Newer assumptions were already saved here or in another tab. Reload before editing again.'
			});
		}
		return { ok: true };
	}
};
