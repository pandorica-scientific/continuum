// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Subjects get a writer.
 *
 * The whole archive-scope subsystem — the predicate, the "Include archived
 * subjects" toggle, the honesty counts, the briefing and calendar demotion —
 * has existed and been tested since v0.7.0, and nothing in the application
 * ever wrote `archived_at`. This suite is that missing half: the module the
 * rail calls, and the proof that what it writes is what the predicate already
 * reads. Nothing here re-tests the predicate itself; `archive-scope` holds its
 * truth table.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { documentLink, subject } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';

import { documentsAbout } from '$lib/server/documents/targets';
import {
	addSubject,
	archiveSubject,
	listSubjects,
	renameSubject,
	setSubjectEmoji,
	SUBJECT_NAME_TAKEN,
	unarchiveSubject
} from '$lib/server/documents/subjects';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

// The Documents load reads the module-level `db` singleton, so it has to be
// pointed at this harness the way `archive-scope` and `documents-load` do it.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
/** A second subject, so "archiving one" can be told from "archiving all". */
let other: string;

const asAdmin = {
	person: { id: 'a', name: 'A', initials: 'A', role: 'admin' as const, theme: null }
};
const asMember = {
	person: { id: 'm', name: 'M', initials: 'M', role: 'member' as const, theme: null }
};

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('subjects', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`delete from document`;
	await harness.sql`delete from subject`;
	other = await addSubject('The house', '🏠', await shelfIdByKey('inventory', testDb), testDb);
});

/** One document, filed under whichever subjects it belongs to. */
async function fileUnder(
	name: string,
	subjectIds: string[],
	sensitivity: 'normal' | 'restricted' = 'normal'
): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name,
		shelfKey: 'inventory',
		type: 'other',
		sensitivity,
		addedOn: '2026-01-01'
	});
	for (const targetId of subjectIds) {
		await testDb.insert(documentLink).values({ documentId: id, targetId });
	}
	return id;
}

async function row(id: string) {
	const [found] = await testDb.select().from(subject).where(eq(subject.id, id));
	return found;
}

type Locals = typeof asAdmin;

async function loadDocuments(locals: Locals, search = '') {
	const { load } = await import('../../src/routes/(app)/documents/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL(`http://localhost/documents${search}`),
		locals
	})) as {
		rows: { id: string; name: string }[];
		subjects: {
			id: string;
			name: string;
			emoji: string;
			archived: boolean;
			count: number;
		}[];
	};
}

async function postAction(action: string, fields: Record<string, string>, locals: Locals) {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/documents?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

describe('the subjects list', () => {
	it('seeds no subject at all, because a subject now belongs to a shelf', async () => {
		// v0.7.x seeded a catch-all "Household" so a document always had something
		// to be about. A subject lives on a shelf now, and paper that names no
		// card sits on the dossier's "Not assigned yet" — drawn, not stored, so
		// there is nothing to protect from being archived.
		const before = await listSubjects(testDb);
		expect(before.filter((s) => s.name === 'Household')).toHaveLength(0);
	});

	it('counts the paper filed under each subject behind the read rule', async () => {
		// The same invariant the shelf counts carry: a member seeing a count that
		// includes a restricted document has been told it exists.
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await fileUnder('Insurance', [car]);
		await fileUnder('Service book', [car]);
		await fileUnder('Private valuation', [car], 'restricted');

		const forAdmin = await listSubjects(testDb, asAdmin.person);
		const forMember = await listSubjects(testDb, asMember.person);
		expect(forAdmin.find((s) => s.id === car)!.documentCount).toBe(3);
		expect(forMember.find((s) => s.id === car)!.documentCount).toBe(2);
	});
});

describe('archiving a subject', () => {
	it('writes archived_at and closes the active period', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await archiveSubject(car, '2026-08-29', testDb);

		const found = await row(car);
		expect(found.archivedAt).not.toBeNull();
		expect(found.activeTo).toBe('2026-08-29');
	});

	it('keeps a period that had already been closed by hand', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await testDb.update(subject).set({ activeTo: '2020-01-31' }).where(eq(subject.id, car));
		await archiveSubject(car, '2026-08-29', testDb);

		expect((await row(car)).activeTo).toBe('2020-01-31');
	});

	it('takes its paper out of every read path the predicate already guards', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		const insurance = await fileUnder('Car insurance', [car]);
		const letter = await fileUnder('Letter about the house', [other]);

		await archiveSubject(car, '2026-08-29', testDb);

		// `documentsAbout` — every record screen's card reads through this.
		expect(await documentsAbout(car, asAdmin.person, testDb)).toEqual([]);
		expect(
			(await documentsAbout(car, asAdmin.person, testDb, { includeArchived: true })).map(
				(d) => d.id
			)
		).toEqual([insurance]);

		// The Documents screen itself.
		const listed = await loadDocuments(asAdmin);
		expect(listed.rows.map((r) => r.id)).toEqual([letter]);
		const withArchived = await loadDocuments(asAdmin, '?archived=1');
		expect(withArchived.rows.map((r) => r.id).sort()).toEqual([insurance, letter].sort());
	});

	it('demotes only the paper filed under it alone', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		const shared = await fileUnder('Garage lease', [car, other]);
		await archiveSubject(car, '2026-08-29', testDb);

		const listed = await loadDocuments(asAdmin);
		expect(listed.rows.map((r) => r.id)).toEqual([shared]);
	});
});

describe('unarchiving a subject', () => {
	it('clears archived_at, leaves the period alone, and the paper comes back', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		const insurance = await fileUnder('Car insurance', [car]);
		await archiveSubject(car, '2026-08-29', testDb);

		await unarchiveSubject(car, testDb);
		const found = await row(car);
		expect(found.archivedAt).toBeNull();
		// The period is a record of when the subject was real; unarchiving says
		// the paper is current again, not that the period never ended.
		expect(found.activeTo).toBe('2026-08-29');

		expect((await documentsAbout(car, asAdmin.person, testDb)).map((d) => d.id)).toEqual([
			insurance
		]);
	});
});

describe('naming a subject', () => {
	it('refuses a second subject whose name differs only in case', async () => {
		await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await expect(addSubject('car', '🚗', await shelfIdByKey('inventory', testDb), testDb)).rejects.toThrow(SUBJECT_NAME_TAKEN);
	});

	it('refuses a rename onto a name another subject already has', async () => {
		await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		const dog = await addSubject('Dog', '🐕', await shelfIdByKey('inventory', testDb), testDb);
		await expect(renameSubject(dog, 'CAR', testDb)).rejects.toThrow(SUBJECT_NAME_TAKEN);
	});

	it('refuses a subject with no name at all', async () => {
		await expect(addSubject('   ', '🚗', await shelfIdByKey('inventory', testDb), testDb)).rejects.toThrow(/needs a name/i);
	});
});

describe('the rail’s actions', () => {
	it('adds a subject, and says so plainly when the name is taken', async () => {
		expect(await postAction('addSubject', { name: 'Dog', emoji: '🐕' }, asAdmin)).toEqual({
			ok: true
		});
		const added = (await listSubjects(testDb)).find((s) => s.name === 'Dog')!;
		expect(added.emoji).toBe('🐕');

		expect(await postAction('addSubject', { name: 'dog', emoji: '🐕' }, asAdmin)).toMatchObject({
			status: 400,
			data: { message: SUBJECT_NAME_TAKEN }
		});
	});

	it('renames, re-emojis, archives and unarchives through the rail', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await fileUnder('Car insurance', [car]);

		expect(
			await postAction('renameSubject', { id: car, name: 'Škoda', emoji: '🚙' }, asAdmin)
		).toEqual({ ok: true });
		expect((await row(car)).name).toBe('Škoda');
		expect((await row(car)).emoji).toBe('🚙');

		expect(await postAction('setSubjectEmoji', { id: car, emoji: '🏎️' }, asAdmin)).toEqual({
			ok: true
		});
		expect((await row(car)).emoji).toBe('🏎️');

		expect(await postAction('archiveSubject', { id: car }, asAdmin)).toEqual({ ok: true });
		expect((await row(car)).archivedAt).not.toBeNull();
		expect((await row(car)).activeTo).not.toBeNull();
		expect((await loadDocuments(asAdmin)).rows).toEqual([]);

		expect(await postAction('unarchiveSubject', { id: car }, asAdmin)).toEqual({ ok: true });
		expect((await row(car)).archivedAt).toBeNull();
		expect((await loadDocuments(asAdmin)).rows).toHaveLength(1);
	});
});

describe('the rail’s own data', () => {
	it('hands the screen every subject with its count, and says which are archived', async () => {
		const car = await addSubject('Car', '🚗', await shelfIdByKey('inventory', testDb), testDb);
		await fileUnder('Car insurance', [car]);
		await archiveSubject(car, '2026-08-29', testDb);

		const { subjects } = await loadDocuments(asAdmin);
		const carRow = subjects.find((s) => s.id === car)!;
		expect(carRow).toMatchObject({ name: 'Car', emoji: '🚗', archived: true, count: 1 });
	});
});
