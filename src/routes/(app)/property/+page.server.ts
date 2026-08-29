// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { asEnumValue } from '$lib/enums';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	contact,
	contactLink,
	document,
	loan,
	loanFixationPeriod,
	loanProperty,
	property,
	propertyBill,
	tagLink,
	tag,
	tenancy,
	propertyOpening
} from '$lib/server/db/schema';
import { initialsFor } from '$lib/people';
import { syncMeterBill } from '$lib/server/home';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { hashBytes, removeUpload, saveUpload, saveUploadBytes } from '$lib/server/system/files';
import {
	createPropertyBill,
	createTenancy,
	setPropertyBillSource,
	setPropertyFigure,
	setPropertyDrawing,
	removePropertyImage,
	setPropertyImage
} from '$lib/server/property/mutations';
import { updatePropertyTags } from '$lib/server/tags';
import {
	attachDocument,
	candidateDocuments,
	detachDocument,
	documentsAbout
} from '$lib/server/documents/targets';
import { visibleDocumentPredicate } from '$lib/server/documents/visibility';
import { periodForMonth } from '$lib/loans/amortise';
import { displayCurrency, formatMinor, parseAmountToMinor, toMajorString } from '$lib/money';
import { recordOpening, recordValuation, valuationHistory } from '$lib/server/property';
import { propertyFinancials, sharesForLoan } from '$lib/property/finance';
import { activeTenanciesByProperty } from '$lib/property/tenancy';
import { listProperties } from '$lib/server/property/queries';
import type { Actions, PageServerLoad } from './$types';

function daysUntil(date: string): number {
	return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const [properties, tenancies, bills, loans, periods, links, docs, rates, allTags] =
		await Promise.all([
			listProperties(),
			db.select().from(tenancy),
			db.select().from(propertyBill).orderBy(propertyBill.sort),
			db.select().from(loan),
			db.select().from(loanFixationPeriod),
			db.select().from(loanProperty),
			// Only what a BILL's row needs — whether the file behind it is one this
			// actor may open at all. The documents card below is loaded by
			// `documentsAbout`, which is where the shelf label and the read rule both
			// come from. Restricted here too: a bill's scan is paper like any other,
			// so a member sees the amount with no paperclip behind it.
			db
				.select({ id: document.id })
				.from(document)
				.where(visibleDocumentPredicate(locals.person ?? null)),
			loadRateTable(),
			// For the tag field's suggestion list, the same way the Loans screen
			// offers its own known tags: typing "Renovation" here and "renovation"
			// there should land on the one tag, not two differently-cased ones.
			db.select().from(tag)
		]);
	const today = new Date().toISOString().slice(0, 10);
	const month = today.slice(0, 7);
	const convert = (amount: bigint, from: string, to: string, day: string) =>
		convertOrFace(rates, amount, from, to, day);
	const activeTenancies = activeTenanciesByProperty(tenancies, today);
	const loansById = new Map(loans.map((candidate) => [candidate.id, candidate]));
	const propertiesById = new Map(properties.map((candidate) => [candidate.id, candidate]));
	// Allocation boundaries depend on the order of a loan's secured links, so
	// fix that order by property id rather than inheriting database row order.
	const linksByLoan = new Map<string, typeof links>();
	for (const link of links) {
		const secured = linksByLoan.get(link.loanId) ?? [];
		secured.push(link);
		linksByLoan.set(link.loanId, secured);
	}
	for (const secured of linksByLoan.values()) {
		secured.sort((a, b) =>
			a.propertyId < b.propertyId ? -1 : a.propertyId > b.propertyId ? 1 : 0
		);
	}

	const selectedId = url.searchParams.get('p') ?? properties[0]?.id ?? null;
	const current = properties.find((p) => p.id === selectedId) ?? properties[0] ?? null;

	let detail = null;
	if (current) {
		const loanLabel = (linkedLoan: (typeof loans)[number]) =>
			linkedLoan.lender ? `${linkedLoan.name} · ${linkedLoan.lender}` : linkedLoan.name;
		// Refinancing and parallel secured facilities may leave several active
		// loan links. Resolve and allocate every non-zero balance; `find` here used
		// to make the metrics depend on database row order and omit the rest.
		const linkedLoans = links
			.filter((link) => link.propertyId === current.id)
			.flatMap((link) => {
				const linkedLoan = loansById.get(link.loanId);
				if (!linkedLoan || linkedLoan.owedMinor <= 0n) return [];
				// Resolve every share securing this loan, not just this property's:
				// each part is allocated as the gap between cumulative boundaries,
				// so the sibling shares decide where this one's rounding falls.
				const secured = (linksByLoan.get(linkedLoan.id) ?? []).flatMap((sibling) => {
					const candidate = propertiesById.get(sibling.propertyId);
					if (!candidate) return [];
					return [
						{
							propertyId: sibling.propertyId,
							sharePct: sibling.sharePct,
							valueMinor: convert(candidate.valueMinor, candidate.currency, current.currency, today)
						}
					];
				});
				const shareIndex = secured.findIndex((entry) => entry.propertyId === current.id);
				if (shareIndex < 0) return [];
				const shares = sharesForLoan(secured);
				const share = shares[shareIndex];
				const loanPeriods = periods
					.filter((period) => period.loanId === linkedLoan.id)
					.map((period) => ({
						startsOn: period.startsOn,
						endsOn: period.endsOn,
						annualRatePct: Number(period.annualRatePct),
						paymentMinor: period.paymentMinor
					}));
				return [
					{
						loan: linkedLoan,
						shares,
						shareIndex,
						sharePct: Number((share.numerator * 10000n) / share.denominator) / 100,
						currentPeriod: periodForMonth(loanPeriods, month)
					}
				];
			});
		const currentTenancy = activeTenancies.get(current.id) ?? null;
		const monthlyBills = bills
			.filter((b) => b.propertyId === current.id)
			.reduce((sum, bill) => sum + bill.amountMinor, 0n);
		const financials = propertyFinancials(
			{
				day: today,
				propertyValueMinor: current.valueMinor,
				propertyCurrency: current.currency,
				loans: linkedLoans.map(({ loan: linkedLoan, shares, shareIndex, currentPeriod }) => ({
					id: linkedLoan.id,
					principalMinor: linkedLoan.principalMinor,
					owedMinor: linkedLoan.owedMinor,
					paymentMinor: currentPeriod?.paymentMinor ?? 0n,
					currency: linkedLoan.currency,
					shares,
					shareIndex
				})),
				rentMinor: currentTenancy?.rentMinor ?? 0n,
				billsMinor: monthlyBills
			},
			convert
		);
		const owed = financials.owedPropertyMinor;
		const equity = financials.equityMinor;

		const metrics = [
			{
				label: 'Est. value',
				value: formatMinor(current.valueMinor, current.currency),
				color: 'var(--fg1)',
				note: current.valuedOn ? `valued ${current.valuedOn.slice(0, 7)}` : 'set a value',
				// Stored, so it gets a pencil. The raw figures are what the edit form
				// starts from — a formatted one would have to be re-parsed to be
				// edited, and the grouping separators differ by currency.
				edit: {
					field: 'value',
					amount: toMajorString(current.valueMinor, current.currency),
					valuedOn: current.valuedOn
				}
			},
			{
				label: 'Mortgage owed',
				value: linkedLoans.length > 0 ? formatMinor(owed, current.currency) : '—',
				color: 'var(--red)',
				note:
					linkedLoans.length > 0
						? linkedLoans
								.map(
									({ loan: linkedLoan, sharePct }) =>
										`${loanLabel(linkedLoan)}${sharePct < 100 ? ` · ${sharePct.toFixed(2).replace(/\.00$/, '')}% share` : ''}`
								)
								.join(' + ')
						: 'no linked loan'
			},
			{
				label: 'Equity',
				value: formatMinor(equity, current.currency),
				color: 'var(--green)',
				note:
					current.valueMinor > 0n
						? `${Number((equity * 100n) / current.valueMinor)}% of value · value less what is owed`
						: 'value less what is owed'
			}
		];
		if (current.kind === 'rented' && currentTenancy) {
			const yearlyRent = currentTenancy.rentMinor * 12n;
			metrics.push({
				label: 'Rent yield',
				value:
					current.valueMinor > 0n
						? `${(Number((yearlyRent * 1000n) / current.valueMinor) / 10).toFixed(1)}%`
						: '—',
				color: 'var(--teal)',
				note: 'gross, on value'
			});
			const cashFlow = financials.cashFlowMinor;
			metrics.push({
				label: 'Cash flow',
				value: formatMinor(cashFlow, current.currency, { signed: true }),
				color: cashFlow >= 0n ? 'var(--green)' : 'var(--red)',
				note: 'monthly, after costs'
			});
		} else {
			metrics.push({
				label: 'Money in',
				value: formatMinor(current.moneyInMinor, current.currency),
				color: 'var(--fg2)',
				note: 'deposit, fees, principal',
				edit: {
					field: 'moneyIn',
					amount: toMajorString(current.moneyInMinor, current.currency),
					valuedOn: null
				}
			});
			metrics.push({
				label: 'Appreciation',
				value:
					current.valueMinor > 0n && current.moneyInMinor > 0n
						? `+${Number(((current.valueMinor - current.moneyInMinor) * 100n) / current.moneyInMinor)}%`
						: '—',
				color: 'var(--green)',
				note: current.boughtYear ? `since ${current.boughtYear}` : ''
			});
		}

		const propertyBills = bills
			.filter((b) => b.propertyId === current.id)
			.map((b) => {
				// `docs` already carries the read rule, so a restricted bill scan
				// simply is not in it — a member gets an amount with no id behind it,
				// never the raw column, so there is nothing to build a link out of.
				const visible = b.documentId ? docs.some((d) => d.id === b.documentId) : false;
				return {
					id: b.id,
					label: b.label,
					value: formatMinor(b.amountMinor, current.currency),
					documentId: visible ? b.documentId : null,
					fromMeter: b.source === 'meter'
				};
			});
		const billsTotal = formatMinor(
			bills.filter((b) => b.propertyId === current.id).reduce((s, b) => s + b.amountMinor, 0n),
			current.currency
		);

		let lease = null;
		if (currentTenancy) {
			const days = currentTenancy.endsOn ? daysUntil(currentTenancy.endsOn) : null;
			// How to reach the tenant now lives in the contacts module rather than in
			// one free-text column, so a tenancy can carry a mobile, a landline and
			// an agent without them being crammed into a single string.
			const tenantContacts = await db
				.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email })
				.from(contactLink)
				.innerJoin(contact, eq(contact.id, contactLink.contactId))
				.where(eq(contactLink.targetId, currentTenancy.id))
				.orderBy(contact.name);

			lease = {
				id: currentTenancy.id,
				tenantName: currentTenancy.tenantName,
				tenantInitials: initialsFor(currentTenancy.tenantName),
				tenantContacts,
				state: days === null ? 'open-ended' : days < 0 ? 'lease ended' : `ends in ${days} days`,
				hue:
					days === null
						? ('grey' as const)
						: days < 0
							? ('red' as const)
							: days <= 90
								? ('yellow' as const)
								: ('green' as const),
				facts: [
					{
						label: 'Rent',
						value: `${formatMinor(currentTenancy.rentMinor, current.currency)} ${displayCurrency(current.currency)}`
					},
					{
						label: 'Deposit held',
						value: `${formatMinor(currentTenancy.depositMinor, current.currency)} ${displayCurrency(current.currency)}`
					},
					{ label: 'Lease ends', value: currentTenancy.endsOn ?? 'open-ended' },
					{ label: 'Since', value: currentTenancy.startsOn ?? '—' }
				],
				renewalNotice: currentTenancy.renewalNoticeOn,
				// The lease contract is paper about the TENANCY, not the flat: a flat
				// let out twice over the years should not show the first tenant's
				// signed lease once the second one has moved in.
				documents: await documentsAbout(currentTenancy.id, locals.person ?? null),
				documentCandidates: await candidateDocuments(currentTenancy.id, locals.person ?? null),
				addDocumentHref: `/documents?add=1&addShelfKey=tenancy&targetKind=tenancy&targetId=${currentTenancy.id}`
			};
		}

		let mortgageCard = null;
		if (linkedLoans.length > 0) {
			const allocatedById = new Map(
				financials.loans.map((allocation) => [allocation.id, allocation])
			);
			const principal = financials.loans.reduce(
				(sum, allocation) => sum + allocation.principalPropertyMinor,
				0n
			);
			const repaid = principal - financials.owedPropertyMinor;
			mortgageCard = {
				fixation: linkedLoans
					.map(({ loan: linkedLoan, currentPeriod }) => {
						const label = loanLabel(linkedLoan);
						if (!currentPeriod) return `${label}: rate not set`;
						const rate = `${currentPeriod.annualRatePct.toFixed(2)}%`;
						return `${label}: ${currentPeriod.endsOn ? `fixed ${rate} to ${currentPeriod.endsOn.slice(0, 7)}` : rate}`;
					})
					.join(' · '),
				paidPct: principal > 0n ? Number((repaid * 1000n) / principal) / 10 : 0,
				paidNote: linkedLoans
					.map(({ loan: linkedLoan }) => {
						const allocation = allocatedById.get(linkedLoan.id)!;
						return `${loanLabel(linkedLoan)}: ${formatMinor(allocation.principalPropertyMinor - allocation.owedPropertyMinor, current.currency)} of ${formatMinor(allocation.principalPropertyMinor, current.currency)} repaid · ${formatMinor(allocation.owedPropertyMinor, current.currency)} owed`;
					})
					.join(' · ')
			};
		}

		// The paper filed against this flat, through the one query every documents
		// card uses (`document_link`, not a per-module foreign key). It carries
		// both halves of the read rule in its `where`, so this card hides exactly
		// what the Documents screen hides. Handed to `DocumentsCard` unchanged —
		// the card computes its own expiry tone, so no `{file, meta, expired,
		// amber}` reshaping happens here any more.
		const propertyDocs = await documentsAbout(current.id, locals.person ?? null);
		const propertyDocCandidates = await candidateDocuments(current.id, locals.person ?? null);

		const flatTagRows = await db
			.select({ name: tag.name })
			.from(tagLink)
			.innerJoin(tag, eq(tagLink.tagId, tag.id))
			.where(eq(tagLink.targetId, current.id));
		// What it has been worth, and what it cost to buy. Both were unreachable
		// before: only the latest value was stored, and money-in was a single
		// number somebody had to reconstruct.
		const [history, opening] = await Promise.all([
			valuationHistory(current.id),
			db.select().from(propertyOpening).where(eq(propertyOpening.propertyId, current.id))
		]);
		const valueSeries = history.map((v) => ({
			on: v.valuedOn,
			value: formatMinor(v.valueMinor, v.currency),
			raw: Number(v.valueMinor),
			source: v.source,
			note: v.note
		}));

		detail = {
			id: current.id,
			currency: current.currency,
			valueSeries,
			opening: opening[0]
				? {
						purchasedOn: opening[0].purchasedOn,
						price: toMajorString(opening[0].priceMinor, current.currency),
						costs: toMajorString(opening[0].costsMinor, current.currency),
						deposit: toMajorString(opening[0].depositMinor, current.currency)
					}
				: null,
			name: current.name,
			tags: flatTagRows.map((r) => r.name),
			sizeLabel: current.sizeLabel,
			kind: current.kind,
			// old fixed-slot uploads could leave holes; the strip wants a dense list
			images: { ...current.images, photos: current.images.photos.filter(Boolean) },
			metrics,
			bills: propertyBills,
			billsTotal,
			lease,
			mortgage: mortgageCard,
			documents: propertyDocs,
			documentCandidates: propertyDocCandidates,
			addDocumentHref: `/documents?add=1&addShelfKey=property&targetKind=property&targetId=${current.id}`
		};
	}

	return {
		isAdmin: locals.person?.role === 'admin',
		currencies: await availableCurrencies(),
		// Names only, for the tenant field's suggestion list. Adding a tenant now
		// files them in the address book, and seeing who is already there is what
		// stops the same person being entered twice under two spellings.
		contactNames: (await db.select({ name: contact.name }).from(contact).orderBy(contact.name)).map(
			(row) => row.name
		),
		knownTags: allTags.map((t) => ({ id: t.id, name: t.name })),
		tabs: properties.map((p) => ({
			id: p.id,
			name: p.name,
			tag: p.kind === 'lived' ? 'you live here' : 'rented out',
			active: p.id === (current?.id ?? '')
		})),
		detail
	};
};

export const actions: Actions = {
	tags: async ({ request }) => {
		const form = await request.formData();
		const id = asOptionalRowId(form.get('id'));
		if (!id) return fail(400, { message: 'Missing property.' });
		const added = String(form.get('tagName') ?? '').trim();
		const removed = String(form.get('removeTag') ?? '').trim();
		await updatePropertyTags(id, {
			add: added || undefined,
			remove: removed || undefined
		});
		return { ok: true };
	},

	addProperty: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'The property needs a name.' });
		const currency = String(form.get('currency') ?? 'CZK').toUpperCase();
		let value = 0n;
		let moneyIn = 0n;
		try {
			const valueRaw = String(form.get('value') ?? '').trim();
			if (valueRaw) value = parseAmountToMinor(valueRaw, currency);
			const moneyInRaw = String(form.get('moneyIn') ?? '').trim();
			if (moneyInRaw) moneyIn = parseAmountToMinor(moneyInRaw, currency);
		} catch {
			return fail(400, { message: 'Value and money in must be numbers.' });
		}
		await db.insert(property).values({
			id: uuidv7(),
			name,
			sizeLabel: String(form.get('sizeLabel') ?? '').trim(),
			kind: asEnumValue('property.kind', form.get('kind'), 'lived'),
			currency,
			valueMinor: value,
			valuedOn: value > 0n ? new Date().toISOString().slice(0, 10) : null,
			moneyInMinor: moneyIn,
			boughtYear: Number(form.get('boughtYear')) || null
		});
		return { ok: true };
	},

	uploadImage: async ({ request }) => {
		const form = await request.formData();
		const propertyId = asRowId(form.get('propertyId'));
		const slot = String(form.get('slot') ?? ''); // plan | photo0 | photo1 | photo2
		const expectedImage = String(form.get('expectedImage') ?? '') || null;
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { message: 'Pick a file.' });
		let name: string;
		try {
			name = await saveUpload(file);
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
		}
		let result;
		try {
			result = await setPropertyImage({ propertyId, slot, storedName: name, expectedImage });
		} catch (error) {
			await removeUpload(name);
			throw error;
		}
		if (!result.ok) {
			await removeUpload(name);
			return fail(result.status, { message: result.message });
		}
		return { ok: true };
	},

	removeImage: async ({ request }) => {
		const form = await request.formData();
		const propertyId = asRowId(form.get('propertyId'));
		const slot = String(form.get('slot') ?? '');
		const expectedImage = String(form.get('expectedImage') ?? '');
		if (!expectedImage) return fail(400, { message: 'Nothing to remove.' });

		const result = await removePropertyImage({ propertyId, slot, expectedImage });
		if (!result.ok) return fail(result.status, { message: result.message });
		// Only once the row no longer points at it. Every upload gets its own
		// randomUUID name, so nothing else can be referencing this file.
		await removeUpload(result.removed);
		return { ok: true };
	},

	savePlan: async ({ request }) => {
		const form = await request.formData();
		const propertyId = asRowId(form.get('propertyId'));
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(form.get('drawing') ?? ''));
		} catch {
			return fail(400, { message: 'The plan did not parse.' });
		}
		const result = await setPropertyDrawing({ propertyId, drawing: parsed });
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Correct one stored figure — the estimate, or what has been put in.
	 *
	 * The derived tiles beside them have no pencil on purpose: editing a number
	 * the next recompute overwrites is worse than not offering the edit.
	 */
	setFigure: async ({ request }) => {
		const form = await request.formData();
		const field = String(form.get('field') ?? '') === 'moneyIn' ? 'moneyIn' : 'value';
		const result = await setPropertyFigure({
			propertyId: asRowId(form.get('propertyId')),
			field,
			amount: String(form.get('amount') ?? ''),
			valuedOn: String(form.get('valuedOn') ?? '').trim() || null
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** Another point on the value line. A past date leaves today's figure alone. */
	addValuation: async ({ request }) => {
		const form = await request.formData();
		const currency = String(form.get('currency') ?? 'CZK');
		let valueMinor: bigint;
		try {
			valueMinor = parseAmountToMinor(String(form.get('value') ?? ''), currency);
		} catch {
			return fail(400, { message: 'That value is not a number.' });
		}
		const result = await recordValuation(asRowId(form.get('propertyId')), {
			valuedOn: String(form.get('valuedOn') ?? '').trim(),
			valueMinor,
			source: String(form.get('source') ?? 'estimate'),
			note: String(form.get('note') ?? '')
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** What buying it cost, recorded once instead of reconstructed. */
	setOpening: async ({ request }) => {
		const form = await request.formData();
		const currency = String(form.get('currency') ?? 'CZK');
		const amount = (field: string) => {
			const raw = String(form.get(field) ?? '').trim();
			return raw ? parseAmountToMinor(raw, currency) : 0n;
		};
		let figures;
		try {
			figures = {
				priceMinor: amount('price'),
				costsMinor: amount('costs'),
				depositMinor: amount('deposit')
			};
		} catch {
			return fail(400, { message: 'Those figures are not numbers.' });
		}
		const result = await recordOpening(asRowId(form.get('propertyId')), {
			purchasedOn: String(form.get('purchasedOn') ?? '').trim() || null,
			...figures
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	addTenancy: async ({ request }) => {
		const form = await request.formData();
		const propertyId = asRowId(form.get('propertyId'));
		const tenantName = String(form.get('tenantName') ?? '').trim();
		if (!tenantName) return fail(400, { message: 'The tenant needs a name.' });
		const rows = await db.select().from(property).where(eq(property.id, propertyId));
		if (!rows[0]) return fail(404, { message: 'Property not found.' });
		let rent: bigint;
		let deposit = 0n;
		try {
			rent = parseAmountToMinor(String(form.get('rent') ?? '0'), rows[0].currency);
			const depositRaw = String(form.get('deposit') ?? '').trim();
			if (depositRaw) deposit = parseAmountToMinor(depositRaw, rows[0].currency);
		} catch {
			return fail(400, { message: 'Rent and deposit must be numbers.' });
		}
		const result = await createTenancy({
			id: uuidv7(),
			propertyId,
			tenantName,
			rentMinor: rent,
			depositMinor: deposit,
			startsOn: String(form.get('startsOn') ?? '').trim() || null,
			endsOn: String(form.get('endsOn') ?? '').trim() || null,
			renewalNoticeOn: String(form.get('renewalNoticeDate') ?? '').trim() || null
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Point the smart meter at a bill, or take it off again.
	 *
	 * Which line the meter feeds is the household's decision, not something to
	 * infer: matching a label containing "energy" missed the app's own seeded
	 * "Electricity advance", so the meter added a second line beside it and the
	 * flat's bill total counted electricity twice. One meter-fed line per
	 * property, so pointing it at a new bill releases the old one.
	 */
	setBillSource: async ({ request }) => {
		const form = await request.formData();
		const billId = asRowId(form.get('billId'));
		const fromMeter = String(form.get('fromMeter')) === 'true';
		const result = await setPropertyBillSource(billId, fromMeter);
		if (!result.ok) return fail(result.status, { message: result.message });
		// Fill the newly pointed-at line straight away rather than leaving a
		// stale figure until the next hourly tick.
		if (fromMeter) {
			await syncMeterBill().catch((err) =>
				console.warn('Meter bill sync failed:', err?.message ?? err)
			);
		}
		return { ok: true };
	},

	addBill: async ({ request }) => {
		const form = await request.formData();
		const propertyId = asRowId(form.get('propertyId'));
		const label = String(form.get('label') ?? '').trim();
		if (!label) return fail(400, { message: 'The bill needs a label.' });
		const rows = await db.select().from(property).where(eq(property.id, propertyId));
		if (!rows[0]) return fail(404, { message: 'Property not found.' });
		let amount: bigint;
		try {
			amount = parseAmountToMinor(String(form.get('amount') ?? '0'), rows[0].currency);
		} catch {
			return fail(400, { message: 'The amount must be a number.' });
		}

		// An attached bill file becomes a document about this flat — one upload,
		// visible both next to the bill and in the Documents archive.
		let documentId: string | null = null;
		let storedName: string | null = null;
		let extension = 'PDF';
		let contentHash: string | null = null;
		const file = form.get('file');
		if (file instanceof File && file.size > 0) {
			// Read the bytes once so they can both be saved and fingerprinted —
			// `saveUploadBytes` in place of `saveUpload` is what makes them
			// available for the hash rather than being read a second time.
			const bytes = new Uint8Array(await file.arrayBuffer());
			try {
				storedName = await saveUploadBytes(bytes, file.name);
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			documentId = uuidv7();
			extension = extname(file.name).replace('.', '').toUpperCase() || 'PDF';
			contentHash = hashBytes(bytes);
		}

		await createPropertyBill({
			id: uuidv7(),
			propertyId,
			label,
			amountMinor: amount,
			document:
				documentId && storedName
					? {
							id: documentId,
							name: `${label} · ${rows[0].name}`,
							storedName,
							ext: extension,
							addedOn: new Date().toISOString().slice(0, 10),
							contentHash
						}
					: null
		});
		return { ok: true };
	},

	/**
	 * File an existing document against the flat or one of its tenancies — the
	 * "Attach" picker on either `DocumentsCard`. Both cards post here with their
	 * own `targetId`, so one action serves both without knowing which kind it
	 * was handed; the registry is what resolves that.
	 */
	attachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Unfile a document — the link only. The document stays on its shelf, so a
	 * mis-click costs a re-attach rather than evidence.
	 */
	detachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
