// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { db, type Db, type Queryable } from '$lib/server/db';
import { contact, contactLink, property, propertyBill, tenancy } from '$lib/server/db/schema';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { tenancyRangesOverlap } from '$lib/property/tenancy';
import { normalise } from '$lib/rules/match';
import { uuidv7 } from 'uuidv7';
import { validateDrawing } from '$lib/plan';
import { parseAmountToMinor } from '$lib/money';
import { and, eq } from 'drizzle-orm';

type PropertyMutationResult =
	{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string };

const missingProperty = (): PropertyMutationResult => ({
	ok: false,
	status: 404,
	message: 'Property not found.'
});

interface AttachedBillDocumentInput {
	id: string;
	name: string;
	storedName: string;
	ext: string;
	addedOn: string;
	/** SHA-256 of the bytes behind `storedName`, from `hashBytes`. */
	contentHash?: string | null;
}

interface CreatePropertyBillInput {
	id: string;
	propertyId: string;
	label: string;
	amountMinor: bigint;
	document: AttachedBillDocumentInput | null;
}

export async function createPropertyBill(
	input: CreatePropertyBillInput,
	handle: Db = db
): Promise<void> {
	await handle.transaction(async (tx) => {
		await tx
			.select({ id: property.id })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');

		if (input.document) {
			await insertDocumentAggregate(
				{
					...input.document,
					shelfId: await shelfIdByKey('property', tx),
					// A utility bill is an invoice; the shelf says where it lives,
					// the type says what it is.
					type: 'invoice',
					expiresOn: null,
					expiryVerb: 'expires',
					personIds: [],
					propertyIds: [input.propertyId],
					accountIds: [],
					transactionIds: [],
					subjectIds: [],
					tagNames: ['bill']
				},
				tx
			);
		}

		await tx.insert(propertyBill).values({
			id: input.id,
			propertyId: input.propertyId,
			label: input.label,
			amountMinor: input.amountMinor,
			documentId: input.document?.id ?? null
		});
	});
	// After the commit, never inside it: a queued job pointing at a document
	// the transaction went on to roll back is work with nothing to read.
	if (input.document) await enqueueExtraction(input.document.id, handle);
}

interface CreateTenancyInput {
	id: string;
	propertyId: string;
	tenantName: string;
	rentMinor: bigint;
	depositMinor: bigint;
	startsOn: string | null;
	endsOn: string | null;
	renewalNoticeOn: string | null;
}

function isIsoDay(day: string | null): boolean {
	if (day === null) return true;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
	const parsed = new Date(`${day}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export async function createTenancy(
	input: CreateTenancyInput,
	handle: Db = db
): Promise<PropertyMutationResult> {
	if (
		!isIsoDay(input.startsOn) ||
		!isIsoDay(input.endsOn) ||
		!isIsoDay(input.renewalNoticeOn) ||
		(input.startsOn !== null && input.endsOn !== null && input.startsOn > input.endsOn)
	) {
		return { ok: false, status: 400, message: 'The tenancy dates are not valid.' };
	}

	return handle.transaction(async (tx) => {
		const owners = await tx
			.select({ id: property.id })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');
		if (!owners[0]) return missingProperty();

		const existing = await tx
			.select()
			.from(tenancy)
			.where(eq(tenancy.propertyId, input.propertyId));
		if (existing.some((row) => tenancyRangesOverlap(row, input))) {
			return {
				ok: false,
				status: 409,
				message: 'That tenancy overlaps an existing tenancy.'
			};
		}

		await tx.insert(tenancy).values(input);
		await linkTenantContact(tx, input.id, input.tenantName);
		return { ok: true };
	});
}

/**
 * Attach the tenant to the address book, reusing their contact if they are
 * already in it.
 *
 * Adding a tenant used to leave Contacts untouched, so the person you had just
 * agreed a lease with was not in the address book and had to be typed in a
 * second time.
 *
 * Matching is on the normalised name — case-folded, diacritics stripped — so
 * "martin dvorak" typed in a hurry finds the existing "Martin Dvořák" instead
 * of creating a near-duplicate nobody would spot. That is an exact match on a
 * normalised string, not a fuzzy one: two different people who genuinely share
 * a name would still be merged here, and the alternative — silently creating a
 * second record every time — is the bug being fixed. Splitting them afterwards
 * is possible from Contacts; finding a duplicate you never saw is not.
 *
 * Runs inside the caller's transaction, so a tenancy refused for overlapping
 * cannot leave a contact behind.
 */
async function linkTenantContact(tx: Queryable, tenancyId: string, tenantName: string) {
	const wanted = normalise(tenantName);
	if (!wanted) return;

	const existing = (await tx.select({ id: contact.id, name: contact.name }).from(contact)).find(
		(row) => normalise(row.name) === wanted
	);

	const contactId = existing?.id ?? uuidv7();
	if (!existing) {
		await tx.insert(contact).values({
			id: contactId,
			name: tenantName.trim(),
			// Enough for the Contacts screen to group them; everything else about
			// them is added there, where there is room for it.
			category: 'tenant'
		});
	}

	// The tenancy row above registered itself in `entity` by trigger, which is
	// what this foreign key points at.
	await tx.insert(contactLink).values({ contactId, targetId: tenancyId }).onConflictDoNothing();
}

interface SetPropertyFigureInput {
	propertyId: string;
	/** Only the two figures the property actually stores. */
	field: 'value' | 'moneyIn';
	amount: string;
	/** The day the estimate is as of. Ignored for `moneyIn`. */
	valuedOn: string | null;
}

/**
 * Correct one stored figure on a property.
 *
 * Only two of the numbers on that screen are stored — the estimated value and
 * what has been put in. Mortgage owed, equity, rent yield, cash flow and
 * appreciation are all computed from the loans and the tenancy, and offering a
 * pencil on those would promise an edit the next recompute silently discards.
 * They are explained instead.
 */
export async function setPropertyFigure(
	input: SetPropertyFigureInput,
	handle: Db = db
): Promise<PropertyMutationResult> {
	if (input.valuedOn !== null && !isIsoDay(input.valuedOn)) {
		return { ok: false, status: 400, message: 'That is not a valid date.' };
	}

	return handle.transaction(async (tx) => {
		const rows = await tx
			.select({ id: property.id, currency: property.currency })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');
		const row = rows[0];
		if (!row) return missingProperty();

		let minor: bigint;
		try {
			minor = parseAmountToMinor(input.amount, row.currency);
		} catch {
			return { ok: false as const, status: 400, message: 'That is not an amount.' };
		}
		if (minor < 0n) {
			return { ok: false as const, status: 400, message: 'That cannot be negative.' };
		}

		if (input.field === 'value') {
			await tx
				.update(property)
				// The date the estimate is as of, not the date it was typed: the screen
				// prints "valued 2026-08" beside it, and a wrong date there makes a
				// stale estimate look current.
				.set({ valueMinor: minor, valuedOn: input.valuedOn })
				.where(eq(property.id, input.propertyId));
		} else {
			// Deliberately leaves valuedOn alone. Money in is not a valuation.
			await tx
				.update(property)
				.set({ moneyInMinor: minor })
				.where(eq(property.id, input.propertyId));
		}
		return { ok: true as const };
	});
}

interface SetPropertyImageInput {
	propertyId: string;
	slot: string;
	storedName: string;
	/** Null means the UI was appending to its empty final slot. */
	expectedImage: string | null;
}

export async function setPropertyImage(
	input: SetPropertyImageInput,
	handle: Db = db
): Promise<PropertyMutationResult> {
	return handle.transaction(async (tx) => {
		const rows = await tx
			.select({ images: property.images })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');
		const row = rows[0];
		if (!row) return missingProperty();

		const images = { ...row.images, photos: row.images.photos.filter(Boolean) };
		if (input.slot === 'plan') {
			if ((images.plan ?? null) !== input.expectedImage) {
				return { ok: false, status: 409, message: 'That image changed. Try again.' };
			}
			images.plan = input.storedName;
		} else {
			const match = input.slot.match(/^photo(\d+)$/);
			if (!match) return { ok: false, status: 400, message: 'Unknown image slot.' };
			const index = Number(match[1]);
			if (!Number.isSafeInteger(index) || index > images.photos.length) {
				return { ok: false, status: 400, message: 'Unknown image slot.' };
			}
			if (input.expectedImage === null) {
				// A second append may arrive with the same stale final-slot index. It
				// is still an append, never permission to overwrite the first file.
				images.photos.push(input.storedName);
			} else {
				if (images.photos[index] !== input.expectedImage) {
					return { ok: false, status: 409, message: 'That image changed. Try again.' };
				}
				images.photos[index] = input.storedName;
			}
		}

		await tx.update(property).set({ images }).where(eq(property.id, input.propertyId));
		return { ok: true };
	});
}

interface SetPropertyDrawingInput {
	propertyId: string;
	drawing: unknown;
}

type RemovePropertyImageResult =
	{ ok: true; removed: string } | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * Detach an image from a property and report which stored file it was.
 *
 * Takes the same `expectedImage` as setting one does: a slot that changed under
 * the person — a second tab, a replace that landed first — must refuse rather
 * than delete whatever happens to be there now. The caller deletes the file
 * only after this commits, so a failed transaction cannot destroy it.
 */
export async function removePropertyImage(
	input: { propertyId: string; slot: string; expectedImage: string },
	handle: Db = db
): Promise<RemovePropertyImageResult> {
	return handle.transaction(async (tx) => {
		const rows = await tx
			.select({ images: property.images })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');
		const row = rows[0];
		if (!row) return { ok: false as const, status: 404 as const, message: 'Property not found.' };

		const images = { ...row.images, photos: row.images.photos.filter(Boolean) };
		const stale = {
			ok: false as const,
			status: 409 as const,
			message: 'That image changed. Try again.'
		};

		if (input.slot === 'plan') {
			if ((images.plan ?? null) !== input.expectedImage) return stale;
			images.plan = undefined;
		} else {
			const match = input.slot.match(/^photo(\d+)$/);
			if (!match)
				return { ok: false as const, status: 400 as const, message: 'Unknown image slot.' };
			const index = Number(match[1]);
			if (images.photos[index] !== input.expectedImage) return stale;
			// Splice, not a hole: the strip renders a dense list, and leaving an
			// empty slot behind would shift every later photo's index.
			images.photos.splice(index, 1);
		}

		await tx.update(property).set({ images }).where(eq(property.id, input.propertyId));
		return { ok: true as const, removed: input.expectedImage };
	});
}

export async function setPropertyDrawing(
	input: SetPropertyDrawingInput,
	handle: Db = db
): Promise<PropertyMutationResult> {
	const drawing = validateDrawing(input.drawing);
	if (!drawing) return { ok: false, status: 400, message: 'The plan did not validate.' };

	return handle.transaction(async (tx) => {
		const rows = await tx
			.select({ images: property.images })
			.from(property)
			.where(eq(property.id, input.propertyId))
			.for('update');
		const row = rows[0];
		if (!row) return missingProperty();
		await tx
			.update(property)
			.set({ images: { ...row.images, drawing: drawing.rooms.length ? drawing : undefined } })
			.where(eq(property.id, input.propertyId));
		return { ok: true };
	});
}

export async function setPropertyBillSource(
	billId: string,
	fromMeter: boolean,
	handle: Db = db
): Promise<PropertyMutationResult> {
	return handle.transaction(async (tx) => {
		const initial = await tx
			.select({ propertyId: propertyBill.propertyId })
			.from(propertyBill)
			.where(eq(propertyBill.id, billId));
		if (!initial[0]) return { ok: false, status: 404, message: 'Bill not found.' };

		const owners = await tx
			.select({ id: property.id })
			.from(property)
			.where(eq(property.id, initial[0].propertyId))
			.for('update');
		if (!owners[0]) return { ok: false, status: 404, message: 'Bill not found.' };

		const current = await tx
			.select({ id: propertyBill.id })
			.from(propertyBill)
			.where(and(eq(propertyBill.id, billId), eq(propertyBill.propertyId, initial[0].propertyId)));
		if (!current[0]) return { ok: false, status: 404, message: 'Bill not found.' };

		if (fromMeter) {
			await tx
				.update(propertyBill)
				.set({ source: 'manual' })
				.where(
					and(eq(propertyBill.propertyId, initial[0].propertyId), eq(propertyBill.source, 'meter'))
				);
		}
		await tx
			.update(propertyBill)
			.set({ source: fromMeter ? 'meter' : 'manual' })
			.where(eq(propertyBill.id, billId));
		return { ok: true };
	});
}

/** Update whichever bill is still meter-backed after locking the property.
 * This shares the source-switch owner lock, so an hourly sync cannot write
 * through a stale bill selection after the user chose another bill. */
export async function updateMeterBillAmount(
	propertyId: string,
	amountMinor: bigint,
	handle: Queryable = db
): Promise<{ id: string; label: string } | null> {
	const operation = async (tx: Queryable) => {
		const owners = await tx
			.select({ id: property.id })
			.from(property)
			.where(eq(property.id, propertyId))
			.for('update');
		if (!owners[0]) return null;

		const current = await tx
			.select({ id: propertyBill.id, label: propertyBill.label })
			.from(propertyBill)
			.where(and(eq(propertyBill.propertyId, propertyId), eq(propertyBill.source, 'meter')));
		if (!current[0]) return null;
		const changed = await tx
			.update(propertyBill)
			.set({ amountMinor })
			.where(
				and(
					eq(propertyBill.id, current[0].id),
					eq(propertyBill.propertyId, propertyId),
					eq(propertyBill.source, 'meter')
				)
			)
			.returning({ id: propertyBill.id });
		return changed[0] ? current[0] : null;
	};

	const transactional = handle as Db;
	return typeof transactional.transaction === 'function'
		? transactional.transaction(operation)
		: operation(handle);
}
