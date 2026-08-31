// SPDX-License-Identifier: AGPL-3.0-or-later
// Running a batch of provider writes a few at a time.
//
// Both adapters used to push strictly one at a time. Correct, but a household
// that connects a calendar for the first time pushes its whole history in one
// pass, and each write is a full round trip to Apple or Google — so the pass ran
// for as many seconds as it had events, holding the account's sync lease open
// the whole time and delaying every other account behind it.
//
// The other extreme is worse. Firing every write at once is how a first sync
// earns a 429, and iCloud in particular answers a burst by throttling the whole
// account rather than the one request. A small fixed width is the point between
// the two: it is not a household preference and there is nothing to derive it
// from, so it is a constant here rather than a setting nobody would know how to
// answer.

/** How many provider writes may be in flight at once. */
export const PUSH_CONCURRENCY = 4;

/**
 * Apply `work` to every item, at most `limit` at a time, results IN INPUT ORDER.
 *
 * The order is not a nicety. The sync engine pairs `results[i]` with the op it
 * sent as `pushOps[i]`, so a result that arrives out of order would record one
 * event's etag and hash against another's link row — which is a corrupted merge
 * base, not a slow sync.
 *
 * `work` is expected to resolve rather than reject; both adapters catch per
 * operation and return a failure result. A rejection propagates and abandons the
 * batch, exactly as a throw from the serial loop this replaced would have.
 */
export async function mapPool<T, R>(
	items: T[],
	limit: number,
	work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	// Each worker takes the next index and keeps going, rather than the batch
	// being split up front: one slow write then holds up only itself, not the
	// quarter of the queue it was dealt.
	const worker = async (): Promise<void> => {
		for (let index = next++; index < items.length; index = next++) {
			results[index] = await work(items[index], index);
		}
	};

	const width = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: width }, worker));
	return results;
}
