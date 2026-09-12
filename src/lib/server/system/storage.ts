// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where uploaded bytes live.
 *
 * The default keeps them on the data volume, which is what a self-hosted
 * install wants and the only thing this repository ships. A project built on
 * this one swaps in object storage, or an encrypted blob store, by registering
 * a different driver — without touching files.ts, where every rule about what
 * an upload IS continues to live.
 *
 * The split is deliberate and the line is: a driver moves bytes, files.ts
 * decides. Which extensions are allowed, what a stored name may look like,
 * how a name is minted, what fingerprint a file has, and every header on a
 * served response are all policy, and none of them may vary with where the
 * bytes are kept.
 */

export interface StorageDriver {
	id: string;
	put(name: string, bytes: Uint8Array): Promise<void>;
	/** Null when there is no such object. */
	get(name: string): Promise<Uint8Array | null>;
	/** Bytes, or null when there is no such object. */
	size(name: string): Promise<number | null>;
	/** True when something was removed, false when there was nothing there. */
	remove(name: string): Promise<boolean>;
	/**
	 * A stream over the object and its length, or null.
	 *
	 * Separate from get() so a driver that can stream is not forced to buffer a
	 * 30 MB scan, and deliberately NOT a Response: the headers are policy and
	 * files.ts builds them.
	 */
	open(name: string): Promise<{ stream: ReadableStream; size: number } | null>;
}

let driver: StorageDriver | null = null;

export function setStorageDriver(next: StorageDriver): void {
	driver = next;
}

export function storageDriver(): StorageDriver {
	if (!driver) throw new Error('No storage driver registered');
	return driver;
}
