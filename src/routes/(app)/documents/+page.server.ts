import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { document, person, property } from '$lib/server/db/schema';
import { saveUpload } from '$lib/server/files';
import { EXPIRY_VERBS, SHELVES, type ShelfKey } from '$lib/documents';
import type { Actions, PageServerLoad } from './$types';

function matchesQuery(doc: typeof document.$inferSelect, query: string): boolean {
	if (!query) return true;
	const haystack = [
		doc.name,
		doc.subject,
		doc.addedOn,
		doc.expiresOn ?? '',
		doc.expiryVerb,
		...doc.tags
	]
		.join(' ')
		.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => haystack.includes(word));
}

export const load: PageServerLoad = async ({ url }) => {
	const shelf = url.searchParams.get('shelf') ?? 'all';
	const query = url.searchParams.get('q') ?? '';
	const tag = url.searchParams.get('tag') ?? '';

	// Other screens (e.g. a property's documents card) open the add form
	// pre-addressed: ?add=1&addShelf=tenancy&subject=Flat Karlín
	const addShelf = url.searchParams.get('addShelf') ?? '';
	const prefill = {
		open: url.searchParams.get('add') === '1',
		shelf: SHELVES.some((s) => s.key === addShelf) ? addShelf : '',
		subject: url.searchParams.get('subject') ?? ''
	};

	const [docs, people, properties] = await Promise.all([
		db.select().from(document).orderBy(document.addedOn),
		db.select({ name: person.name }).from(person),
		db.select({ name: property.name }).from(property)
	]);

	const shelfCounts = new Map<string, number>();
	for (const d of docs) shelfCounts.set(d.shelf, (shelfCounts.get(d.shelf) ?? 0) + 1);

	const onShelf = docs.filter((d) => shelf === 'all' || d.shelf === shelf);
	const visible = onShelf
		.filter((d) => matchesQuery(d, query))
		.filter((d) => !tag || d.tags.includes(tag))
		.sort((a, b) => (a.addedOn < b.addedOn ? 1 : -1));

	// The sub-taxonomy is emergent: whatever tags exist on this shelf become
	// filter chips — no configured category tree to outgrow.
	const tagCounts = new Map<string, number>();
	for (const d of onShelf) for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	const tags = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 14)
		.map(([name, count]) => ({ name, count, active: name === tag }));

	// Columns derive from the subjects actually present: one per person, flat
	// or other subject, plus a final column for the unassigned.
	const subjects = [...new Set(visible.map((d) => d.subject).filter(Boolean))].sort();
	const today = new Date().toISOString().slice(0, 10);
	const columnFor = (subject: string) => ({
		label: subject || 'Everything else',
		items: visible
			.filter((d) => d.subject === subject)
			.map((d) => ({
				id: d.id,
				name: d.name,
				ext: d.ext,
				file: d.storedName,
				// expiry replaces the added date, in amber, per the design
				meta: d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : `added ${d.addedOn}`,
				amber: d.expiresOn !== null,
				expired: d.expiresOn !== null && d.expiresOn < today
			}))
	});
	const columns = [
		...subjects.map(columnFor),
		...(visible.some((d) => !d.subject) ? [columnFor('')] : [])
	].filter((c) => c.items.length > 0);

	return {
		shelf,
		query,
		tag,
		tags,
		prefill,
		shelves: [
			{ key: 'all', label: 'Everything', count: docs.length },
			...SHELVES.map((s) => ({ ...s, count: shelfCounts.get(s.key) ?? 0 }))
		],
		columns,
		total: visible.length,
		// suggestions for the add-form's subject field
		subjectSuggestions: [
			...people.map((p) => p.name),
			...properties.map((p) => p.name),
			'Household',
			'Vehicle'
		]
	};
};

export const actions: Actions = {
	addDocument: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const shelf = String(form.get('shelf') ?? '') as ShelfKey;
		if (!name) return fail(400, { message: 'The document needs a name.' });
		if (!SHELVES.some((s) => s.key === shelf)) return fail(400, { message: 'Pick a shelf.' });

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
		await db.insert(document).values({
			id: randomUUID(),
			name,
			shelf,
			subject: String(form.get('subject') ?? '').trim(),
			storedName,
			ext,
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn,
			expiryVerb: (EXPIRY_VERBS as readonly string[]).includes(verb) ? verb : 'expires',
			tags: String(form.get('tags') ?? '')
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		});
		return { ok: true };
	}
};
