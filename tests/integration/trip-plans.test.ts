// SPDX-License-Identifier: AGPL-3.0-or-later
// A travel planner with a token limited to trips files ideas and their PDF
// plans. What has to hold: it reaches trips and nothing else, promotion keeps
// everything the idea held, undo brings back the same idea, and the sweep takes
// an idea's own paper with it and nobody else's.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { attachFile, listAttached, removeFile, storedFileOf } from '$lib/server/api/files';
import { ApiError } from '$lib/server/api/errors';
import { attachDocument, loadPickableTargets } from '$lib/server/documents/targets';
import {
	addIdea,
	listIdeas,
	listTrips,
	loadTrip,
	promoteIdea,
	purgeRemovedTrips,
	REMOVAL_GRACE_MS,
	removeIdea,
	removeTrip,
	restoreIdea,
	restoreTrip,
	createTrip
} from '$lib/server/life/trips';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;
let previousDirectory: string | undefined;
const DIRECTORY = resolve('scratch-workspace/trip-plans-uploads');

const PLANNER = { access: 'read-write', areas: ['trips'] } as const;
const EVERYTHING = { access: 'read', areas: null } as const;
const ARCHIVIST = { access: 'read-write', areas: ['documents'] } as const;
const PDF = new TextEncoder().encode('%PDF-1.7\n% a plan\n%%EOF\n');

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('trip-plans');
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	db = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	await rm(DIRECTORY, { recursive: true, force: true });
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await db.execute(`truncate table trip, trip_idea, document, person, tag cascade`);
});

async function refusal(work: Promise<unknown>): Promise<ApiError> {
	const error = await work.then(
		() => null,
		(e: unknown) => e
	);
	if (!(error instanceof ApiError)) throw new Error(`expected a refusal, got ${error}`);
	return error;
}

const idea = (name = 'Lofoten', note = 'Northern lights in March') =>
	addIdea({ name, emoji: '', note, country: 'NO', hearts: [] }, db);

const aTrip = (name = 'Porto') =>
	createTrip(
		{
			name,
			emoji: '',
			startsOn: '2026-06-01',
			endsOn: '2026-06-08',
			notes: '',
			destinations: [{ country: 'PT', region: null, city: null }],
			members: []
		},
		db
	);

/** Past the grace period, as the sweep sees it. */
const later = () => new Date(Date.now() + REMOVAL_GRACE_MS + 60_000);

describe('a PDF plan over /api/v1/files', () => {
	it('attaches to an idea the token reaches, and lists and serves it back', async () => {
		const ideaId = await idea();
		const file = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		expect(file).toMatchObject({ name: 'Plan', ext: 'PDF', attachedTo: [ideaId] });

		expect((await listAttached(PLANNER, ideaId, db)).map((f) => f.id)).toEqual([file.id]);
		expect(await storedFileOf(PLANNER, file.id, db)).toMatch(/\.pdf$/);
		// Shown on the idea card.
		expect((await listIdeas(db))[0].papers).toEqual([{ id: file.id, name: 'Plan', ext: 'PDF' }]);
	});

	it('refuses anything that is not a PDF by its bytes', async () => {
		const ideaId = await idea();
		const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
		expect(
			(await refusal(attachFile(PLANNER, { attachTo: ideaId, name: 'x', bytes: html }, db))).status
		).toBe(415);
	});

	it('answers a record outside its areas as if it did not exist', async () => {
		const someone = await makePerson(db);
		const refused = await refusal(
			attachFile(PLANNER, { attachTo: someone.id, name: 'x', bytes: PDF }, db)
		);
		expect(refused.status).toBe(404);
		expect((await refusal(listAttached(PLANNER, someone.id, db))).status).toBe(404);
	});

	it('neither shows nor deletes a document that is also filed outside its areas', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const file = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		await makeDocumentLink(db, { documentId: file.id, targetId: someone.id });

		expect(await listAttached(PLANNER, ideaId, db)).toEqual([]);
		expect((await refusal(storedFileOf(PLANNER, file.id, db))).status).toBe(404);
		expect((await refusal(removeFile(PLANNER, file.id, db))).status).toBe(404);
		// An unlimited token still sees it.
		expect(await storedFileOf(EVERYTHING, file.id, db)).toMatch(/\.pdf$/);
	});

	it('refuses a record the archive never files paper against, even to an unlimited token', async () => {
		const other = await makeDocument(db);
		const [tag] = await db
			.insert(schema.tag)
			.values({ id: crypto.randomUUID(), name: 'Winter', normalisedName: 'winter' })
			.returning();
		const anything = { access: 'read-write', areas: null } as const;
		for (const target of [other.id, tag.id]) {
			const refused = await refusal(
				attachFile(anything, { attachTo: target, name: 'x', bytes: PDF }, db)
			);
			expect(refused.status).toBe(404);
		}
		expect(await db.select().from(schema.documentLink)).toEqual([]);
	});

	it('lets a token given Documents reach the whole archive, whatever a file hangs off', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const file = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		await makeDocumentLink(db, { documentId: file.id, targetId: someone.id });

		expect(await storedFileOf(ARCHIVIST, file.id, db)).toMatch(/\.pdf$/);
		await removeFile(ARCHIVIST, file.id, db);
		expect(await db.select().from(schema.document)).toEqual([]);
	});

	it('keeps a payslip from a token without Salary, even one given Documents', async () => {
		const ideaId = await idea();
		const payslip = await makeDocument(db, { name: 'March payslip', type: 'payslip' });
		await makeDocumentLink(db, { documentId: payslip.id, targetId: ideaId });
		const plannerAndArchive = { access: 'read-write', areas: ['trips', 'documents'] } as const;

		expect(await listAttached(plannerAndArchive, ideaId, db)).toEqual([]);
		expect((await refusal(removeFile(ARCHIVIST, payslip.id, db))).status).toBe(404);
		expect((await refusal(removeFile(PLANNER, payslip.id, db))).status).toBe(404);

		const withSalary = { access: 'read-write', areas: ['documents', 'salary'] } as const;
		await removeFile(withSalary, payslip.id, db);
		expect(await db.select().from(schema.document)).toEqual([]);
	});

	it('removes a plan and its file, so a planner can replace one', async () => {
		const ideaId = await idea();
		const file = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		const storedName = await storedFileOf(PLANNER, file.id, db);

		await removeFile(PLANNER, file.id, db);
		expect(await listAttached(PLANNER, ideaId, db)).toEqual([]);
		expect(await readdir(DIRECTORY)).not.toContain(storedName);
	});
});

describe('promoting an idea to a trip', () => {
	it('keeps its note, its plans and its tags, and takes it off the board', async () => {
		const ideaId = await idea('Lofoten', 'Northern lights in March');
		const plan = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		const [tag] = await db
			.insert(schema.tag)
			.values({ id: crypto.randomUUID(), name: 'Winter', normalisedName: 'winter' })
			.returning();
		await db.insert(schema.tagLink).values({ tagId: tag.id, targetId: ideaId });

		const tripId = await promoteIdea(
			ideaId,
			{
				name: 'Lofoten',
				emoji: '',
				startsOn: '2027-03-01',
				endsOn: '2027-03-08',
				notes: '',
				destinations: [{ country: 'NO', region: null, city: null }],
				members: []
			},
			db
		);

		const trip = await loadTrip(tripId, db);
		expect(trip?.notes).toBe('Northern lights in March');
		expect(trip?.papers.map((p) => p.id)).toEqual([plan.id]);
		const tags = await db.select().from(schema.tagLink).where(eq(schema.tagLink.targetId, tripId));
		expect(tags.map((t) => t.tagId)).toEqual([tag.id]);
		expect(await listIdeas(db)).toEqual([]);
		// The plan is the trip's now, and still in the archive.
		expect(await storedFileOf(PLANNER, plan.id, db)).toMatch(/\.pdf$/);
	});

	it('keeps notes the form gave rather than the idea’s', async () => {
		const ideaId = await idea('Lofoten', 'From the idea');
		const tripId = await promoteIdea(
			ideaId,
			{
				name: 'Lofoten',
				emoji: '',
				startsOn: '2027-03-01',
				endsOn: '2027-03-08',
				notes: 'Typed on the form',
				destinations: [{ country: 'NO', region: null, city: null }],
				members: []
			},
			db
		);
		expect((await loadTrip(tripId, db))?.notes).toBe('Typed on the form');
	});
});

describe('removing with an undo', () => {
	it('hides an idea, and undo brings back the same one with its hearts and plans', async () => {
		const person = await makePerson(db);
		const ideaId = await addIdea(
			{ name: 'Lofoten', emoji: '', note: '', country: 'NO', hearts: [person.id] },
			db
		);
		const plan = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);

		await removeIdea(ideaId, db);
		expect(await listIdeas(db)).toEqual([]);

		await restoreIdea(ideaId, db);
		const [back] = await listIdeas(db);
		expect(back.id).toBe(ideaId);
		expect(back.hearts.map((h) => h.id)).toEqual([person.id]);
		expect(back.papers.map((p) => p.id)).toEqual([plan.id]);
	});

	it('hides a trip from the list and its page, and undo brings it back', async () => {
		const tripId = await aTrip();
		await removeTrip(tripId, db);
		expect(await listTrips(db)).toEqual([]);
		expect(await loadTrip(tripId, db)).toBeNull();

		await restoreTrip(tripId, db);
		expect((await listTrips(db)).map((t) => t.id)).toEqual([tripId]);
	});

	it('offers a removed idea to nobody filing paper, so the sweep cannot take a new upload', async () => {
		const ideaId = await idea();
		const receipt = await makeDocument(db);
		await removeIdea(ideaId, db);

		expect((await loadPickableTargets(db)).map((t) => t.id)).not.toContain(ideaId);
		expect((await attachDocument(ideaId, receipt.id, db)).ok).toBe(false);
		const refused = await refusal(
			attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db)
		);
		expect(refused.status).toBe(404);
	});

	it('says there is nothing to bring back once the sweep has deleted a trip', async () => {
		const tripId = await aTrip();
		await removeTrip(tripId, db);
		await purgeRemovedTrips(db, later());
		expect(await restoreTrip(tripId, db)).toBe(false);
	});

	it('keeps a removed idea through its grace period, however often the sweep runs', async () => {
		const ideaId = await idea();
		await removeIdea(ideaId, db);
		expect(await purgeRemovedTrips(db)).toEqual({ trips: 0, ideas: 0, documents: 0 });
		await restoreIdea(ideaId, db);
		expect((await listIdeas(db)).map((i) => i.id)).toEqual([ideaId]);
	});
});

describe('the sweep after the undo has had its minute', () => {
	it('deletes an idea with the paper filed against it alone, and keeps shared paper', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const own = await attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', bytes: PDF }, db);
		const ownFile = await storedFileOf(PLANNER, own.id, db);
		const shared = await makeDocument(db, { name: 'Passport scan' });
		await makeDocumentLink(db, { documentId: shared.id, targetId: ideaId });
		await makeDocumentLink(db, { documentId: shared.id, targetId: someone.id });

		await removeIdea(ideaId, db);
		expect(await purgeRemovedTrips(db, later())).toEqual({ trips: 0, ideas: 1, documents: 1 });

		const ideas = await db.select().from(schema.tripIdea);
		expect(ideas).toEqual([]);
		const documents = await db.select({ id: schema.document.id }).from(schema.document);
		expect(documents.map((d) => d.id)).toEqual([shared.id]);
		expect(await readdir(DIRECTORY)).not.toContain(ownFile);
		const links = await db
			.select()
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, shared.id));
		expect(links.map((l) => l.targetId)).toEqual([someone.id]);
	});

	it('deletes a removed trip with its bookings and confirmations', async () => {
		const tripId = await aTrip();
		const confirmation = await attachFile(
			PLANNER,
			{ attachTo: tripId, name: 'Flight', bytes: PDF },
			db
		);
		await db.insert(schema.tripBooking).values({
			id: crypto.randomUUID(),
			tripId,
			kind: 'flight',
			title: 'PRG → OPO',
			startsAt: new Date('2026-06-01T08:00:00Z'),
			documentId: confirmation.id
		});

		await removeTrip(tripId, db);
		expect(await purgeRemovedTrips(db, later())).toEqual({ trips: 1, ideas: 0, documents: 1 });
		expect(await db.select().from(schema.trip)).toEqual([]);
		expect(await db.select().from(schema.tripBooking)).toEqual([]);
		expect(await db.select().from(schema.document)).toEqual([]);
	});
});
