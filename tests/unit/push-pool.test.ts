import { describe, expect, it } from 'vitest';
import { mapPool, PUSH_CONCURRENCY } from '$lib/server/calendar/sync/pool';

/**
 * The bounded worker pool both provider adapters push through.
 *
 * Writing strictly one at a time holds the sync lease open too long; writing them
 * all at once risks a 429 that throttles the whole account.
 */
describe('running provider writes a few at a time', () => {
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	// Load-bearing: the sync engine pairs results[i] with pushOps[i]. A result at
	// the wrong index would record one event's etag against another's link row.
	it('returns results in input order however they finish', async () => {
		const items = [30, 5, 20, 0, 10];
		const out = await mapPool(items, 3, async (ms) => {
			await new Promise((resolve) => setTimeout(resolve, ms));
			return ms;
		});
		expect(out).toEqual(items);
	});

	it('never runs more than the limit at once', async () => {
		let inFlight = 0;
		let peak = 0;
		await mapPool(
			Array.from({ length: 20 }, (_, i) => i),
			4,
			async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await settle();
				inFlight--;
				return null;
			}
		);
		expect(peak).toBe(4);
	});

	it('does still run them concurrently', async () => {
		let peak = 0;
		let inFlight = 0;
		await mapPool([1, 2, 3, 4], PUSH_CONCURRENCY, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await settle();
			inFlight--;
			return null;
		});
		expect(peak).toBeGreaterThan(1);
	});

	// A worker takes the next index when it frees up, so one slow write holds up only itself.
	it('does not let one slow item block the items behind it', async () => {
		const finished: number[] = [];
		await mapPool([50, 0, 0, 0], 2, async (ms, index) => {
			await new Promise((resolve) => setTimeout(resolve, ms));
			finished.push(index);
			return index;
		});
		expect(finished[finished.length - 1]).toBe(0);
	});

	it('applies every item exactly once', async () => {
		const seen: number[] = [];
		const out = await mapPool(
			Array.from({ length: 37 }, (_, i) => i),
			5,
			async (item) => {
				seen.push(item);
				return item * 2;
			}
		);
		expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
		expect(out).toEqual(Array.from({ length: 37 }, (_, i) => i * 2));
	});

	it('handles an empty batch without spawning a worker', async () => {
		expect(await mapPool([], 4, async () => 'never')).toEqual([]);
	});

	it('does not spawn more workers than there are items', async () => {
		let started = 0;
		await mapPool([1], 8, async (item) => {
			started++;
			return item;
		});
		expect(started).toBe(1);
	});
});
