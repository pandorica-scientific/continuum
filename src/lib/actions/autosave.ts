// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/** Serialize normal saves while allowing the newest pending snapshot to be
 * handed to a keepalive transport during page teardown. */
export function createSerializedAutosave<T>(
	save: (snapshot: T, revision: number) => Promise<void>,
	saveForPageExit: (snapshot: T, revision: number) => void,
	initialRevision = 0
) {
	let revision = initialRevision;
	let confirmedRevision = initialRevision;
	let latest: { snapshot: T; revision: number } | null = null;
	let pending: { snapshot: T; revision: number } | null = null;
	let chain = Promise.resolve();

	function takePending() {
		const next = pending;
		pending = null;
		return next;
	}

	return {
		queue(snapshot: T) {
			revision += 1;
			latest = { snapshot, revision };
			pending = latest;
		},
		flush(): Promise<void> {
			const next = takePending();
			if (!next) return chain;
			chain = chain.then(async () => {
				try {
					await save(next.snapshot, next.revision);
					confirmedRevision = Math.max(confirmedRevision, next.revision);
				} catch {
					// Keep a failed latest save eligible for navigation/unload retry.
					if (latest?.revision === next.revision && pending === null) pending = next;
				}
			});
			return chain;
		},
		flushForPageExit() {
			if (latest && latest.revision > confirmedRevision) {
				saveForPageExit(latest.snapshot, latest.revision);
			}
		}
	};
}
