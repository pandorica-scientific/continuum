import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	account,
	document,
	documentPerson,
	loan,
	loanFixationPeriod,
	person,
	portfolioSnapshot,
	property,
	tenancy
} from '$lib/server/db/schema';
import { monthlyHistory } from '$lib/server/cashflow';
import { toMajor } from '$lib/money';
import { convertOrFace } from '$lib/server/fx';
import { minorDigits } from '$lib/money';
import { saveUpload } from '$lib/server/files';
import { periodForMonth } from '$lib/loans/amortise';
import { learnAmountLabel, readPayslip, readStoredPayslip } from '$lib/server/salary';
import { getBaseCurrency, getSetting, setSetting } from '$lib/server/settings';
import { formatMinor, parseAmountToMinor } from '$lib/money';
import { RETIRE_DEFAULTS, type RetireConfig, type RetireInputs } from '$lib/retire';
import { salaryStats } from '$lib/salary';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const toBase = async (amount: bigint, currency: string) =>
		Number(await convertOrFace(amount, currency, baseCurrency)) / 10 ** minorDigits(baseCurrency);

	const [accounts, snapshots, loans, periods, properties, tenancies, people, history, stored] =
		await Promise.all([
			db.select().from(account),
			db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1),
			db.select().from(loan),
			db.select().from(loanFixationPeriod),
			db.select().from(property),
			db.select().from(tenancy),
			db.select().from(person).orderBy(asc(person.createdAt)),
			monthlyHistory(),
			getSetting<Partial<RetireConfig>>('retirement', {})
		]);

	let liquid = 0;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		liquid += await toBase(a.balanceMinor, a.currency);
	}
	if (snapshots[0]) liquid += await toBase(snapshots[0].valueMinor, snapshots[0].currency);

	// What the household actually saves: kept money over the last 12 recorded
	// months, annualised. Zero history → zero contribution, honestly.
	const last12 = history.slice(-12);
	const kept = last12.reduce((s, m) => s + (m.earned - m.spent), 0);
	const contribution = last12.length > 0 ? (kept / last12.length) * 12 : 0;

	let propertyValue = 0;
	for (const p of properties) propertyValue += await toBase(p.valueMinor, p.currency);

	let mortgageOwed = 0;
	let mortgageYearlyPayment = 0;
	let weightedRate = 0;
	const month = new Date().toISOString().slice(0, 7);
	for (const l of loans) {
		if (l.owedMinor <= 0n) continue;
		const owed = await toBase(l.owedMinor, l.currency);
		const current = periodForMonth(
			periods
				.filter((p) => p.loanId === l.id)
				.map((p) => ({
					startDate: p.startDate,
					endDate: p.endDate,
					annualRatePct: Number(p.annualRatePct),
					paymentMinor: p.paymentMinor
				})),
			month
		);
		mortgageOwed += owed;
		if (current) {
			mortgageYearlyPayment += (await toBase(current.paymentMinor, l.currency)) * 12;
			weightedRate += (current.annualRatePct / 100) * owed;
		}
	}
	const mortgageRate = mortgageOwed > 0 ? weightedRate / mortgageOwed : 0;

	const today = new Date().toISOString().slice(0, 10);
	let monthlyRent = 0;
	for (const t of tenancies) {
		if (!t.endDate || t.endDate >= today) monthlyRent += toMajor(t.rentMinor, baseCurrency);
	}

	const year = new Date().getFullYear();
	const bornOne = people[0]?.birthYear ?? year - 36;
	const bornTwo = people[1]?.birthYear ?? bornOne;

	const inputs: RetireInputs = {
		liquid,
		contribution,
		propertyValue,
		mortgageOwed,
		mortgageYearlyPayment,
		mortgageRate,
		monthlyRent,
		bornOne,
		bornTwo,
		year
	};

	// ---- Salary history from payslips ----
	// A payslip is a document on the Payslips shelf carrying an amount and the
	// month it covers; document_person says whose it is — a real link, so a
	// rename cannot orphan it. Amounts come from the PDF (learned per person)
	// or the user's own entry.
	const slips = (await db.select().from(document).where(eq(document.shelf, 'payslips'))).filter(
		(d) => d.amountMinor !== null && d.periodMonth !== null
	);
	const slipOwners = await db.select().from(documentPerson);
	const ownerOf = new Map(slipOwners.map((r) => [r.documentId, r.personId]));
	const salary = people.map((p) => {
		const own = slips
			.filter((d) => ownerOf.get(d.id) === p.id)
			.map((d) => ({
				id: d.id,
				periodMonth: d.periodMonth!,
				amountMinor: d.amountMinor!,
				currency: d.amountCurrency ?? baseCurrency,
				file: d.storedName
			}))
			.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));
		const rows = salaryStats(
			own.map((s) => ({ periodMonth: s.periodMonth, amountMinor: s.amountMinor })),
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
					avg: formatMinor(r.avgMonthlyMinor, own[0]?.currency ?? baseCurrency),
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
		config: { ...RETIRE_DEFAULTS, ...stored },
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
		const personId = String(form.get('personId') ?? '').trim();
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

		const documentId = randomUUID();
		await db.insert(document).values({
			id: documentId,
			name: `Payslip ${periodMonth} · ${subject}`,
			shelf: 'payslips',
			storedName,
			ext: storedName ? (storedName.split('.').pop() ?? 'pdf').toUpperCase() : 'PDF',
			addedOn: new Date().toISOString().slice(0, 10),
			amountMinor,
			amountCurrency: baseCurrency,
			periodMonth
		});
		await db.insert(documentPerson).values({ documentId, personId }).onConflictDoNothing();
		return { ok: true };
	},

	setPayslipAmount: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const rows = await db.select().from(document).where(eq(document.id, id));
		const doc = rows[0];
		if (!doc) return fail(404, { message: 'Payslip not found.' });
		const baseCurrency = await getBaseCurrency();
		let amountMinor: bigint;
		try {
			amountMinor = parseAmountToMinor(String(form.get('amount') ?? ''), baseCurrency);
			if (amountMinor <= 0n) throw new Error('amount');
		} catch {
			return fail(400, { message: 'The amount must be a positive number.' });
		}
		// a correction against the stored file teaches the reader for next time
		if (doc.storedName) {
			const link = (
				await db.select().from(documentPerson).where(eq(documentPerson.documentId, doc.id))
			)[0];
			const owner = link
				? (await db.select().from(person).where(eq(person.id, link.personId)))[0]
				: null;
			if (owner) {
				const reading = await readStoredPayslip(doc.storedName, owner.name);
				await learnAmountLabel(owner.name, amountMinor, reading.candidates);
			}
		}
		await db
			.update(document)
			.set({ amountMinor, amountCurrency: baseCurrency })
			.where(eq(document.id, id));
		return { ok: true };
	},

	save: async ({ request }) => {
		const form = await request.formData();
		const number = (key: string, fallback: number) => {
			const value = Number(String(form.get(key) ?? '').replace(',', '.'));
			return Number.isFinite(value) ? value : fallback;
		};
		const plan = String(form.get('plan') ?? 'keep');
		const config: RetireConfig = {
			spend: Math.max(0, number('spend', RETIRE_DEFAULTS.spend)),
			swr: [3, 3.5, 4].includes(number('swr', RETIRE_DEFAULTS.swr))
				? number('swr', RETIRE_DEFAULTS.swr)
				: RETIRE_DEFAULTS.swr,
			realReturn: Math.min(8, Math.max(0, number('realReturn', RETIRE_DEFAULTS.realReturn))),
			plan: plan === 'rent' || plan === 'sell' ? plan : 'keep',
			pensionOne: Math.max(0, number('pensionOne', RETIRE_DEFAULTS.pensionOne)),
			pensionTwo: Math.max(0, number('pensionTwo', RETIRE_DEFAULTS.pensionTwo)),
			ageOne: Math.max(50, number('ageOne', RETIRE_DEFAULTS.ageOne)),
			ageTwo: Math.max(50, number('ageTwo', RETIRE_DEFAULTS.ageTwo))
		};
		await setSetting('retirement', config);
		return { ok: true };
	}
};
