// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { asc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { document, documentLink, person } from '$lib/server/db/schema';
import { formatMinor, parseAmountToMinor, toMajor } from '$lib/money';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { saveUpload } from '$lib/server/system/files';
import { learnAmountLabel, readPayslip, readStoredPayslip } from '$lib/server/salary';
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
import { payslipEditCurrency, salaryStats } from '$lib/salary';
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

	const [inputs, people, stored, rates] = await Promise.all([
		retirementInputs(baseCurrency),
		db.select().from(person).orderBy(asc(person.createdAt), asc(person.id)),
		getRevisionedSetting<Partial<RetireConfig>>('retirement', {}),
		loadRateTable()
	]);
	const today = new Date().toISOString().slice(0, 10);
	const toBaseMinor = (amount: bigint, currency: string, day = today) =>
		convertOrFace(rates, amount, currency, baseCurrency, day);

	// ---- Salary history from payslips ----
	// A payslip is a document on the Payslips shelf carrying an amount and the
	// month it covers; document_person says whose it is — a real link, so a
	// rename cannot orphan it. Amounts come from the PDF (learned per person)
	// or the user's own entry.
	const slips = (await db.select().from(document).where(eq(document.shelf, 'payslips'))).filter(
		(d) => d.amountMinor !== null && d.periodOn !== null
	);
	// Which payslip belongs to whom. Filtered to people, because document_link
	// now also holds a document's properties, accounts and subjects.
	const slipOwners = await db
		.select({ documentId: documentLink.documentId, personId: documentLink.targetId })
		.from(documentLink)
		.innerJoin(person, eq(person.id, documentLink.targetId));
	const ownerOf = new Map(slipOwners.map((r) => [r.documentId, r.personId]));
	const salary = people.map((p) => {
		const own = slips
			.filter((d) => ownerOf.get(d.id) === p.id)
			.map((d) => ({
				id: d.id,
				// period_on is a real date since 0052; the screens and the form work in
				// months, which is what an <input type="month"> gives and takes.
				periodMonth: d.periodOn!.slice(0, 7),
				amountMinor: d.amountMinor!,
				currency: d.currency ?? baseCurrency,
				file: d.storedName
			}))
			.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
		const rows = salaryStats(
			own.map((s) => ({
				periodMonth: s.periodMonth,
				amountMinor: toBaseMinor(s.amountMinor, s.currency, `${s.periodMonth}-01`)
			})),
			p.birthYear
		);
		return {
			name: p.name,
			years: rows
				.slice()
				.reverse()
				.map((r) => ({
					year: r.year,
					age: r.age,
					avg: formatMinor(r.avgMonthlyMinor, baseCurrency),
					avgMajor: toMajor(r.avgMonthlyMinor, baseCurrency),
					months: r.months,
					deltaPct: r.deltaPct
				})),
			recent: own.slice(0, 6).map((s) => ({
				id: s.id,
				periodMonth: s.periodMonth,
				amount: formatMinor(s.amountMinor, s.currency),
				file: s.file
			}))
		};
	});

	return {
		inputs,
		config: { ...RETIRE_DEFAULTS, ...stored.value },
		autosaveWriterId: uuidv7(),
		autosaveBaseVersion: stored.version,
		personNames: [people[0]?.name ?? 'Person one', people[1]?.name ?? 'Person two'],
		peopleOptions: people.map((p) => ({ id: p.id, name: p.name })),
		peopleList: people.map((p) => p.name),
		salary,
		baseCurrency
	};
};

export const actions: Actions = {
	addPayslip: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslip this is.' });
		// The reader's learned labels stay keyed by name; the link is by id.
		const subject = owner.name;
		const baseCurrency = await getBaseCurrency();

		const file = form.get('file');
		let storedName: string | null = null;
		let reading = null;
		if (file instanceof File && file.size > 0) {
			const data = new Uint8Array(await file.arrayBuffer());
			try {
				storedName = await saveUpload(
					new File([new Blob([data as BlobPart])], file.name, { type: file.type })
				);
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			reading = await readPayslip(data, subject);
		}

		// the user's own entry wins; the PDF reading fills what is left blank
		let amountMinor: bigint | null;
		const amountRaw = String(form.get('amount') ?? '').trim();
		if (amountRaw) {
			try {
				amountMinor = parseAmountToMinor(amountRaw, baseCurrency);
			} catch {
				return fail(400, { message: 'The amount must be a number.' });
			}
		} else {
			amountMinor = reading?.amountMinor ?? null;
		}
		const periodMonth =
			String(form.get('periodMonth') ?? '').trim() || reading?.periodMonth || null;
		if (amountMinor === null || amountMinor <= 0n) {
			return fail(400, {
				message: 'Could not read the amount from the slip — please fill it in.'
			});
		}
		if (!periodMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
			return fail(400, { message: 'Which month does this payslip cover?' });
		}

		// a stated amount that matches a line on the slip teaches the reader
		if (amountRaw && reading) await learnAmountLabel(subject, amountMinor, reading.candidates);

		const documentId = uuidv7();
		await db.transaction(async (tx) => {
			await tx.insert(document).values({
				id: documentId,
				name: `Payslip ${periodMonth} · ${subject}`,
				shelf: 'payslips',
				storedName,
				ext: storedName ? (storedName.split('.').pop() ?? 'pdf').toUpperCase() : 'PDF',
				addedOn: new Date().toISOString().slice(0, 10),
				amountMinor,
				currency: baseCurrency,
				periodOn: `${periodMonth}-01`
			});
			await tx
				.insert(documentLink)
				.values({ documentId, targetId: personId })
				.onConflictDoNothing();
		});
		return { ok: true };
	},

	setPayslipAmount: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const rows = await db.select().from(document).where(eq(document.id, id));
		const doc = rows[0];
		if (!doc) return fail(404, { message: 'Payslip not found.' });
		const currency = payslipEditCurrency(doc.currency, await getBaseCurrency());
		let amountMinor: bigint;
		try {
			amountMinor = parseAmountToMinor(String(form.get('amount') ?? ''), currency);
			if (amountMinor <= 0n) throw new Error('amount');
		} catch {
			return fail(400, { message: 'The amount must be a positive number.' });
		}
		// a correction against the stored file teaches the reader for next time
		if (doc.storedName) {
			// The PERSON this payslip is filed against. `document_link` also holds a
			// document's properties, accounts and subjects, so this joins `person`
			// rather than taking the first link and hoping — which is what the old
			// per-pair table was doing for it implicitly.
			const owner = (
				await db
					.select({ id: person.id, name: person.name })
					.from(documentLink)
					.innerJoin(person, eq(person.id, documentLink.targetId))
					.where(eq(documentLink.documentId, doc.id))
					.limit(1)
			)[0];
			if (owner) {
				const reading = await readStoredPayslip(doc.storedName, owner.name);
				await learnAmountLabel(owner.name, amountMinor, reading.candidates);
			}
		}
		await db.update(document).set({ amountMinor, currency: currency }).where(eq(document.id, id));
		return { ok: true };
	},

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
