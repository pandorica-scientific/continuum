// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * What a document can be filed against, and how to read the paper filed there.
 *
 * `document_link` points at `entity`, so the database has been able to file a
 * document against any of the twelve registered kinds since the supertype
 * landed. The application had not caught up: five screens each carried their
 * own hand-written list of four kinds — person, property, account, subject —
 * so a kind added to the database reached whichever of them somebody
 * remembered, and the Documents screen offered brokerage accounts only because
 * one of those lists said so.
 *
 * This is that list, once. A kind is described here — what to call its group,
 * whether the document side may pick it, and the expression that turns a row
 * into something a person recognises — and every screen reads the description
 * rather than repeating it.
 *
 * The read rule is NOT restated here. `visibleDocumentPredicate` and
 * `archiveScopePredicate` are applied as SQL fragments in the one query that
 * answers "what is filed against this record", because a rule that is
 * re-implemented per screen is a rule that will differ per screen.
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { displayCurrency, formatMinor } from '$lib/money';
import type { EnumValue } from '$lib/enums';
import {
	account,
	contact,
	document,
	documentLink,
	entity,
	loan,
	person,
	property,
	shelf,
	subject,
	tag,
	tagLink,
	taxStatement,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import {
	archiveScopePredicate,
	visibleDocumentPredicate,
	NO_SUCH_DOCUMENT,
	type Actor
} from './visibility';

/**
 * Every kind of record a document can be filed against.
 *
 * These are `ENTITY_KINDS` minus three, and each absence is a decision rather
 * than an omission: a document is not filed against another document, a tag is
 * a link of its own kind, and a split's paper belongs to the transaction it
 * came from. `tests/integration/document-targets` holds that subtraction, so a
 * thirteenth entity kind cannot be added without this list being considered.
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
	'tax_statement'
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
	 * A transaction or a tax statement is linked from its own screen, where the
	 * row is already in front of the person; offering a list of every transaction
	 * in the capture dialog would be a list nobody can search by eye. They are
	 * still shown on the document as chips — read-only ones.
	 */
	pickable: boolean;
	/**
	 * `select id, <label expr> as name from <table>` — the label expression, once.
	 *
	 * Search Tier B unions these, and the Documents about-filter joins them, so
	 * the name a person searches for is by construction the name they saw.
	 */
	nameSql: SQL;
	/**
	 * The same rows in JS, with whatever else a picker or a name map needs.
	 *
	 * `ids` narrows it to the rows a caller actually has to name. A picker wants
	 * the whole list and passes nothing; a screen naming the links on the paper
	 * in front of it wants three rows and must not read the ledger to get them.
	 */
	load(handle?: Queryable, ids?: readonly string[]): Promise<TargetRow[]>;
}

/**
 * What a card shows for one piece of filed paper.
 *
 * `sensitivity` rides along so an admin's card can draw the lock. It is never
 * what hides a row: a member's query returns restricted paper not at all,
 * because the predicate runs in SQL.
 */
export interface AboutDocument {
	id: string;
	name: string;
	ext: string;
	storedName: string | null;
	type: EnumValue<'document.type'>;
	shelfKey: string;
	shelfLabel: string;
	expiresOn: string | null;
	expiryVerb: EnumValue<'document.expiry_verb'>;
	addedOn: string;
	sensitivity: EnumValue<'document.sensitivity'>;
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
 * One entry, with `load` built from the same `nameSql` the search union uses.
 *
 * Deliberately a subquery over the name expression rather than a second query
 * written by hand: the two would drift, and a picker labelling a row one way
 * while search matches it another is the bug this module exists to remove.
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
			// Nothing asked for is nothing to ask: no query at all, rather than an
			// unbounded one whose result is then thrown away.
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
		// A tenant's name alone does not say which flat, and a flat may have had
		// several tenancies; the pair is what a person recognises.
		nameSql: sql`
			select ${tenancy.id} as id,
			       ${property.name} || ' · ' || ${tenancy.tenantName} as name
			from ${tenancy}
			join ${property} on ${property.id} = ${tenancy.propertyId}`
	}),
	account: defineKind('account', {
		groupLabel: 'Accounts',
		pickable: true,
		// Every kind of account. A current account's statements are paper too;
		// the brokerage-only filter the Documents screen used to apply was a
		// leftover from the one screen that first needed a list.
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
	subject: defineKind('subject', {
		groupLabel: 'Subjects',
		pickable: true,
		nameSql: sql`select ${subject.id} as id, ${subject.name} as name from ${subject}`,
		// Archived subjects stay pickable and say so. Archiving demotes the paper
		// filed under a subject, which is not the same as retiring the subject.
		extras: {
			columns: sql`(${subject.archivedAt} is not null) as archived`,
			join: sql`join ${subject} on ${subject.id} = t.id`,
			read: (raw) => ({ archived: raw.archived === true })
		}
	}),
	transaction: defineKind('transaction', {
		groupLabel: 'Transactions',
		pickable: false,
		// `description` behind `counterparty`, because a card payment often has
		// only one of the two, and an empty string beside a date is not a name.
		nameSql: sql`
			select ${transaction.id} as id,
			       coalesce(${transaction.counterparty}, ${transaction.description}, '')
			         || ' ' || ${transaction.bookedOn} as name
			from ${transaction}`,
		extras: {
			// Formatted in JS, not in SQL: how many decimals an amount has is a
			// fact about its currency, and `formatMinor` is where that is known.
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
		// Two people file for the same year in the same country, so the filer is
		// what tells one statement from the other.
		extras: {
			columns: sql`${person.name} as meta`,
			join: sql`
				join ${taxStatement} on ${taxStatement.id} = t.id
				join ${person} on ${person.id} = ${taxStatement.personId}`,
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
 * One query per kind rather than one per link: a screen showing a hundred
 * documents needs names for whatever they point at, and asking per document is
 * the same list fetched a hundred times.
 *
 * `ids` is how many rows that is. Without it every kind is read whole, which
 * for `transaction` means the household's entire ledger — every row built into
 * a JS object with its amount formatted — to label the two receipts on screen.
 * Callers that know which ids they need pass them and the database does the
 * narrowing; the ones that genuinely want whole lists (the picker) do not.
 *
 * The same id is offered to every kind rather than sorted by kind first: which
 * table a `document_link` points at is not knowable without asking, and eight
 * indexed lookups that miss cost less than the round trip to find out.
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
 * The paper filed against one record — THE query behind every documents card.
 *
 * Both halves of the read rule are in the `where`, so a card on the loans
 * screen hides exactly what the Documents screen hides. Tags come back in a
 * second query keyed by document rather than one query per row: a card with
 * eight documents on it should cost two round trips, not nine.
 *
 * `targetId` is checked against the registry first — the same check
 * `attachDocument` has — so a stray `document_link` row that never went
 * through `attachDocument` (or a caller passing a document's own id) cannot
 * surface paper against something that is not a fileable record.
 */
export async function documentsAbout(
	targetId: string,
	actor: Actor | null,
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
			sensitivity: document.sensitivity
		})
		.from(documentLink)
		.innerJoin(document, eq(document.id, documentLink.documentId))
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(
			and(
				eq(documentLink.targetId, targetId),
				visibleDocumentPredicate(actor),
				archiveScopePredicate(includeArchived)
			)
		)
		.orderBy(document.name, document.id);

	if (rows.length === 0) return [];

	// A document's tags hang on its own entity row, so the target id of a tag
	// link IS the document id.
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

/** Whether this actor may know this document exists at all. */
async function isVisible(
	documentId: string,
	actor: Actor | null,
	handle: Queryable
): Promise<boolean> {
	const [row] = await handle
		.select({ id: document.id })
		.from(document)
		.where(and(eq(document.id, documentId), visibleDocumentPredicate(actor)))
		.limit(1);
	return row !== undefined;
}

/**
 * Whether this id names a record of a kind this registry manages.
 *
 * `document_link.target_id` references `entity`, so the foreign key accepts
 * any entity at all — including another document. This is the one check that
 * says which of them are actually places to file paper, shared by every entry
 * point so a document is never treated as a target of itself.
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
 * Visibility-checked, which the transactions-only version it replaces was not:
 * a member holding a restricted document's id could otherwise attach it to a
 * record they can see and read it off the card afterwards.
 *
 * Idempotent, because the link's primary key is the pair — attaching twice is
 * the same state rather than an error someone has to think about.
 */
export async function attachDocument(
	targetId: string,
	documentId: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<AttachmentResult> {
	if (!(await isFileableTarget(targetId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_RECORD };
	}
	if (!(await isVisible(documentId, actor, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
	}

	await handle.insert(documentLink).values({ documentId, targetId }).onConflictDoNothing();
	return { ok: true };
}

/**
 * Remove the link only.
 *
 * The document stays: it belongs to the household and is filed on its own
 * shelf, not to the row it happened to hang on. Deleting it here would destroy
 * evidence to undo a mis-click. Visibility-checked for the same reason as
 * attaching — a member must not be able to unfile paper they cannot see.
 *
 * Same target-kind check as `attachDocument`, for the same reason: a missing
 * or unfileable target is a 404 here too, not silently a no-op delete.
 */
export async function detachDocument(
	targetId: string,
	documentId: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<AttachmentResult> {
	if (!(await isFileableTarget(targetId, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_RECORD };
	}
	if (!(await isVisible(documentId, actor, handle))) {
		return { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
	}
	await handle
		.delete(documentLink)
		.where(and(eq(documentLink.documentId, documentId), eq(documentLink.targetId, targetId)));
	return { ok: true };
}

/**
 * What "Attach existing" may offer, for every one of several records at once:
 * visible, current, and not already linked to THAT record.
 *
 * One query for the visible library and one for `document_link` restricted to
 * the given targets, with the not-yet-linked subtraction done in JS per
 * target — not a NOT EXISTS run once per record. A screen with N records
 * calling the single-record shape once each fetches the whole visible
 * library N times over; this fetches it once and reuses it, which is the
 * difference between a picker that renders for one record and a query that
 * scales with the size of the household's whole archive.
 *
 * `targetIds` with nothing in it is nothing to ask: no query at all, the same
 * rule `loadTargetNames` follows for an empty id list.
 *
 * Each target's kind is checked against the registry too — the same check
 * `attachDocument` has — in one batched query rather than one per target, so
 * a document offered by mistake as a target of itself gets an empty list
 * instead of the whole visible library.
 */
export async function candidateDocumentsFor(
	targetIds: readonly string[],
	actor: Actor | null,
	handle: Queryable = db
): Promise<Map<string, CandidateDocument[]>> {
	if (targetIds.length === 0) return new Map();

	const [visible, links, kinds] = await Promise.all([
		handle
			.select({
				id: document.id,
				name: document.name,
				ext: document.ext,
				shelfLabel: shelf.label
			})
			.from(document)
			.innerJoin(shelf, eq(shelf.id, document.shelfId))
			.where(and(visibleDocumentPredicate(actor), archiveScopePredicate(false)))
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

	// `visible` is already sorted by name; filtering it preserves that order
	// rather than re-sorting per target.
	return new Map(
		targetIds.map((targetId) => {
			if (!fileableTargetIds.has(targetId)) return [targetId, []] as const;
			const linked = linkedByTarget.get(targetId);
			const candidates = linked ? visible.filter((doc) => !linked.has(doc.id)) : visible;
			return [targetId, candidates] as const;
		})
	);
}

/**
 * The single-record shape most screens want — property, a tenancy, one loan
 * card at a time. A thin wrapper over `candidateDocumentsFor`, so the two
 * cannot drift into answering the question differently for one record than
 * for several.
 */
export async function candidateDocuments(
	targetId: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<CandidateDocument[]> {
	const byTarget = await candidateDocumentsFor([targetId], actor, handle);
	return byTarget.get(targetId) ?? [];
}
