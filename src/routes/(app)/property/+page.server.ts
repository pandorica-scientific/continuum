import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	document,
	documentProperty,
	documentTag,
	loan,
	loanFixationPeriod,
	loanProperty,
	property,
	propertyBill,
	propertyTag,
	tag,
	tenancy
} from '$lib/server/db/schema';
import { SHELVES } from '$lib/documents';
import { initialsFor } from '$lib/people';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { saveUpload } from '$lib/server/files';
import { normaliseTagName, setPropertyTags, upsertTag } from '$lib/server/tags';
import { periodForMonth } from '$lib/loans/amortise';
import { formatMinor, parseAmountToMinor } from '$lib/money';
import { validateDrawing } from '$lib/plan';
import type { Actions, PageServerLoad } from './$types';

function daysUntil(date: string): number {
	return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export const load: PageServerLoad = async ({ url }) => {
	const [properties, tenancies, bills, loans, periods, links, docs] = await Promise.all([
		db.select().from(property).orderBy(property.createdAt),
		db.select().from(tenancy),
		db.select().from(propertyBill).orderBy(propertyBill.sort),
		db.select().from(loan),
		db.select().from(loanFixationPeriod),
		db.select().from(loanProperty),
		db.select().from(document).orderBy(document.addedOn)
	]);

	const selectedId = url.searchParams.get('p') ?? properties[0]?.id ?? null;
	const current = properties.find((p) => p.id === selectedId) ?? properties[0] ?? null;

	let detail = null;
	if (current) {
		const link = links.find((lp) => lp.propertyId === current.id) ?? null;
		const mortgage = link ? (loans.find((l) => l.id === link.loanId) ?? null) : null;
		// This flat's share of a mortgage that may secure several flats:
		// explicit percentage when set, else proportional to linked values.
		let shareFraction = 1;
		if (mortgage && link) {
			if (link.sharePct !== null) {
				shareFraction = Number(link.sharePct) / 100;
			} else {
				const linkedIds = links
					.filter((lp) => lp.loanId === mortgage.id)
					.map((lp) => lp.propertyId);
				const totalValue = properties
					.filter((pr) => linkedIds.includes(pr.id))
					.reduce((sum, pr) => sum + Number(pr.valueMinor), 0);
				shareFraction = totalValue > 0 ? Number(current.valueMinor) / totalValue : 1;
			}
		}
		const mortgagePeriods = mortgage
			? periods
					.filter((p) => p.loanId === mortgage.id)
					.map((p) => ({
						startDate: p.startDate,
						endDate: p.endDate,
						annualRatePct: Number(p.annualRatePct),
						paymentMinor: p.paymentMinor
					}))
			: [];
		const currentMortgagePeriod = periodForMonth(
			mortgagePeriods,
			new Date().toISOString().slice(0, 7)
		);
		const owed = mortgage ? BigInt(Math.round(Number(mortgage.owedMinor) * shareFraction)) : 0n;
		const equity = current.valueMinor - owed;
		const currentTenancy =
			tenancies.find(
				(t) =>
					t.propertyId === current.id &&
					(!t.endDate || t.endDate >= new Date().toISOString().slice(0, 10))
			) ?? null;

		const metrics = [
			{
				label: 'Est. value',
				value: formatMinor(current.valueMinor, current.currency),
				color: 'var(--fg1)',
				note: current.valuedAt ? `valued ${current.valuedAt.slice(0, 7)}` : 'set a value'
			},
			{
				label: 'Mortgage owed',
				value: mortgage ? formatMinor(owed, mortgage.currency) : '—',
				color: 'var(--red)',
				note: mortgage
					? `${mortgage.lender || mortgage.name}${shareFraction < 1 ? ` · ${(shareFraction * 100).toFixed(0)}% share` : ''}`
					: 'no linked loan'
			},
			{
				label: 'Equity',
				value: formatMinor(equity, current.currency),
				color: 'var(--green)',
				note:
					current.valueMinor > 0n ? `${Number((equity * 100n) / current.valueMinor)}% of value` : ''
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
			const monthlyBills = bills
				.filter((b) => b.propertyId === current.id)
				.reduce((s, b) => s + b.amountMinor, 0n);
			const mortgagePayment = currentMortgagePeriod?.paymentMinor ?? 0n;
			const cashFlow = currentTenancy.rentMinor - monthlyBills - mortgagePayment;
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
				note: 'deposit, fees, principal'
			});
			const appreciation =
				current.moneyInMinor > 0n && current.valueMinor > 0n && current.boughtYear ? null : null;
			void appreciation;
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
					file: doc?.storedName ?? null
				};
			});
		const billsTotal = formatMinor(
			bills.filter((b) => b.propertyId === current.id).reduce((s, b) => s + b.amountMinor, 0n),
			current.currency
		);

		let lease = null;
		if (currentTenancy) {
			const days = currentTenancy.endDate ? daysUntil(currentTenancy.endDate) : null;
			lease = {
				tenantName: currentTenancy.tenantName,
				tenantInitials: initialsFor(currentTenancy.tenantName),
				tenantContact: currentTenancy.tenantContact,
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
					{ label: 'Rent', value: `${formatMinor(currentTenancy.rentMinor, current.currency)} Kč` },
					{
						label: 'Deposit held',
						value: `${formatMinor(currentTenancy.depositMinor, current.currency)} Kč`
					},
					{ label: 'Lease ends', value: currentTenancy.endDate ?? 'open-ended' },
					{ label: 'Since', value: currentTenancy.startDate ?? '—' }
				],
				renewalNotice: currentTenancy.renewalNoticeDate
			};
		}

		let mortgageCard = null;
		if (mortgage) {
			const repaid = mortgage.principalMinor - mortgage.owedMinor;
			const rate = currentMortgagePeriod?.annualRatePct ?? null;
			const fix = mortgagePeriods.find(
				(p) => p.endDate !== null && p.endDate > new Date().toISOString().slice(0, 10)
			);
			mortgageCard = {
				fixation: fix
					? `fixed ${rate?.toFixed(2)}% to ${fix.endDate!.slice(0, 7)}`
					: rate !== null
						? `${rate.toFixed(2)}%`
						: '',
				paidPct:
					mortgage.principalMinor > 0n
						? Number((repaid * 1000n) / mortgage.principalMinor) / 10
						: 0,
				paidNote: `${formatMinor(repaid, mortgage.currency)} of ${formatMinor(mortgage.principalMinor, mortgage.currency)} repaid · ${formatMinor(mortgage.owedMinor, mortgage.currency)} owed`
			};
		}

		// Documents are linked by document_property — a real key, so renaming the
		// flat cannot orphan its contracts.
		const today2 = new Date().toISOString().slice(0, 10);
		const docLinks = await db
			.select()
			.from(documentProperty)
			.where(eq(documentProperty.propertyId, current.id));
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
			.from(propertyTag)
			.innerJoin(tag, eq(propertyTag.tagId, tag.id))
			.where(eq(propertyTag.propertyId, current.id));
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
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing property.' });
		const existing = await db
			.select({ name: tag.name })
			.from(propertyTag)
			.innerJoin(tag, eq(propertyTag.tagId, tag.id))
			.where(eq(propertyTag.propertyId, id));
		const added = String(form.get('tagName') ?? '').trim();
		const removed = String(form.get('removeTag') ?? '').trim();
		const names = existing.map((r) => r.name).filter((n) => n !== removed);
		if (added && !names.some((n) => normaliseTagName(n) === normaliseTagName(added)))
			names.push(added);
		await setPropertyTags(id, names);
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
			id: randomUUID(),
			name,
			sizeLabel: String(form.get('sizeLabel') ?? '').trim(),
			kind: String(form.get('kind') ?? 'lived'),
			currency,
			valueMinor: value,
			valuedAt: value > 0n ? new Date().toISOString().slice(0, 10) : null,
			moneyInMinor: moneyIn,
			boughtYear: Number(form.get('boughtYear')) || null
		});
		return { ok: true };
	},

	uploadImage: async ({ request }) => {
		const form = await request.formData();
		const propertyId = String(form.get('propertyId') ?? '');
		const slot = String(form.get('slot') ?? ''); // plan | photo0 | photo1 | photo2
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { message: 'Pick a file.' });
		const rows = await db.select().from(property).where(eq(property.id, propertyId));
		const row = rows[0];
		if (!row) return fail(404, { message: 'Property not found.' });
		let name: string;
		try {
			name = await saveUpload(file);
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
		}
		// compact away holes from the old fixed-slot days so indices stay in
		// step with the photo strip the user sees
		const images = { ...row.images, photos: row.images.photos.filter(Boolean) };
		if (slot === 'plan') {
			images.plan = name;
		} else {
			const index = Number(slot.replace('photo', ''));
			if (!Number.isInteger(index) || index < 0 || index > images.photos.length) {
				return fail(400, { message: 'Unknown image slot.' });
			}
			images.photos[index] = name;
		}
		await db.update(property).set({ images }).where(eq(property.id, propertyId));
		return { ok: true };
	},

	savePlan: async ({ request }) => {
		const form = await request.formData();
		const propertyId = String(form.get('propertyId') ?? '');
		const rows = await db.select().from(property).where(eq(property.id, propertyId));
		const row = rows[0];
		if (!row) return fail(404, { message: 'Property not found.' });
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(form.get('drawing') ?? ''));
		} catch {
			return fail(400, { message: 'The plan did not parse.' });
		}
		const drawing = validateDrawing(parsed);
		if (!drawing) return fail(400, { message: 'The plan did not validate.' });
		await db
			.update(property)
			.set({ images: { ...row.images, drawing: drawing.rooms.length ? drawing : undefined } })
			.where(eq(property.id, propertyId));
		return { ok: true };
	},

	addTenancy: async ({ request }) => {
		const form = await request.formData();
		const propertyId = String(form.get('propertyId') ?? '');
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
		await db.insert(tenancy).values({
			id: randomUUID(),
			propertyId,
			tenantName,
			tenantContact: String(form.get('tenantContact') ?? '').trim(),
			rentMinor: rent,
			depositMinor: deposit,
			startDate: String(form.get('startDate') ?? '').trim() || null,
			endDate: String(form.get('endDate') ?? '').trim() || null,
			renewalNoticeDate: String(form.get('renewalNoticeDate') ?? '').trim() || null
		});
		return { ok: true };
	},

	addBill: async ({ request }) => {
		const form = await request.formData();
		const propertyId = String(form.get('propertyId') ?? '');
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
		const file = form.get('file');
		if (file instanceof File && file.size > 0) {
			let storedName: string;
			try {
				storedName = await saveUpload(file);
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			documentId = randomUUID();
			await db.insert(document).values({
				id: documentId,
				name: `${label} · ${rows[0].name}`,
				shelf: 'property',
				storedName,
				ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
				addedOn: new Date().toISOString().slice(0, 10)
			});
			await db
				.insert(documentProperty)
				.values({ documentId, propertyId: rows[0].id })
				.onConflictDoNothing();
			const billTag = await upsertTag('bill');
			await db.insert(documentTag).values({ documentId, tagId: billTag.id }).onConflictDoNothing();
		}

		await db
			.insert(propertyBill)
			.values({ id: randomUUID(), propertyId, label, amountMinor: amount, documentId });
		return { ok: true };
	}
};
