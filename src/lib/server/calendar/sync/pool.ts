// SPDX-License-Identifier: AGPL-3.0-or-later
// Running a batch of provider writes a few at a time: strictly serial holds an
// account's sync lease open for as long as its history is long, but firing every
// write at once is how a first sync earns a 429 (iCloud throttles the whole
// account on a burst). A small fixed width is the point between the two.

/** How many provider writes may be in flight at once. */
export const PUSH_CONCURRENCY = 4;

/**
 * Apply `work` to every item, at most `limit` at a time, results IN INPUT ORDER.
 *
 * The order is not a nicety: the sync engine pairs `results[i]` with the op it
 * sent as `pushOps[i]`, so an out-of-order result would record one event's etag
 * against another's link row — a corrupted merge base, not a slow sync.
 *
 * `work` is expected to resolve rather than reject; a rejection propagates and
 * abandons the batch.
 */
export async function mapPool<T, R>(
	items: T[],
	limit: number,
	work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	// Each worker takes the next index and keeps going, rather than the batch
	// being split up front, so one slow write holds up only itself.
	const worker = async (): Promise<void> => {
		for (let index = next++; index < items.length; index = next++) {
			results[index] = await work(items[index], index);
		}
	};

	const width = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: width }, worker));
	return results;
}
