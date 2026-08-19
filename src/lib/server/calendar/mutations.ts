import { uuidv7 } from 'uuidv7';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { calendarEvent, calendarEventException } from '$lib/server/db/schema';
import { planScopeChange, type EditScope } from '$lib/calendar/scope';

type EventMutationResult =
	{ ok: true; id: string } | { ok: false; status: 400 | 404; message: string };

interface EventInput {
	title: string;
	notes: string | null;
	category: string | null;
	allDay: boolean;
	startsAt: Date;
	endsAt: Date;
	tz: string;
	rrule: string | null;
}

function invalid(message: string): EventMutationResult {
	return { ok: false, status: 400, message };
}

/** Shared validation, so create and update cannot disagree about what is legal. */
function check(input: EventInput): string | null {
	if (!input.title.trim()) return 'An event needs a title.';
	if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
		return 'That is not a valid date and time.';
	}
	if (input.endsAt.getTime() < input.startsAt.getTime())
		return 'An event cannot end before it starts.';
	if (!input.tz) return 'An event needs a timezone.';
	return null;
}

export async function createEvent(
	input: EventInput,
	createdBy: string | null,
	handle: Db = db
): Promise<EventMutationResult> {
	const problem = check(input);
	if (problem) return invalid(problem);

	const id = uuidv7();
	await handle.insert(calendarEvent).values({
		id,
		title: input.title.trim(),
		notes: input.notes?.trim() || null,
		category: input.category || null,
		allDay: input.allDay,
		startsAt: input.startsAt,
		endsAt: input.endsAt,
		tz: input.tz,
		rrule: input.rrule || null,
		createdBy
	});
	return { ok: true, id };
}

/**
 * Apply an edit at the chosen scope.
 *
 * `recurrenceId` is the ORIGINAL start of the occurrence that was touched, and
 * is required for anything but a whole-series edit.
 */
export async function updateEvent(
	id: string,
	input: EventInput,
	scope: EditScope,
	recurrenceId: string | null,
	handle: Db = db
): Promise<EventMutationResult> {
	const problem = check(input);
	if (problem) return invalid(problem);

	return handle.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(calendarEvent)
			.where(and(eq(calendarEvent.id, id), isNull(calendarEvent.deletedAt)))
			.limit(1);
		if (!row) return { ok: false, status: 404, message: 'Event not found.' } as const;

		const plan = planScopeChange(
			scope,
			row.rrule,
			recurrenceId ?? row.startsAt.toISOString(),
			row.startsAt.toISOString(),
			row.tz
		);

		if (plan.kind === 'exception') {
			// Only what this occurrence actually says DIFFERENTLY from the series.
			//
			// Null means inherit, so storing the submitted value unconditionally
			// would freeze the occurrence at today's category and zone: retag the
			// series later and every overridden occurrence would keep the old tag.
			// Storing the difference keeps a "this event only" edit narrow — which
			// is what the person asked for — and lets everything they did not touch
			// go on following the series.
			//
			// These three used to be dropped outright: the form submitted them, the
			// insert had nowhere to put them, and the occurrence was re-rendered
			// from the series values, so the screen contradicted the save.
			const override = {
				cancelled: false,
				title: input.title.trim(),
				startsAt: input.startsAt,
				endsAt: input.endsAt,
				notes: input.notes?.trim() || null,
				category: (input.category || null) === row.category ? null : input.category || null,
				allDay: input.allDay === row.allDay ? null : input.allDay,
				tz: input.tz === row.tz ? null : input.tz
			};

			// onConflictDoUpdate rather than insert: moving the same occurrence twice
			// must edit the existing override, not fail on the (event_id,
			// recurrence_id) unique index.
			await tx
				.insert(calendarEventException)
				.values({
					id: uuidv7(),
					eventId: id,
					recurrenceId: plan.recurrenceId,
					...override
				})
				.onConflictDoUpdate({
					target: [calendarEventException.eventId, calendarEventException.recurrenceId],
					set: override
				});
			await touch(tx, id);
			return { ok: true, id } as const;
		}

		if (plan.kind === 'split') {
			// Truncate the original, then start a second series at the split.
			await tx
				.update(calendarEvent)
				.set({ rrule: plan.truncatedRrule, updatedAt: new Date() })
				.where(eq(calendarEvent.id, id));

			const newId = uuidv7();
			await tx.insert(calendarEvent).values({
				id: newId,
				title: input.title.trim(),
				notes: input.notes?.trim() || null,
				category: input.category || null,
				allDay: input.allDay,
				startsAt: input.startsAt,
				endsAt: input.endsAt,
				tz: input.tz,
				// The tail's own rule, which is the original MINUS what the first half
				// already used up. Copying row.rrule restarted a COUNT from zero, so a
				// ten-occurrence series split in the middle produced twelve. An edited
				// recurrence still wins — that was being discarded outright, so
				// changing the rule in a "this and following" edit did nothing at all.
				rrule: input.rrule && input.rrule !== row.rrule ? input.rrule : plan.newSeriesRrule,
				createdBy: row.createdBy
			});

			// Exceptions at or after the split MOVE to the new series; the ones before
			// it stay where they are. Deleting them all took the earlier ones with it,
			// so a cancelled occurrence reappeared and a renamed one reverted to the
			// series title — silently, in the half of the series nobody was editing.
			// Compared as instants, not as text. recurrence_id is a text column and
			// the same moment arrives spelled more than one way ('…:00Z' from a
			// server, '…:00.000Z' from us), so a SQL string comparison would sort
			// some of them to the wrong side of the split.
			const splitAt = new Date(plan.newSeriesStart).getTime();
			const existing = await tx
				.select({
					id: calendarEventException.id,
					recurrenceId: calendarEventException.recurrenceId
				})
				.from(calendarEventException)
				.where(eq(calendarEventException.eventId, id));
			const moving = existing
				.filter((e) => new Date(e.recurrenceId).getTime() >= splitAt)
				.map((e) => e.id);
			if (moving.length > 0) {
				await tx
					.update(calendarEventException)
					.set({ eventId: newId })
					.where(inArray(calendarEventException.id, moving));
			}
			return { ok: true, id: newId } as const;
		}

		await tx
			.update(calendarEvent)
			.set({
				title: input.title.trim(),
				notes: input.notes?.trim() || null,
				category: input.category || null,
				allDay: input.allDay,
				startsAt: input.startsAt,
				endsAt: input.endsAt,
				tz: input.tz,
				rrule: input.rrule || null,
				updatedAt: new Date()
			})
			.where(eq(calendarEvent.id, id));
		return { ok: true, id } as const;
	});
}

/** Bump the merge clock so sync notices a change to an event's exceptions. */
async function touch(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) {
	await tx.update(calendarEvent).set({ updatedAt: new Date() }).where(eq(calendarEvent.id, id));
}

export async function deleteEvent(
	id: string,
	scope: EditScope,
	recurrenceId: string | null,
	handle: Db = db
): Promise<EventMutationResult> {
	return handle.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(calendarEvent)
			.where(and(eq(calendarEvent.id, id), isNull(calendarEvent.deletedAt)))
			.limit(1);
		if (!row) return { ok: false, status: 404, message: 'Event not found.' } as const;

		const plan = planScopeChange(
			scope,
			row.rrule,
			recurrenceId ?? row.startsAt.toISOString(),
			row.startsAt.toISOString(),
			row.tz
		);

		if (plan.kind === 'exception') {
			// A cancelled occurrence, not a removed row: the remote has to be told
			// this instance is gone, and RFC 5545 says that with a cancelled
			// RECURRENCE-ID rather than by the occurrence simply not appearing.
			await tx
				.insert(calendarEventException)
				.values({ id: uuidv7(), eventId: id, recurrenceId: plan.recurrenceId, cancelled: true })
				.onConflictDoUpdate({
					target: [calendarEventException.eventId, calendarEventException.recurrenceId],
					set: { cancelled: true }
				});
			await touch(tx, id);
			return { ok: true, id } as const;
		}

		if (plan.kind === 'split') {
			// "Delete this and following" ends the series at the split rather than
			// removing it: everything before the split genuinely happened.
			await tx
				.update(calendarEvent)
				.set({ rrule: plan.truncatedRrule, updatedAt: new Date() })
				.where(eq(calendarEvent.id, id));

			// And the overrides on the far side of the split go with it. Truncating
			// the rule alone left them behind, and occurrencesFor sweeps overrides
			// whose new time lands in the window even when the rule no longer
			// produces them — so a moved occurrence the household had just deleted
			// came straight back on the next render, and was pushed to the provider
			// as a RECURRENCE-ID naming an occurrence that no longer exists.
			//
			// Compared as instants for the same reason the update path does: the
			// column is text and the same moment arrives spelled more than one way.
			const splitAt = new Date(plan.newSeriesStart).getTime();
			const existing = await tx
				.select({
					id: calendarEventException.id,
					recurrenceId: calendarEventException.recurrenceId
				})
				.from(calendarEventException)
				.where(eq(calendarEventException.eventId, id));
			const dropped = existing
				.filter((e) => new Date(e.recurrenceId).getTime() >= splitAt)
				.map((e) => e.id);
			if (dropped.length > 0) {
				await tx.delete(calendarEventException).where(inArray(calendarEventException.id, dropped));
			}
			return { ok: true, id } as const;
		}

		// Whole series: a tombstone, never a removed row. Sync has to be able to
		// tell "deleted here, push the deletion" from "never existed", and a row
		// that is simply gone says nothing at all — the engine would treat the
		// remote copy as a new event and pull it straight back.
		//
		// Tombstones are kept unconditionally rather than only when a sync link
		// exists, so the answer does not depend on whether an account happened to
		// be connected at the moment of deletion. Reaping them once every account
		// has confirmed the deletion belongs to the sync engine (Task 16), not
		// here.
		await tx
			.update(calendarEvent)
			.set({ deletedAt: new Date(), updatedAt: new Date() })
			.where(eq(calendarEvent.id, id));
		return { ok: true, id } as const;
	});
}
