// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a document can be filed against, and how to read the paper filed there.
 *
 * `document_link` points at `entity`, so any registered kind is fileable; this
 * is the one list describing each kind's group label, whether the document
 * side may pick it, and the expression that turns a row into a recognisable
 * name — read by every screen rather than repeated per screen.
 *
 * The archive rule is NOT restated here: `archiveScopePredicate` is applied
 * as an SQL fragment in the one query that answers "what is filed against
 * this record", so it can't differ per screen.
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { displayCurrency, formatMinor } from '$lib/money';
import type { DocumentTypeKey, EnumValue } from '$lib/enums';
import {
	account,
	bottle,
	contact,
	document,
	documentLink,
	documentType,
	entity,
	loan,
	organisation,
	person,
	property,
	recipe,
	recipeCategory,
	shelf,
	subject,
	tag,
	tagLink,
	taxStatement,
	tenancy,
	transaction,
	trip
} from '$lib/server/db/schema';
import { archiveScopePredicate, assertDocumentExists, NO_SUCH_DOCUMENT } from './visibility';

/**
 * Every kind of record a document can be filed against.
 *
 * `ENTITY_KINDS` minus three deliberate absences: a document is not filed
 * against another document, a tag is a link of its own kind, and a split's
 * paper belongs to the transaction it came from.
 *
 * The order is the order a picker shows its groups in.
 */
export const DOCUMENT_TARGET_KINDS = [
	'person',
	'property',
	'tenancy',
	'account',
	'loan',
	'contact',
	'subject',
	'transaction',
	'tax_statement',
	'organisation',
	'trip',
	'bottle',
	'recipe'
] as const;

export type DocumentTargetKind = (typeof DOCUMENT_TARGET_KINDS)[number];

/** One record, named the way a person would recognise it. */
export interface TargetRow {
	id: string;
	kind: DocumentTargetKind;
	name: string;
	/** A second line where the name alone is ambiguous: an amount, a filer. */
	meta?: string;
	/** Subjects only — an archived subject demotes its paper but stays pickable. */
	archived?: boolean;
}

interface TargetKindSpec {
	kind: DocumentTargetKind;
	/** Plural, for the heading over a group of chips or picker options. */
	groupLabel: string;
	/**
	 * May the DOCUMENT side choose this kind?
	 *
	 * A transaction or a tax statement is linked from its own screen instead —
	 * a picker listing every transaction would be unsearchable by eye. Still
	 * shown on the document as read-only chips.
	 */
	pickable: boolean;
	/**
	 * `select id, <label expr> as name from <table>` — the label expression, once.
	 *
	 * Search Tier B and the Documents about-filter both join this, so the name
	 * a person searches for is the name they saw.
	 */
	nameSql: SQL;
	/**
	 * The same rows in JS. `ids` narrows to the rows a caller actually has to
	 * name, so naming three links doesn't mean reading the whole ledger.
	 */
	load(handle?: Queryable, ids?: readonly string[]): Promise<TargetRow[]>;
}

/** What a card shows for one piece of filed paper. */
export interface AboutDocument {
	id: string;
	name: string;
	ext: string;
	storedName: string | null;
	type: DocumentTypeKey;
	shelfKey: string;
	shelfLabel: string;
	expiresOn: string | null;
	expiryVerb: EnumValue<'document.expiry_verb'>;
	addedOn: string;
	/**
	 * The amber window this KIND of paper earns, or null for the default.
	 *
	 * Carried on the row rather than handed to the card as a prop: a card draws
	 * many types at once, and the window is a fact about the document.
	 */
	reminderDays: number | null;
	tags: string[];
}

/** A document that could be attached to a record but is not yet. */
export interface CandidateDocument {
	id: string;
	name: string;
	ext: string;
	shelfLabel: string;
}

type AttachmentResult = { ok: true } | { ok: false; status: 404; message: string };

/** The same wording as a missing document, for a record that is missing. */
const NO_SUCH_RECORD = 'That record is not there.';

/** What a kind needs beyond its name, and how to read it back. */
interface KindExtras {
	columns: SQL;
	join: SQL;
	read(raw: Record<string, unknown>): Partial<TargetRow>;
}

interface KindDefinition {
	groupLabel: string;
	pickable: boolean;
	nameSql: SQL;
	extras?: KindExtras;
}

/**
 * One entry, with `load` built from the same `nameSql` the search union uses,
 * so a picker can never label a row differently from how search matches it.
 */
function defineKind(kind: DocumentTargetKind, definition: KindDefinition): TargetKindSpec {
	const columns = definition.extras ? sql`, ${definition.extras.columns}` : sql``;
	const join = definition.extras ? definition.extras.join : sql``;

	return {
		kind,
		groupLabel: definition.groupLabel,
		pickable: definition.pickable,
		nameSql: definition.nameSql,
		async load(handle: Queryable = db, ids?: readonly string[]): Promise<TargetRow[]> {
			// Nothing asked for is nothing to ask.
			if (ids !== undefined && ids.length === 0) return [];
			const where =
				ids === undefined
					? sql``
					: sql`where t.id in (${sql.join(
							ids.map((id) => sql`${id}`),
							sql`, `
						)})`;
			const rows = (await handle.execute(sql`
				select t.id, t.name${columns}
				from (${definition.nameSql}) t
				${join}
				${where}
				order by t.name
			`)) as unknown as Record<string, unknown>[];
			return [...rows].map((raw) => ({
				id: String(raw.id),
				kind,
				name: String(raw.name),
				archived: false,
				...(definition.extras ? definition.extras.read(raw) : {})
			}));
		}
	};
}

const REGISTRY: Record<DocumentTargetKind, TargetKindSpec> = {
	person: defineKind('person', {
		groupLabel: 'People',
		pickable: true,
		nameSql: sql`select ${person.id} as id, ${person.name} as name from ${person}`
	}),
	property: defineKind('property', {
		groupLabel: 'Property',
		pickable: true,
		nameSql: sql`select ${property.id} as id, ${property.name} as name from ${property}`
	}),
	tenancy: defineKind('tenancy', {
		groupLabel: 'Tenancies',
		pickable: true,
		// A tenant's name alone doesn't say which flat; the pair is what a person recognises.
		nameSql: sql`
			select ${tenancy.id} as id,
			       ${property.name} || ' · ' || ${tenancy.tenantName} as name
			from ${tenancy}
			join ${property} on ${property.id} = ${tenancy.propertyId}`
	}),
	account: defineKind('account', {
		groupLabel: 'Accounts',
		pickable: true,
		// Every kind of account — a current account's statements are paper too.
		nameSql: sql`select ${account.id} as id, ${account.name} as name from ${account}`
	}),
	loan: defineKind('loan', {
		groupLabel: 'Loans',
		pickable: true,
		nameSql: sql`select ${loan.id} as id, ${loan.name} as name from ${loan}`
	}),
	contact: defineKind('contact', {
		groupLabel: 'Contacts',
		pickable: true,
		nameSql: sql`select ${contact.id} as id, ${contact.name} as name from ${contact}`
	}),
	organisation: defineKind('organisation', {
		groupLabel: 'Organisations',
		// Pickable, unlike a transaction: an employer is a short list a person can find by eye.
		pickable: true,
		nameSql: sql`select ${organisation.id} as id, ${organisation.name} as name from ${organisation}`,
		// The kind as a second line: "ČSSZ" and "VZP" are initialisms a person
		// half-remembers, and `employer`/`authority` tells them apart.
		extras: {
			columns: sql`${organisation.kind} as org_kind`,
			join: sql`join ${organisation} on ${organisation.id} = t.id`,
			read: (raw) => ({ meta: String(raw.org_kind ?? '') })
		}
	}),
	subject: defineKind('subject', {
		groupLabel: 'Subjects',
		pickable: true,
		nameSql: sql`select ${subject.id} as id, ${subject.name} as name from ${subject}`,
		// Archived subjects stay pickable and say so: archiving demotes the paper, not the subject.
		extras: {
			columns: sql`(${subject.archivedAt} is not null) as archived`,
			join: sql`join ${subject} on ${subject.id} = t.id`,
			read: (raw) => ({ archived: raw.archived === true })
		}
	}),
	transaction: defineKind('transaction', {
		groupLabel: 'Transactions',
		pickable: false,
		// `description` behind `counterparty`: a card payment often has only one of the two.
		nameSql: sql`
			select ${transaction.id} as id,
			       coalesce(${transaction.counterparty}, ${transaction.description}, '')
			         || ' ' || ${transaction.bookedOn} as name
			from ${transaction}`,
		extras: {
			// Formatted in JS, not SQL: decimal count is a fact about currency, known by `formatMinor`.
			columns: sql`${transaction.amountMinor}::text as amount_minor, ${transaction.currency} as currency`,
			join: sql`join ${transaction} on ${transaction.id} = t.id`,
			read: (raw) => {
				const currency = String(raw.currency);
				const amount = formatMinor(BigInt(String(raw.amount_minor)), currency, { signed: true });
				return { meta: `${amount} ${displayCurrency(currency)}` };
			}
		}
	}),
	tax_statement: defineKind('tax_statement', {
		groupLabel: 'Tax statements',
		pickable: false,
		nameSql: sql`
			select ${taxStatement.id} as id,
			       ${taxStatement.year} || ' ' || ${taxStatement.country} as name
			from ${taxStatement}`,
		// Two people can file for the same year in the same country; the filer tells them apart.
		extras: {
			columns: sql`${person.name} as meta`,
			join: sql`
				join ${taxStatement} on ${taxStatement.id} = t.id
				join ${person} on ${person.id} = ${taxStatement.personId}`,
			read: (raw) => ({ meta: raw.meta == null ? undefined : String(raw.meta) })
		}
	}),
	trip: defineKind('trip', {
		groupLabel: 'Trips',
		pickable: true,
		nameSql: sql`select ${trip.id} as id, ${trip.name} as name from ${trip}`,
		// Two trips to the same place years apart share a name; the year tells them apart.
		extras: {
			columns: sql`to_char(${trip.startsOn}, 'YYYY') as meta`,
			join: sql`join ${trip} on ${trip.id} = t.id`,
			read: (raw) => ({ meta: raw.meta == null ? undefined : String(raw.meta) })
		}
	}),
	bottle: defineKind('bottle', {
		groupLabel: 'Bottles',
		pickable: true,
		// Producer in front of the name: "the Lagavulin 16", not "the 16".
		nameSql: sql`
			select ${bottle.id} as id,
			       trim(coalesce(${bottle.producer}, '') || ' ' || ${bottle.name}) as name
			from ${bottle}`,
		// The vintage, where there is one.
		extras: {
			columns: sql`${bottle.vintage}::text as meta`,
			join: sql`join ${bottle} on ${bottle.id} = t.id`,
			read: (raw) => ({ meta: raw.meta == null ? undefined : String(raw.meta) })
		}
	}),
	recipe: defineKind('recipe', {
		groupLabel: 'Recipes',
		pickable: true,
		nameSql: sql`select ${recipe.id} as id, ${recipe.name} as name from ${recipe}`,
		extras: {
			columns: sql`${recipeCategory.name} as meta`,
			join: sql`
				join ${recipe} on ${recipe.id} = t.id
				join ${recipeCategory} on ${recipeCategory.id} = ${recipe.categoryId}`,
			read: (raw) => ({ meta: raw.meta == null ? undefined : String(raw.meta) })
		}
	})
};

export function documentTargetSpec(kind: DocumentTargetKind): TargetKindSpec {
	return REGISTRY[kind];
}

/** Whether a string off a URL or a form is a kind a document can be filed against. */
export function isDocumentTargetKind(value: string): value is DocumentTargetKind {
	return (DOCUMENT_TARGET_KINDS as readonly string[]).includes(value);
}

/**
 * Names for linkable records, by kind and then by id.
 *
 * One query per kind rather than one per link, so a screen with a hundred
 * documents doesn't fetch the same list a hundred times.
 *
 * `ids` narrows this; without it every kind is read whole (for `transaction`,
 * the entire ledger). Callers who know their ids pass them; a picker wanting
 * the whole list doesn't.
 *
 * The same id is offered to every kind rather than sorted by kind first: which
 * table a `document_link` points at isn't knowable without asking, and eight
 * indexed misses cost less than the round trip to find out.
 */
export async function loadTargetNames(
	handle: Queryable = db,
	ids?: Iterable<string>
): Promise<Map<DocumentTargetKind, Map<string, TargetRow>>> {
	const wanted = ids === undefined ? undefined : [...new Set(ids)];
	const loaded = await Promise.all(
		DOCUMENT_TARGET_KINDS.map(async (kind) => {
			const rows = await REGISTRY[kind].load(handle, wanted);
			return [kind, new Map(rows.map((row) => [row.id, row]))] as const;
		})
	);
	return new Map(loaded);
}

/** The kinds a picker may offer, in group order and named within each group. */
export async function loadPickableTargets(handle: Queryable = db): Promise<TargetRow[]> {
	const kinds = DOCUMENT_TARGET_KINDS.filter((kind) => REGISTRY[kind].pickable);
	const groups = await Promise.all(kinds.map((kind) => REGISTRY[kind].load(handle)));
	return groups.flat();
}

/**
 * The chips About offers, narrowed to the shelf.
 *
 * A document belongs to one shelf and never links across shelves, so a car's
 * paper is offered the cars and not the boiler.
 *
 * `all` and the Inbox offer everything: neither is a shelf with a unit.
 */
export async function pickableTargetsForShelf(
	shelfRow: { id: string; unit: string } | null,
	handle: Queryable = db
): Promise<TargetRow[]> {
	if (!shelfRow || shelfRow.unit === 'document') return loadPickableTargets(handle);

	const kind = shelfRow.unit as DocumentTargetKind;
	if (!DOCUMENT_TARGET_KINDS.includes(kind)) return loadPickableTargets(handle);
	const rows = await REGISTRY[kind].load(handle);

	// Subjects and organisations carry a home shelf; a person, an account and a
	// property belong to the household rather than to one shelf.
	if (kind !== 'subject' && kind !== 'organisation') return rows;
	const homed = await homedOn(kind, shelfRow.id, handle);
	return rows.filter((row) => homed.has(row.id));
}

/** The ids of one kind homed on one shelf. */
async function homedOn(
	kind: 'subject' | 'organisation',
	shelfId: string,
	handle: Queryable
): Promise<Set<string>> {
	const table = kind === 'subject' ? subject : organisation;
	const rows = await handle.select({ id: table.id }).from(table).where(eq(table.shelfId, shelfId));
	return new Set(rows.map((r) => r.id));
}

/**
 * The paper filed against one record — THE query behind every documents card.
 *
 * The archive rule is in the `where`, so a card on the loans screen demotes
 * exactly what the Documents screen demotes. Tags come back in a second query
 * keyed by document, not one per row.
 *
 * `targetId` is checked against the registry first — the same check
 * `attachDocument` has — so a stray `document_link` row cannot surface paper
 * against something that isn't a fileable record.
 */
export async function documentsAbout(
	targetId: string,
	handle: Queryable = db,
	{ includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<AboutDocument[]> {
	if (!(await isFileableTarget(targetId, handle))) return [];

	const rows = await handle
		.select({
			id: document.id,
			name: document.name,
			ext: document.ext,
			storedName: document.storedName,
			type: document.type,
			shelfKey: shelf.key,
			shelfLabel: shelf.label,
			expiresOn: document.expiresOn,
			expiryVerb: document.expiryVerb,
			addedOn: document.addedOn,
			reminderDays: documentType.reminderDays
		})
		.from(documentLink)
		.innerJoin(document, eq(document.id, documentLink.documentId))
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(and(eq(documentLink.targetId, targetId), archiveScopePredicate(includeArchived)))
		.orderBy(document.name, document.id);

	if (rows.length === 0) return [];

	// A document's tags hang on its own entity row, so a tag link's target id IS the document id.
	const tagRows = await handle
		.select({ documentId: tagLink.targetId, name: tag.name })
		.from(tagLink)
		.innerJoin(tag, eq(tag.id, tagLink.tagId))
		.where(
			inArray(
				tagLink.targetId,
				rows.map((row) => row.id)
			)
		)
		.orderBy(tag.name);

	const tagsByDocument = new Map<string, string[]>();
	for (const row of tagRows) {
		tagsByDocument.set(row.documentId, [...(tagsByDocument.get(row.documentId) ?? []), row.name]);
	}

	return rows.map((row) => ({ ...row, tags: tagsByDocument.get(row.id) ?? [] }));
}

/**
 * Whether there is such a document at all.
 *
 * Through `assertDocumentExists` rather than its own query, so there is one
 * place to change the answer.
 */
async function documentExists(documentId: string, handle: Queryable): Promise<boolean> {
	return (await assertDocumentExists(documentId, handle)).ok;
}

/**
 * Whether this id names a record of a kind this registry manages.
 *
 * `document_link.target_id` references `entity`, so the FK accepts any
 * entity including another document; this is the one check that says which
 * are actually fileable, shared by every entry point.
 */
async function isFileableTarget(targetId: string, handle: Queryable): Promise<boolean> {
	const [record] = await handle
		.select({ kind: entity.kind })
		.from(entity)
		.where(eq(entity.id, targetId))
		.limit(1);
	return !!record && isDocumentTargetKind(record.kind);
}

/**
 * File an existing document against a record.
 *
 * Existence-checked on both sides: a link may not be written from an id that names nothing.
 *
 * Idempotent, because the link's primary key is the pair — attaching twice is
 * the same state rather than an error.
 */
export async function attachDocument(
	targetId: string,
	documentId: string,
	handle: Queryable = db
): Promise<AttachmentResult> {
	if (!(await isFileableTarget(targetId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_RECORD };
	}
	if (!(await documentExists(documentId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
	}

	await handle.insert(documentLink).values({ documentId, targetId }).onConflictDoNothing();
	return { ok: true };
}

/**
 * Remove the link only.
 *
 * The document stays: it belongs to the household and its own shelf, not to
 * the row it happened to hang on. Deleting it would destroy evidence to undo
 * a mis-click.
 *
 * Same existence and target-kind checks as `attachDocument`: a missing or
 * unfileable target is a 404 here too, not silently a no-op delete.
 */
export async function detachDocument(
	targetId: string,
	documentId: string,
	handle: Queryable = db
): Promise<AttachmentResult> {
	if (!(await isFileableTarget(targetId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_RECORD };
	}
	if (!(await documentExists(documentId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
	}
	await handle
		.delete(documentLink)
		.where(and(eq(documentLink.documentId, documentId), eq(documentLink.targetId, targetId)));
	return { ok: true };
}

/**
 * What "Attach existing" may offer, for every one of several records at once:
 * current, and not already linked to THAT record.
 *
 * One query for the library and one for `document_link`, with the
 * not-yet-linked subtraction done in JS per target rather than a NOT EXISTS
 * per record — fetching the library once instead of N times.
 *
 * `targetIds` with nothing in it is nothing to ask.
 *
 * Each target's kind is checked against the registry too, in one batched
 * query, so a document offered as a target of itself gets an empty list
 * instead of the whole library.
 */
export async function candidateDocumentsFor(
	targetIds: readonly string[],
	handle: Queryable = db
): Promise<Map<string, CandidateDocument[]>> {
	if (targetIds.length === 0) return new Map();

	const [current, links, kinds] = await Promise.all([
		handle
			.select({
				id: document.id,
				name: document.name,
				ext: document.ext,
				shelfLabel: shelf.label
			})
			.from(document)
			.innerJoin(shelf, eq(shelf.id, document.shelfId))
			.where(archiveScopePredicate(false))
			.orderBy(document.name, document.id),
		handle
			.select({ targetId: documentLink.targetId, documentId: documentLink.documentId })
			.from(documentLink)
			.where(inArray(documentLink.targetId, targetIds)),
		handle
			.select({ id: entity.id, kind: entity.kind })
			.from(entity)
			.where(inArray(entity.id, targetIds))
	]);

	const fileableTargetIds = new Set(
		kinds.filter((row) => isDocumentTargetKind(row.kind)).map((row) => row.id)
	);

	const linkedByTarget = new Map<string, Set<string>>();
	for (const link of links) {
		const linked = linkedByTarget.get(link.targetId);
		if (linked) linked.add(link.documentId);
		else linkedByTarget.set(link.targetId, new Set([link.documentId]));
	}

	// `current` is already sorted by name; filtering preserves that order.
	return new Map(
		targetIds.map((targetId) => {
			if (!fileableTargetIds.has(targetId)) return [targetId, []] as const;
			const linked = linkedByTarget.get(targetId);
			const candidates = linked ? current.filter((doc) => !linked.has(doc.id)) : current;
			return [targetId, candidates] as const;
		})
	);
}

/**
 * The single-record shape most screens want. A thin wrapper over
 * `candidateDocumentsFor`, so the two can't drift apart.
 */
export async function candidateDocuments(
	targetId: string,
	handle: Queryable = db
): Promise<CandidateDocument[]> {
	const byTarget = await candidateDocumentsFor([targetId], handle);
	return byTarget.get(targetId) ?? [];
}
