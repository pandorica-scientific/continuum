// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { archiveTiles, EMPTY_FACTS, shelfTiles } from '$lib/documents/shelf-tiles';

/**
 * Three figures per shelf, chosen by engine rather than by shelf key.
 *
 * The banner chose them through a switch with a branch per seeded shelf, so a
 * shelf somebody made fell to a default trio. Keying on the engine gives a
 * household's own Boat shelf the same three figures Vehicles gets.
 */
describe('shelf tiles', () => {
	it('queue: waiting, oldest, proposed', () => {
		const tiles = shelfTiles('queue', {
			...EMPTY_FACTS,
			waiting: 2,
			oldestDays: 6,
			proposed: 1
		});
		expect(tiles.map((t) => t.label)).toEqual(['waiting', 'oldest', 'proposed']);
		expect(tiles[0].value).toBe('2');
		expect(tiles[0].color).toBe('var(--yellow)');
		expect(tiles[1].note).toBe('days in the queue');
	});

	it('an empty queue is not an alarm', () => {
		// The only good state for the Inbox is empty, so nought waiting must not
		// be painted like a task.
		const [waiting, oldest] = shelfTiles('queue', EMPTY_FACTS);
		expect(waiting.color).toBeUndefined();
		expect(oldest.value).toBe('—');
	});

	it('dossier: cards, missing, next due', () => {
		const tiles = shelfTiles('dossier', {
			...EMPTY_FACTS,
			cards: 2,
			missing: 2,
			nextDate: '2027-01-31'
		});
		expect(tiles.map((t) => t.label)).toEqual(['cards', 'missing', 'next due']);
		expect(tiles[1].color).toBe('var(--red)');
		expect(tiles[2].value).toBe('31 Jan 2027');
	});

	it('a dossier with nothing missing says so quietly', () => {
		const [, missing, next] = shelfTiles('dossier', { ...EMPTY_FACTS, cards: 3 });
		expect(missing.value).toBe('0');
		expect(missing.color).toBeUndefined();
		expect(next.value).toBe('—');
		expect(next.note).toBe('nothing dated');
	});

	it('completeness and wallet keep the figures the banner had', () => {
		expect(
			shelfTiles('completeness', { ...EMPTY_FACTS, cards: 2, documents: 7, missing: 1 }).map(
				(t) => t.value
			)
		).toEqual(['2', '7', '1']);
		expect(
			shelfTiles('wallet', { ...EMPTY_FACTS, cards: 2, expired: 0, inReminderWindow: 1 }).map(
				(t) => t.label
			)
		).toEqual(['people', 'expired', 'inside reminder window']);
	});

	it('every engine returns exactly three, each with a label', () => {
		for (const engine of ['queue', 'wallet', 'completeness', 'dossier'] as const) {
			const tiles = shelfTiles(engine, EMPTY_FACTS);
			expect(tiles).toHaveLength(3);
			for (const tile of tiles) {
				expect(tile.label.length).toBeGreaterThan(0);
				expect(tile.value.length).toBeGreaterThan(0);
			}
		}
	});

	it('Everything counts the archive, not a shelf', () => {
		const tiles = archiveTiles({ documents: 60, shelves: 8, nextDate: null });
		expect(tiles.map((t) => [t.label, t.value])).toEqual([
			['documents', '60'],
			['shelves', '8'],
			['next expiry', '—']
		]);
	});
});
