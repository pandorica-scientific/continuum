import { extname } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contact, contactLink, entity } from '$lib/server/db/schema';
import { removeUpload } from '$lib/server/system/files';
import { normaliseSearch } from '$lib/contacts/search';

type ContactRow = typeof contact.$inferSelect;

type ContactMutationResult =
	{ ok: true; id: string } | { ok: false; status: 400 | 404; message: string };

// files.ts allows .svg, correctly — a document can be an SVG. An avatar cannot.
// /files/[name] serves uploads by direct navigation as well as inside an <img>,
// and an SVG opened directly executes its own script in this origin. Narrowing
// here rather than in files.ts keeps documents working.
const AVATAR_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Whether an uploaded filename may be stored as a contact avatar. */
export function isAllowedAvatar(filename: string): boolean {
	// extname() takes the LAST extension, matching saveUpload, so "a.png.svg"
	// is judged as .svg rather than slipping through on the .png.
	return AVATAR_EXT.has(extname(filename).toLowerCase());
}

/**
 * Which stored upload, if any, this edit orphans.
 *
 * Nothing else on the volume tracks avatars, so an edit that swaps or clears the
 * photo is the only chance to delete the old file. Returning null for an
 * unchanged photo is the point: an edit that only touches a phone number carries
 * the same stored name through the form, and treating that as a replacement
 * would delete the file the row still points at.
 */
export function previousPhotoToRemove(before: string | null, after: string | null): string | null {
	if (!before) return null;
	return before === after ? null : before;
}

/**
 * The folded haystack, as one expression.
 *
 * Written once here rather than at each call site because it must stay
 * character-for-character identical to the expression the index in
 * 0036_contact_search.sql was built on. A predicate that differs by so much as a
 * coalesce cannot use the index — Postgres will not error, it will just fall
 * back to a sequential scan, which looks like nothing at all until the table is
 * large.
 */
const foldedHaystack = sql`to_tsvector('simple', public.contact_fold(coalesce(${contact.name}, '') || ' ' || coalesce(${contact.organisation}, '')))`;

/**
 * Contacts, newest search first.
 *
 * An empty term lists everyone rather than nobody: the screen opens on the full
 * address book, and typing narrows it.
 */
export async function listContacts(query = ''): Promise<ContactRow[]> {
	const term = normaliseSearch(query);
	if (!term) return db.select().from(contact).orderBy(asc(contact.name));

	// The term is folded in TypeScript and handed over already normalised, so the
	// two sides agree by construction. tests/unit/contacts.test.ts pins the SQL
	// fold against the TypeScript one so they cannot drift apart.
	return db
		.select()
		.from(contact)
		.where(sql`${foldedHaystack} @@ plainto_tsquery('simple', ${term})`)
		.orderBy(asc(contact.name));
}

export interface ContactInput {
	name: string;
	photo: string | null;
	organisation: string | null;
	jobTitle: string | null;
	phone: string | null;
	email: string | null;
	address: string | null;
	notes: string | null;
	category: string | null;
}

/** Empty and whitespace-only optional fields are stored as null, not ''. Two
 *  spellings of "nothing here" would make every query check for both. */
function blankToNull(value: string | null): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed === '' ? null : trimmed;
}

function normaliseInput(input: ContactInput): ContactInput {
	return {
		name: input.name.trim(),
		photo: input.photo,
		organisation: blankToNull(input.organisation),
		jobTitle: blankToNull(input.jobTitle),
		phone: blankToNull(input.phone),
		email: blankToNull(input.email),
		address: blankToNull(input.address),
		notes: blankToNull(input.notes),
		category: blankToNull(input.category)
	};
}

export async function createContact(
	id: string,
	input: ContactInput
): Promise<ContactMutationResult> {
	const values = normaliseInput(input);
	if (!values.name) return { ok: false, status: 400, message: 'A contact needs a name.' };

	await db.insert(contact).values({ id, ...values });
	return { ok: true, id };
}

export async function updateContact(
	id: string,
	input: ContactInput
): Promise<ContactMutationResult> {
	const values = normaliseInput(input);
	if (!values.name) return { ok: false, status: 400, message: 'A contact needs a name.' };

	const [existing] = await db.select().from(contact).where(eq(contact.id, id)).limit(1);
	if (!existing) return { ok: false, status: 404, message: 'Contact not found.' };

	await db
		.update(contact)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(contact.id, id));

	// After the row commits, never before: if the update fails, the old file is
	// still what the row points at and deleting it first would leave a contact
	// referencing nothing.
	const orphan = previousPhotoToRemove(existing.photo, values.photo);
	if (orphan) await removeUpload(orphan);

	return { ok: true, id };
}

/** What a contact is attached to. One array per link table, ids only. */
export interface ContactLinks {
	tenancyIds: string[];
	propertyIds: string[];
	loanIds: string[];
	accountIds: string[];
}

export const emptyLinks = (): ContactLinks => ({
	tenancyIds: [],
	propertyIds: [],
	loanIds: [],
	accountIds: []
});

/**
 * Replace every link for one contact, in one transaction.
 *
 * Delete-then-insert rather than a diff: the sets are a handful of ids, and
 * computing a minimal patch would be more code with more ways to leave a stale
 * row behind.
 *
 * There used to be four link tables here, one per kind, each handled by its own
 * closure so that no cast could hide a link written into the wrong column. One
 * `contact_link` removes that hazard rather than guarding against it: the target
 * is an `entity`, so there is no per-kind column to confuse, and the composite
 * foreign key on the concrete table means a target id genuinely is a record of
 * the kind it claims. What the caller still has to get right is which bucket an
 * id came from, and that is checked when the links are read back.
 */
export async function replaceContactLinks(id: string, links: ContactLinks): Promise<void> {
	const unique = (ids: string[]) => [...new Set(ids)].filter(Boolean);

	await db.transaction(async (tx) => {
		await tx.delete(contactLink).where(eq(contactLink.contactId, id));
		const targetIds = unique([
			...links.tenancyIds,
			...links.propertyIds,
			...links.loanIds,
			...links.accountIds
		]);
		if (targetIds.length > 0) {
			await tx
				.insert(contactLink)
				.values(targetIds.map((targetId) => ({ contactId: id, targetId })));
		}
	});
}

/** Every link row, grouped by contact id, for rendering the list in one pass. */
export async function loadContactLinks(): Promise<Map<string, ContactLinks>> {
	// One query where there were four. The kind comes from `entity`, which is
	// what lets a single table serve every sort of target — and it is authoritative
	// rather than inferred, because the concrete tables carry a composite foreign
	// key into (id, kind).
	const rows = await db
		.select({
			contactId: contactLink.contactId,
			targetId: contactLink.targetId,
			kind: entity.kind
		})
		.from(contactLink)
		.innerJoin(entity, eq(entity.id, contactLink.targetId));

	const byContact = new Map<string, ContactLinks>();
	const bucket = (contactId: string) => {
		let entry = byContact.get(contactId);
		if (!entry) byContact.set(contactId, (entry = emptyLinks()));
		return entry;
	};

	for (const row of rows) {
		const into = bucket(row.contactId);
		if (row.kind === 'tenancy') into.tenancyIds.push(row.targetId);
		else if (row.kind === 'property') into.propertyIds.push(row.targetId);
		else if (row.kind === 'loan') into.loanIds.push(row.targetId);
		else if (row.kind === 'account') into.accountIds.push(row.targetId);
		// Any other kind is a link this screen does not render. Ignored rather than
		// bucketed somewhere arbitrary, so a future kind cannot show up mislabelled.
	}
	return byContact;
}

export async function deleteContact(id: string): Promise<ContactMutationResult> {
	const [existing] = await db.select().from(contact).where(eq(contact.id, id)).limit(1);
	if (!existing) return { ok: false, status: 404, message: 'Contact not found.' };

	// Link rows cascade; only the upload has no foreign key to follow.
	await db.delete(contact).where(eq(contact.id, id));
	if (existing.photo) await removeUpload(existing.photo);

	return { ok: true, id };
}
