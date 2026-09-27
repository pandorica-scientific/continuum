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
import {
	attachDocument,
	candidateDocuments,
	fileableTargetIds,
	loadPickableTargets
} from '$lib/server/documents/targets';
import { resolveStamp, stampSvg } from '$lib/life/art';
import { replaceContactLinks } from '$lib/server/contacts';
import {
	addIdea,
	attachBookingFile,
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
	createTrip,
	tripFigures
} from '$lib/server/life/trips';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	makeContact,
	makeDocument,
	makeDocumentLink,
	makePerson,
	makeProperty,
	makeSubject
} from './fixtures';

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
	await db.execute(
		`truncate table trip, trip_idea, document, person, tag, contact, property, subject cascade`
	);
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
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		expect(file).toMatchObject({ name: 'Plan', ext: 'PDF', attachedTo: [ideaId] });

		expect((await listAttached(PLANNER, ideaId, db)).map((f) => f.id)).toEqual([file.id]);
		expect(await storedFileOf(PLANNER, file.id, db)).toMatch(/\.pdf$/);
		// Shown on the idea card.
		expect((await listIdeas(db))[0].papers).toEqual([
			{ id: file.id, name: 'Plan', ext: 'PDF', hasFile: true }
		]);
	});

	it('refuses anything that is not a PDF by its bytes', async () => {
		const ideaId = await idea();
		const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
		expect(
			(
				await refusal(
					attachFile(PLANNER, { attachTo: ideaId, name: 'x', file: new Blob([html]) }, db)
				)
			).status
		).toBe(415);
	});

	it('answers a record outside its areas as if it did not exist', async () => {
		const someone = await makePerson(db);
		const refused = await refusal(
			attachFile(PLANNER, { attachTo: someone.id, name: 'x', file: new Blob([PDF]) }, db)
		);
		expect(refused.status).toBe(404);
		expect((await refusal(listAttached(PLANNER, someone.id, db))).status).toBe(404);
	});

	it('neither shows nor deletes a document that is also filed outside its areas', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
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
				attachFile(anything, { attachTo: target, name: 'x', file: new Blob([PDF]) }, db)
			);
			expect(refused.status).toBe(404);
		}
		expect(await db.select().from(schema.documentLink)).toEqual([]);
	});

	it('lets a token given Documents reach the whole archive, whatever a file hangs off', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
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
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		const storedName = await storedFileOf(PLANNER, file.id, db);

		await removeFile(PLANNER, file.id, db);
		expect(await listAttached(PLANNER, ideaId, db)).toEqual([]);
		expect(await readdir(DIRECTORY)).not.toContain(storedName);
	});
});

describe('promoting an idea to a trip', () => {
	it('keeps its note, its plans and its tags, and takes it off the board', async () => {
		const ideaId = await idea('Lofoten', 'Northern lights in March');
		const plan = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
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

	it('keeps the idea’s stamp when the form previewed none, as the new-trip page posts', async () => {
		const ideaId = await idea('Lofoten', '');
		const [{ art: ideaArt }] = await db
			.select({ art: schema.tripIdea.art })
			.from(schema.tripIdea)
			.where(eq(schema.tripIdea.id, ideaId));
		expect(ideaArt).toBeTruthy();

		// A different name and a city: a stamp drawn afresh would differ.
		const tripId = await promoteIdea(
			ideaId,
			{
				name: 'Arctic winter',
				emoji: '',
				startsOn: '2027-03-01',
				endsOn: '2027-03-08',
				notes: '',
				destinations: [{ country: 'NO', region: null, city: 'Tromsø' }],
				members: []
			},
			db
		);
		const [{ art: tripArt }] = await db
			.select({ art: schema.trip.art })
			.from(schema.trip)
			.where(eq(schema.trip.id, tripId));
		expect(tripArt).toEqual(ideaArt);
	});

	it('makes an ordinary trip of an idea id that names nothing', async () => {
		const tripId = await promoteIdea(
			crypto.randomUUID(),
			{
				name: 'Porto',
				emoji: '',
				startsOn: '2027-03-01',
				endsOn: '2027-03-08',
				notes: '',
				destinations: [{ country: 'PT', region: null, city: null }],
				members: []
			},
			db
		);
		expect((await loadTrip(tripId, db))?.name).toBe('Porto');
	});
});

describe('drawing trips and ideas a script wrote', () => {
	it('draws no stamp, rather than failing the screen, for a name the generator refuses', async () => {
		const long = 'x'.repeat(121);
		await db.insert(schema.tripIdea).values([
			{ id: crypto.randomUUID(), name: '' },
			{ id: crypto.randomUUID(), name: long, country: 'NO' }
		]);
		const blank = crypto.randomUUID();
		await db
			.insert(schema.trip)
			.values({ id: blank, name: '   ', startsOn: '2026-06-01', endsOn: '2026-06-08' });
		const tooLong = crypto.randomUUID();
		await db
			.insert(schema.trip)
			.values({ id: tooLong, name: long, startsOn: '2026-06-01', endsOn: '2026-06-08' });

		expect((await listIdeas(db)).map((i) => i.art)).toEqual([null, null]);
		expect((await listTrips(db)).map((t) => t.stamp)).toEqual([null, null]);
		expect((await loadTrip(blank, db))?.stamp).toBeNull();
		expect((await loadTrip(tooLong, db))?.stamp).toBeNull();
	});

	it('draws a stampless trip from its city as well, as creating it would have', async () => {
		const id = crypto.randomUUID();
		await db
			.insert(schema.trip)
			.values({ id, name: 'Summer', startsOn: '2026-06-01', endsOn: '2026-06-08' });
		await db.insert(schema.tripDestination).values({
			id: crypto.randomUUID(),
			tripId: id,
			ordinal: 0,
			country: 'PT',
			city: 'Lisbon'
		});
		const withCity = stampSvg(resolveStamp({ name: 'Summer', country: 'PT', city: 'Lisbon' }));
		const withoutCity = stampSvg(resolveStamp({ name: 'Summer', country: 'PT' }));
		expect(withCity).not.toBe(withoutCity);
		expect((await loadTrip(id, db))?.stamp?.svg).toBe(withCity);
	});
});

describe('the paper a trip shows', () => {
	it('names a document with no file behind it without linking to it', async () => {
		const tripId = await aTrip();
		const record = await makeDocument(db, { name: 'Travel insurance number' });
		await makeDocumentLink(db, { documentId: record.id, targetId: tripId });
		expect((await loadTrip(tripId, db))?.papers).toEqual([
			{ id: record.id, name: 'Travel insurance number', ext: 'PDF', hasFile: false }
		]);
	});

	it('demotes paper whose only subject is archived, as every documents card does', async () => {
		const tripId = await aTrip();
		const car = await makeSubject(db, { archivedAt: new Date() });
		const archived = await makeDocument(db, { name: 'Old car rental' });
		await makeDocumentLink(db, { documentId: archived.id, targetId: tripId });
		await makeDocumentLink(db, { documentId: archived.id, targetId: car.id });
		expect((await loadTrip(tripId, db))?.papers).toEqual([]);
	});

	it('carries what the viewer needs for a booking’s confirmation', async () => {
		const tripId = await aTrip();
		const confirmation = await attachFile(
			PLANNER,
			{ attachTo: tripId, name: 'Flight', file: new Blob([PDF]) },
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
		const [booking] = (await loadTrip(tripId, db))?.bookings ?? [];
		expect(booking).toMatchObject({ documentExt: 'PDF', documentHasFile: true });
	});
});

describe('the Upcoming tile', () => {
	const on = (startsOn: string, endsOn: string) =>
		db
			.insert(schema.trip)
			.values({ id: crypto.randomUUID(), name: 'Away', startsOn, endsOn })
			.then(() => undefined);
	const day = (offset: number) =>
		new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

	it('counts no days to a start that has passed when every trip is under way', async () => {
		await on(day(-2), day(3));
		const figures = await tripFigures(db);
		expect(figures.upcoming).toBe(1);
		expect(figures.nextInDays).toBeNull();
	});

	it('counts to the next trip to start, past one under way', async () => {
		await on(day(-2), day(3));
		await on(day(10), day(12));
		expect((await tripFigures(db)).nextInDays).toBe(10);
	});
});

describe('removing with an undo', () => {
	it('hides an idea, and undo brings back the same one with its hearts and plans', async () => {
		const person = await makePerson(db);
		const ideaId = await addIdea(
			{ name: 'Lofoten', emoji: '', note: '', country: 'NO', hearts: [person.id] },
			db
		);
		const plan = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);

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
			attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) }, db)
		);
		expect(refused.status).toBe(404);
	});

	it('says there is nothing to bring back once the sweep has deleted a trip or an idea', async () => {
		const tripId = await aTrip();
		const ideaId = await idea();
		await removeTrip(tripId, db);
		expect(await removeIdea(ideaId, db)).toBe('Lofoten');
		await purgeRemovedTrips(db, later());
		expect(await restoreTrip(tripId, db)).toBe(false);
		// Not a success that changed nothing: the screen says the undo came too late.
		expect(await restoreIdea(ideaId, db)).toBe(false);
	});

	it('keeps a removed idea through its grace period, however often the sweep runs', async () => {
		const ideaId = await idea();
		await removeIdea(ideaId, db);
		expect(await purgeRemovedTrips(db)).toEqual({ trips: 0, ideas: 0, documents: 0 });
		expect(await restoreIdea(ideaId, db)).toBe(true);
		expect((await listIdeas(db)).map((i) => i.id)).toEqual([ideaId]);
	});

	it('names nothing to undo for an idea already off the board', async () => {
		const ideaId = await idea();
		await removeIdea(ideaId, db);
		expect(await removeIdea(ideaId, db)).toBeNull();
	});
});

describe('filing paper against a trip or idea waiting for the sweep', () => {
	it('is refused for a booking’s confirmation, and files nothing', async () => {
		const tripId = await aTrip();
		const bookingId = crypto.randomUUID();
		await db.insert(schema.tripBooking).values({
			id: bookingId,
			tripId,
			kind: 'flight',
			title: 'PRG → OPO',
			startsAt: new Date('2026-06-01T08:00:00Z')
		});
		await removeTrip(tripId, db);

		const filed = await attachBookingFile(
			{
				bookingId,
				tripId,
				name: 'Flight',
				storedName: 'never-written.pdf',
				contentHash: 'x',
				ext: 'PDF'
			},
			db
		);
		expect(filed).toBeNull();
		expect(await db.select().from(schema.document)).toEqual([]);
	});

	it('is not fileable, batched or one at a time, and offers nothing to attach', async () => {
		const tripId = await aTrip();
		const ideaId = await idea();
		const someone = await makePerson(db);
		await makeDocument(db);
		await removeTrip(tripId, db);
		await removeIdea(ideaId, db);

		expect(await fileableTargetIds([tripId, ideaId, someone.id, 'not-a-uuid'], db)).toEqual(
			new Set([someone.id])
		);
		expect(await candidateDocuments(tripId, db)).toEqual([]);
	});
});

/** The Documents screen's own actions, driven as the browser drives them. */
async function documentsAction(name: string, fields: [string, string][]): Promise<unknown> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const form = new FormData();
	for (const [key, value] of fields) form.append(key, value);
	const request = new Request(`http://localhost/documents?/${name}`, {
		method: 'POST',
		body: form
	});
	const action = (actions as Record<string, (event: unknown) => Promise<unknown>>)[name];
	return action({ request, locals: { person: { id: crypto.randomUUID(), role: 'admin' } } });
}

async function linksOf(documentId: string): Promise<string[]> {
	const rows = await db
		.select({ targetId: schema.documentLink.targetId })
		.from(schema.documentLink)
		.where(eq(schema.documentLink.documentId, documentId));
	return rows.map((row) => row.targetId).sort();
}

describe('the Documents screen and a trip waiting for the sweep', () => {
	it('keeps the link when the inspector saves a document filed against it', async () => {
		const tripId = await aTrip();
		const someone = await makePerson(db);
		const plan = await makeDocument(db, { name: 'Plan' });
		await makeDocumentLink(db, { documentId: plan.id, targetId: tripId });
		await makeDocumentLink(db, { documentId: plan.id, targetId: someone.id });
		await removeTrip(tripId, db);

		// The screen cannot name the hidden trip, so the form posts only the person.
		await documentsAction('updateDocument', [
			['id', plan.id],
			['name', 'Plan'],
			['type', 'other'],
			['linkIds', someone.id]
		]);
		expect(await linksOf(plan.id)).toEqual([tripId, someone.id].sort());

		// And the undo brings the trip back with its paper.
		await restoreTrip(tripId, db);
		expect((await loadTrip(tripId, db))?.papers.map((p) => p.id)).toEqual([plan.id]);
	});

	it('files nothing new against it from the inspector, and says so', async () => {
		const tripId = await aTrip();
		const receipt = await makeDocument(db, { name: 'Receipt' });
		await removeTrip(tripId, db);

		const answer = await documentsAction('updateDocument', [
			['id', receipt.id],
			['name', 'Receipt'],
			['type', 'other'],
			['linkIds', tripId]
		]);
		expect(await linksOf(receipt.id)).toEqual([]);
		expect(answer).toMatchObject({ ok: true, message: expect.stringContaining('no longer there') });
	});

	it('captures the document without filing it there, and says so', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		await removeIdea(ideaId, db);

		const answer = (await documentsAction('addDocument', [
			['name', 'Plan typed in'],
			['linkIds', ideaId],
			['linkIds', someone.id]
		])) as { ok: boolean; addedIds: string[]; message?: string };
		expect(answer.ok).toBe(true);
		expect(answer.message).toContain('no longer there');
		expect(await linksOf(answer.addedIds[0])).toEqual([someone.id]);
	});

	it('leaves it out of a bulk filing, and says so', async () => {
		const tripId = await aTrip();
		const receipt = await makeDocument(db, { name: 'Receipt' });
		await removeTrip(tripId, db);

		const answer = await documentsAction('bulkUpdate', [
			['ids', receipt.id],
			['linkIds', tripId]
		]);
		expect(await linksOf(receipt.id)).toEqual([]);
		expect(answer).toMatchObject({ ok: true, message: expect.stringContaining('no longer there') });
	});
});

describe('saving a contact linked to a trip', () => {
	it('keeps links of kinds the contact form does not edit', async () => {
		const tripId = await aTrip();
		const anotherTrip = await aTrip('Lisbon');
		const flat = await makeProperty(db);
		const otherFlat = await makeProperty(db, { name: 'Other flat' });
		const guide = await makeContact(db, { name: 'Mountain guide' });
		await db.insert(schema.contactLink).values([
			{ contactId: guide.id, targetId: tripId },
			{ contactId: guide.id, targetId: flat.id }
		]);

		// The form posts what it shows: property, and nothing about the trip. An
		// id posted under the wrong kind is not written back.
		await replaceContactLinks(guide.id, {
			tenancyIds: [],
			propertyIds: [otherFlat.id],
			loanIds: [anotherTrip],
			accountIds: []
		});
		const links = await db
			.select({ targetId: schema.contactLink.targetId })
			.from(schema.contactLink)
			.where(eq(schema.contactLink.contactId, guide.id));
		expect(links.map((l) => l.targetId).sort()).toEqual([tripId, otherFlat.id].sort());
	});
});

describe('the sweep after the undo has had its minute', () => {
	it('deletes an idea with the paper filed against it alone, and keeps shared paper', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const own = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
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
			{ attachTo: tripId, name: 'Flight', file: new Blob([PDF]) },
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

	it('never deletes a payslip, even one filed against the trip alone — it only unlinks it', async () => {
		const tripId = await aTrip();
		const ideaId = await idea();
		const someone = await makePerson(db);
		// One carrying a salary month, and one carrying nothing: both are Salary's.
		const paid = await makeDocument(db, { name: 'March payslip', type: 'payslip' });
		const bare = await makeDocument(db, { name: 'April payslip', type: 'payslip' });
		await makeDocumentLink(db, { documentId: paid.id, targetId: tripId });
		await makeDocumentLink(db, { documentId: bare.id, targetId: ideaId });
		const entryId = crypto.randomUUID();
		await db.insert(schema.salaryEntry).values({
			id: entryId,
			personId: someone.id,
			periodMonth: '2026-03',
			currency: 'CZK',
			source: 'payslip',
			grossMinor: 5_000_000n,
			documentId: paid.id
		});

		await removeTrip(tripId, db);
		await removeIdea(ideaId, db);
		expect(await purgeRemovedTrips(db, later())).toEqual({ trips: 1, ideas: 1, documents: 0 });

		const left = await db.select({ id: schema.document.id }).from(schema.document);
		expect(left.map((d) => d.id).sort()).toEqual([paid.id, bare.id].sort());
		expect(await linksOf(paid.id)).toEqual([]);
		expect(await linksOf(bare.id)).toEqual([]);
		const [entry] = await db
			.select()
			.from(schema.salaryEntry)
			.where(eq(schema.salaryEntry.id, entryId));
		expect(entry.documentId).toBe(paid.id);
	});

	it('keeps paper another record cites as its evidence, such as another trip’s booking', async () => {
		const removed = await aTrip('Porto');
		const kept = await aTrip('Lisbon');
		const ticket = await makeDocument(db, { name: 'Rail pass' });
		await makeDocumentLink(db, { documentId: ticket.id, targetId: removed });
		await db.insert(schema.tripBooking).values({
			id: crypto.randomUUID(),
			tripId: kept,
			kind: 'train',
			title: 'Porto → Lisbon',
			startsAt: new Date('2026-06-04T08:00:00Z'),
			documentId: ticket.id
		});

		await removeTrip(removed, db);
		expect(await purgeRemovedTrips(db, later())).toEqual({ trips: 1, ideas: 0, documents: 0 });
		const [booking] = (await loadTrip(kept, db))?.bookings ?? [];
		expect(booking.documentId).toBe(ticket.id);
	});

	it('keeps a document filed elsewhere while the sweep was deciding about it', async () => {
		const ideaId = await idea();
		const someone = await makePerson(db);
		const plan = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		await removeIdea(ideaId, db);

		// A filing against somebody, in a transaction still open when the sweep
		// starts: it holds a key-share lock on the document until it commits.
		let inserted!: () => void;
		let release!: () => void;
		const linkWritten = new Promise<void>((resolve) => (inserted = resolve));
		const mayCommit = new Promise<void>((resolve) => (release = resolve));
		const filing = db.transaction(async (tx) => {
			await tx.insert(schema.documentLink).values({ documentId: plan.id, targetId: someone.id });
			inserted();
			await mayCommit;
		});
		await linkWritten;

		const sweeping = purgeRemovedTrips(db, later());
		// Long enough for the sweep to reach the document and wait on it.
		await new Promise((resolve) => setTimeout(resolve, 300));
		release();
		await filing;

		expect(await sweeping).toEqual({ trips: 0, ideas: 1, documents: 0 });
		expect(await linksOf(plan.id)).toEqual([someone.id]);
	});
});
