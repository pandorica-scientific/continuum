import { asEnumValue } from '$lib/enums';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	document,
	documentAccount,
	documentPerson,
	documentProperty,
	documentSubject,
	documentTag,
	person,
	property,
	subject,
	tag
} from '$lib/server/db/schema';
import { saveUpload } from '$lib/server/files';
import { createDocument } from '$lib/server/documents/mutations';
import { deriveColumns, isUnlinked, type LinkedDoc } from '$lib/documents-links';
import { SHELVES, type ShelfKey } from '$lib/documents';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const shelf = url.searchParams.get('shelf') ?? 'all';
	const query = url.searchParams.get('q') ?? '';
	const tagFilter = url.searchParams.get('tag') ?? '';

	// Other screens open the add form pre-addressed by id, never by name:
	// ?add=1&addShelf=tenancy&propertyId=…  /  &personId=…
	const addShelf = url.searchParams.get('addShelf') ?? '';
	const prefill = {
		open: url.searchParams.get('add') === '1',
		shelf: SHELVES.some((s) => s.key === addShelf) ? addShelf : '',
		personId: url.searchParams.get('personId') ?? '',
		propertyId: url.searchParams.get('propertyId') ?? ''
	};

	const [docs, people, properties, accounts, subjects, dp, dr, da, ds, dt, tags] =
		await Promise.all([
			db.select().from(document).orderBy(document.addedOn),
			db
				.select({ id: person.id, name: person.name })
				.from(person)
				.orderBy(person.createdAt, person.id),
			db.select({ id: property.id, name: property.name }).from(property).orderBy(property.name),
			db
				.select({ id: account.id, name: account.name })
				.from(account)
				.where(eq(account.kind, 'brokerage'))
				.orderBy(account.name),
			db.select().from(subject).orderBy(subject.name),
			db.select().from(documentPerson),
			db.select().from(documentProperty),
			db.select().from(documentAccount),
			db.select().from(documentSubject),
			db.select().from(documentTag),
			db.select().from(tag).orderBy(tag.name)
		]);

	const nameOf = {
		person: new Map(people.map((x) => [x.id, x.name])),
		property: new Map(properties.map((x) => [x.id, x.name])),
		account: new Map(accounts.map((x) => [x.id, x.name])),
		subject: new Map(subjects.map((x) => [x.id, x.name])),
		tag: new Map(tags.map((x) => [x.id, x.name]))
	};

	// Everything each document belongs to, by current name.
	const linked = new Map<string, LinkedDoc>(
		docs.map((d) => [d.id, { id: d.id, people: [], properties: [], accounts: [], subjects: [] }])
	);
	for (const r of dp) linked.get(r.documentId)?.people.push(nameOf.person.get(r.personId) ?? '');
	for (const r of dr)
		linked.get(r.documentId)?.properties.push(nameOf.property.get(r.propertyId) ?? '');
	for (const r of da)
		linked.get(r.documentId)?.accounts.push(nameOf.account.get(r.accountId) ?? '');
	for (const r of ds)
		linked.get(r.documentId)?.subjects.push(nameOf.subject.get(r.subjectId) ?? '');

	const tagsByDoc = new Map<string, string[]>();
	for (const r of dt) {
		const list = tagsByDoc.get(r.documentId) ?? [];
		list.push(nameOf.tag.get(r.tagId) ?? '');
		tagsByDoc.set(r.documentId, list);
	}

	const belongings = (id: string) => {
		const l = linked.get(id)!;
		return [...l.people, ...l.properties, ...l.accounts, ...l.subjects].filter(Boolean);
	};

	const matchesQuery = (d: (typeof docs)[number]) => {
		if (!query) return true;
		const haystack = [
			d.name,
			d.addedOn,
			d.expiresOn ?? '',
			d.expiryVerb,
			...belongings(d.id),
			...(tagsByDoc.get(d.id) ?? [])
		]
			.join(' ')
			.toLowerCase();
		return query
			.toLowerCase()
			.split(/\s+/)
			.every((word) => haystack.includes(word));
	};

	const shelfCounts = new Map<string, number>();
	for (const d of docs) shelfCounts.set(d.shelf, (shelfCounts.get(d.shelf) ?? 0) + 1);

	const onShelf = docs.filter((d) => shelf === 'all' || d.shelf === shelf);
	const visible = onShelf
		.filter(matchesQuery)
		.filter((d) => !tagFilter || (tagsByDoc.get(d.id) ?? []).includes(tagFilter))
		.sort((a, b) => (a.addedOn < b.addedOn ? 1 : -1));

	// The sub-taxonomy stays emergent: whatever tags exist on this shelf become
	// filter chips — now from the shared tag table instead of a jsonb copy.
	const tagCounts = new Map<string, number>();
	for (const d of onShelf)
		for (const t of tagsByDoc.get(d.id) ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	const tagChips = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 14)
		.map(([name, count]) => ({ name, count, active: name === tagFilter }));

	const today = new Date().toISOString().slice(0, 10);
	const byId = new Map(visible.map((d) => [d.id, d]));
	const columns = deriveColumns(visible.map((d) => linked.get(d.id)!))
		.map((c) => ({
			label: c.label,
			items: c.docIds
				.map((id) => byId.get(id)!)
				.map((d) => ({
					id: d.id,
					name: d.name,
					ext: d.ext,
					file: d.storedName,
					meta: d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : `added ${d.addedOn}`,
					amber: d.expiresOn !== null,
					expired: d.expiresOn !== null && d.expiresOn < today
				}))
		}))
		.filter((c) => c.items.length > 0);

	return {
		shelf,
		query,
		tag: tagFilter,
		tags: tagChips,
		prefill,
		shelves: [
			{ key: 'all', label: 'Everything', count: docs.length },
			...SHELVES.map((s) => ({ ...s, count: shelfCounts.get(s.key) ?? 0 }))
		],
		columns,
		total: visible.length,
		// checkbox groups for the add form — records, never suggestions to retype
		people,
		properties,
		accounts,
		subjects: subjects.map((s) => ({ id: s.id, name: s.name }))
	};
};

export const actions: Actions = {
	addDocument: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const shelf = String(form.get('shelf') ?? '') as ShelfKey;
		if (!name) return fail(400, { message: 'The document needs a name.' });
		if (!SHELVES.some((s) => s.key === shelf)) return fail(400, { message: 'Pick a shelf.' });

		const picked = {
			people: form.getAll('personIds').map(String),
			properties: form.getAll('propertyIds').map(String),
			accounts: form.getAll('accountIds').map(String),
			subjects: form.getAll('subjectIds').map(String)
		};

		// "＋ new subject": creating the record and linking it is one save.
		const newSubject = String(form.get('newSubject') ?? '').trim();
		if (isUnlinked(picked) && !newSubject)
			return fail(400, {
				message: 'A document has to belong to something — tick the household if nothing else fits.'
			});

		const file = form.get('file');
		let storedName: string | null = null;
		let ext = 'PDF';
		if (file instanceof File && file.size > 0) {
			try {
				storedName = await saveUpload(file);
				ext = extname(file.name).replace('.', '').toUpperCase() || 'PDF';
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
		}

		const expiresOn = String(form.get('expiresOn') ?? '').trim() || null;
		const verb = String(form.get('expiryVerb') ?? 'expires');
		const documentId = randomUUID();
		const tagNames = String(form.get('tags') ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);

		// The file is already durably stored above; the domain mutation owns every
		// related database row, so a bad link or tag cannot leave a partial record.
		await createDocument({
			id: documentId,
			name,
			shelf,
			storedName,
			ext,
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn,
			expiryVerb: asEnumValue('document.expiry_verb', verb, 'expires'),
			personIds: picked.people,
			propertyIds: picked.properties,
			accountIds: picked.accounts,
			subjectIds: picked.subjects,
			newSubjectName: newSubject || undefined,
			tagNames
		});
		return { ok: true };
	}
};
