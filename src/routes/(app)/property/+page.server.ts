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
	documentLink,
	loan,
	loanFixationPeriod,
	loanProperty,
	property,
	propertyBill,
	tagLink,
	tag,
	tenancy
} from '$lib/server/db/schema';
import { SHELVES } from '$lib/documents';
import { initialsFor } from '$lib/people';
import { syncMeterBill } from '$lib/server/home';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { removeUpload, saveUpload } from '$lib/server/system/files';
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
import { periodForMonth } from '$lib/loans/amortise';
import { displayCurrency, formatMinor, parseAmountToMinor, toMajorString } from '$lib/money';
import { propertyFinancials, sharesForLoan } from '$lib/property/finance';
import { activeTenanciesByProperty } from '$lib/property/tenancy';
import { listProperties } from '$lib/server/property/queries';
import type { Actions, PageServerLoad } from './$types';

function daysUntil(date: string): number {
	return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export const load: PageServerLoad = async ({ url }) => {
	const [properties, tenancies, bills, loans, periods, links, docs, rates] = await Promise.all([
		listProperties(),
		db.select().from(tenancy),
		db.select().from(propertyBill).orderBy(propertyBill.sort),
		db.select().from(loan),
		db.select().from(loanFixationPeriod),
		db.select().from(loanProperty),
		db.select().from(document).orderBy(document.addedOn),
		loadRateTable()
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
				const doc = b.documentId ? docs.find((d) => d.id === b.documentId) : undefined;
				return {
					id: b.id,
					label: b.label,
					value: formatMinor(b.amountMinor, current.currency),
					file: doc?.storedName ?? null,
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
				renewalNotice: currentTenancy.renewalNoticeOn
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

		// Documents are linked by document_property — a real key, so renaming the
		// flat cannot orphan its contracts.
		const today2 = new Date().toISOString().slice(0, 10);
		const docLinks = await db
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, current.id));
		const linkedDocIds = new Set(docLinks.map((l) => l.documentId));
		const propertyDocs = docs
			.filter((d) => linkedDocIds.has(d.id))
			.sort((a, b) => (a.addedOn < b.addedOn ? 1 : -1))
			.map((d) => ({
				id: d.id,
				name: d.name,
				ext: d.ext,
				file: d.storedName,
				shelfLabel: SHELVES.find((s) => s.key === d.shelf)?.label ?? d.shelf,
				meta: d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : `added ${d.addedOn}`,
				amber: d.expiresOn !== null,
				expired: d.expiresOn !== null && d.expiresOn < today2
			}));

		const flatTagRows = await db
			.select({ name: tag.name })
			.from(tagLink)
			.innerJoin(tag, eq(tagLink.tagId, tag.id))
			.where(eq(tagLink.targetId, current.id));
		detail = {
			id: current.id,
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
			// a rented flat's paperwork lands on the Tenancy shelf by default
			addDocumentHref: `/documents?add=1&addShelf=${current.kind === 'rented' ? 'tenancy' : 'property'}&propertyId=${current.id}`
		};
	}

	return {
		currencies: await availableCurrencies(),
		// Names only, for the tenant field's suggestion list. Adding a tenant now
		// files them in the address book, and seeing who is already there is what
		// stops the same person being entered twice under two spellings.
		contactNames: (await db.select({ name: contact.name }).from(contact).orderBy(contact.name)).map(
			(row) => row.name
		),
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
		const file = form.get('file');
		if (file instanceof File && file.size > 0) {
			try {
				storedName = await saveUpload(file);
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			documentId = uuidv7();
			extension = extname(file.name).replace('.', '').toUpperCase() || 'PDF';
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
							addedOn: new Date().toISOString().slice(0, 10)
						}
					: null
		});
		return { ok: true };
	}
};
