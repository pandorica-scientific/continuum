// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A property's images, and where each one is filed.
 *
 * The record is one JSON column: the plan image, a list of photos, and the
 * drawn floor plan. v0.8.1 lets a photo belong to a ROOM of that plan — the
 * gallery is reached by pressing a room, and a room says how many pictures it
 * holds — so a room may carry `photos` of its own. The list at the top level
 * stays what it was: the photos nobody has put in a room. Existing rows read
 * unchanged, as "every photo unassigned".
 *
 * Slots name a place a file goes: `plan`, `photo3` (the fourth unassigned),
 * `room2:photo0` (the first in the third room). Every mutation here is pure
 * and returns a new record; the server wraps it in the row lock.
 */
import type { PlanDrawing } from '$lib/plan';

export interface PropertyImages {
	plan?: string;
	photos: string[];
	drawing?: PlanDrawing;
}

export type Slot =
	| { kind: 'plan' }
	| { kind: 'photo'; index: number }
	| { kind: 'room'; room: number; index: number };

export type Placed =
	{ ok: true; images: PropertyImages } | { ok: false; status: 400 | 409; message: string };

export type Dropped =
	| { ok: true; images: PropertyImages; removed: string }
	| { ok: false; status: 400 | 409; message: string };

const STALE = {
	ok: false as const,
	status: 409 as const,
	message: 'That image changed. Try again.'
};
const UNKNOWN = { ok: false as const, status: 400 as const, message: 'Unknown image slot.' };

export function parseSlot(slot: string): Slot | null {
	if (slot === 'plan') return { kind: 'plan' };
	const photo = slot.match(/^photo(\d+)$/);
	if (photo) return { kind: 'photo', index: Number(photo[1]) };
	const room = slot.match(/^room(\d+):photo(\d+)$/);
	if (room) return { kind: 'room', room: Number(room[1]), index: Number(room[2]) };
	return null;
}

export function slotName(slot: Slot): string {
	if (slot.kind === 'plan') return 'plan';
	if (slot.kind === 'photo') return `photo${slot.index}`;
	return `room${slot.room}:photo${slot.index}`;
}

/** The photos in one room, by its index in the drawing. Empty for a room with none. */
export function roomPhotos(images: PropertyImages, room: number): string[] {
	return images.drawing?.rooms[room]?.photos ?? [];
}

/** Photos not filed in any room — the top-level list. */
export function unassignedPhotos(images: PropertyImages): string[] {
	return images.photos.filter(Boolean);
}

/** How many photos each room holds, in drawing order. */
export function roomCounts(images: PropertyImages): number[] {
	return (images.drawing?.rooms ?? []).map((r) => r.photos?.length ?? 0);
}

function clone(images: PropertyImages): PropertyImages {
	return {
		...images,
		photos: images.photos.filter(Boolean),
		drawing: images.drawing
			? {
					...images.drawing,
					rooms: images.drawing.rooms.map((r) => ({
						...r,
						photos: r.photos ? [...r.photos] : undefined
					}))
				}
			: undefined
	};
}

/**
 * Put a stored file in a slot.
 *
 * `expected` is what the slot held when the person pressed upload: a slot
 * that changed under them — a second tab, a replace that landed first —
 * refuses rather than overwriting. `null` expected means append: a second
 * append arriving with a stale final index is still an append, never
 * permission to overwrite the first file.
 */
export function placeImage(
	images: PropertyImages,
	slotName: string,
	storedName: string,
	expected: string | null
): Placed {
	const slot = parseSlot(slotName);
	if (!slot) return UNKNOWN;
	const next = clone(images);
	if (slot.kind === 'plan') {
		if ((next.plan ?? null) !== expected) return STALE;
		next.plan = storedName;
		return { ok: true, images: next };
	}
	const list =
		slot.kind === 'photo'
			? next.photos
			: next.drawing?.rooms[slot.room]
				? roomList(next, slot.room)
				: null;
	if (!list) return UNKNOWN;
	if (!Number.isSafeInteger(slot.index) || slot.index > list.length) return UNKNOWN;
	if (expected === null) list.push(storedName);
	else {
		if (list[slot.index] !== expected) return STALE;
		list[slot.index] = storedName;
	}
	return { ok: true, images: next };
}

/** Take a file out of a slot, reporting which stored file it was. */
export function dropImage(images: PropertyImages, slotName: string, expected: string): Dropped {
	const slot = parseSlot(slotName);
	if (!slot) return UNKNOWN;
	const next = clone(images);
	if (slot.kind === 'plan') {
		if ((next.plan ?? null) !== expected) return STALE;
		next.plan = undefined;
		return { ok: true, images: next, removed: expected };
	}
	const list =
		slot.kind === 'photo'
			? next.photos
			: next.drawing?.rooms[slot.room]
				? roomList(next, slot.room)
				: null;
	if (!list) return UNKNOWN;
	if (list[slot.index] !== expected) return STALE;
	// Splice, not a hole: the gallery renders a dense list, and leaving an
	// empty slot behind would shift every later photo's index.
	list.splice(slot.index, 1);
	return { ok: true, images: next, removed: expected };
}

/**
 * Carry each room's photos across a redrawn plan, by position.
 *
 * The editor posts geometry and names; it knows nothing of photos, and a
 * save that dropped them would lose the gallery every time a wall moved.
 * Rooms are matched by index, which is what the editor keeps stable; a room
 * that was deleted takes its photos back to the unassigned list.
 */
export function carryRoomPhotos(
	previous: PlanDrawing | undefined,
	next: PlanDrawing
): {
	drawing: PlanDrawing;
	orphaned: string[];
} {
	const before = previous?.rooms ?? [];
	const drawing: PlanDrawing = {
		...next,
		rooms: next.rooms.map((room, i) => ({
			...room,
			photos: room.photos ?? before[i]?.photos ?? undefined
		}))
	};
	const orphaned = before.slice(next.rooms.length).flatMap((r) => r.photos ?? []);
	return { drawing, orphaned };
}

function roomList(images: PropertyImages, room: number): string[] {
	const target = images.drawing!.rooms[room];
	if (!target.photos) target.photos = [];
	return target.photos;
}
