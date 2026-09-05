// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	carryRoomPhotos,
	dropImage,
	parseSlot,
	placeImage,
	roomCounts,
	roomPhotos,
	unassignedPhotos,
	type PropertyImages
} from '$lib/property/media';

const base = (): PropertyImages => ({
	plan: 'p.png',
	photos: ['a.jpg', 'b.jpg'],
	drawing: {
		cellCm: 50,
		rooms: [
			{ name: 'Hall', cells: [[0, 0]] },
			{ name: 'Bath', cells: [[1, 0]], photos: ['c.jpg'] }
		]
	}
});

describe('image slots', () => {
	it('names every place a file can go', () => {
		expect(parseSlot('plan')).toEqual({ kind: 'plan' });
		expect(parseSlot('photo3')).toEqual({ kind: 'photo', index: 3 });
		expect(parseSlot('room1:photo0')).toEqual({ kind: 'room', room: 1, index: 0 });
		expect(parseSlot('attic')).toBeNull();
	});

	it('reads a record written before rooms held photos as all unassigned', () => {
		const images: PropertyImages = { photos: ['a.jpg'] };
		expect(unassignedPhotos(images)).toEqual(['a.jpg']);
		expect(roomCounts(images)).toEqual([]);
		expect(roomPhotos(images, 0)).toEqual([]);
	});

	it('counts per room, in drawing order', () => {
		expect(roomCounts(base())).toEqual([0, 1]);
	});
});

describe('placing an image', () => {
	it('appends to a room that has none yet', () => {
		const out = placeImage(base(), 'room0:photo0', 'd.jpg', null);
		expect(out.ok && roomPhotos(out.images, 0)).toEqual(['d.jpg']);
	});

	it('replaces only what the person was looking at', () => {
		const stale = placeImage(base(), 'room1:photo0', 'x.jpg', 'gone.jpg');
		expect(stale.ok).toBe(false);
		const fresh = placeImage(base(), 'room1:photo0', 'x.jpg', 'c.jpg');
		expect(fresh.ok && roomPhotos(fresh.images, 1)).toEqual(['x.jpg']);
	});

	it('refuses a room the plan does not have', () => {
		const out = placeImage(base(), 'room7:photo0', 'x.jpg', null);
		expect(out.ok).toBe(false);
		expect(!out.ok && out.status).toBe(400);
	});

	it('does not touch the record it was given', () => {
		const images = base();
		placeImage(images, 'photo2', 'z.jpg', null);
		expect(images.photos).toEqual(['a.jpg', 'b.jpg']);
	});
});

describe('dropping an image', () => {
	it('splices rather than leaving a hole', () => {
		const out = dropImage(base(), 'photo0', 'a.jpg');
		expect(out.ok && out.images.photos).toEqual(['b.jpg']);
		expect(out.ok && out.removed).toBe('a.jpg');
	});

	it('refuses when the slot changed', () => {
		expect(dropImage(base(), 'photo0', 'b.jpg').ok).toBe(false);
	});
});

describe('redrawing the plan', () => {
	it('carries photos across by room position and orphans a deleted room', () => {
		const { drawing, orphaned } = carryRoomPhotos(base().drawing, {
			cellCm: 50,
			rooms: [{ name: 'Hall', cells: [[0, 0]] }]
		});
		expect(drawing.rooms[0].photos).toBeUndefined();
		expect(orphaned).toEqual(['c.jpg']);
	});
});
