import { eq, sql } from 'drizzle-orm';
import { db, type Db, type Queryable, type Tx } from '$lib/server/db';
import { person, settings } from '$lib/server/db/schema';
import { DEFAULT_MODULES, type ModuleToggles } from '$lib/modules/registry';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const rows = await db.select().from(settings).where(eq(settings.key, key));
	return rows.length > 0 ? (rows[0].value as T) : fallback;
}

/**
 * Write one setting. `tx` lets a caller fold it into a wider transaction — the
 * setup wizard writes people and settings as one unit, because the first person
 * is what closes the wizard and a half-finished run has no way back to it.
 */
export async function setSetting(key: string, value: unknown, tx: Db | Tx = db): Promise<void> {
	await tx
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

export interface RevisionedSetting<T> {
	value: T;
	/** Global optimistic-concurrency version shared by every browser tab. */
	version: number;
	/** Writer that most recently advanced the value. */
	writerId: string | null;
	/** That writer's local high-water mark, for unload/in-flight ordering. */
	revision: number;
}

function revisionedValue<T>(stored: unknown): RevisionedSetting<T> {
	if (stored !== null && typeof stored === 'object' && 'value' in stored) {
		const candidate = stored as {
			value: T;
			version?: number;
			writerId?: string | null;
			revision?: number;
			writers?: unknown;
		};
		if (Number.isSafeInteger(candidate.version) && candidate.version! >= 0) {
			return {
				value: candidate.value,
				version: candidate.version!,
				writerId: typeof candidate.writerId === 'string' ? candidate.writerId : null,
				revision:
					Number.isSafeInteger(candidate.revision) && candidate.revision! >= 0
						? candidate.revision!
						: 0
			};
		}
		// Compatibility with the first, global-revision implementation.
		if (Number.isSafeInteger(candidate.revision) && candidate.revision! >= 0) {
			return { value: candidate.value, version: candidate.revision!, writerId: null, revision: 0 };
		}
		// Compatibility with the brief per-writer-map implementation. Its revisions
		// were not comparable across tabs, so retain the value and restart at zero.
		if (candidate.writers !== null && typeof candidate.writers === 'object') {
			return { value: candidate.value, version: 0, writerId: null, revision: 0 };
		}
	}
	return { value: stored as T, version: 0, writerId: null, revision: 0 };
}

/** Strip autosave ordering metadata before a user-facing configuration export. */
export function revisionedSettingPayload<T>(stored: unknown): T {
	return revisionedValue<T>(stored).value;
}

/**
 * Replace a revisioned setting wholesale, taking a version above whatever is
 * stored. Config import is authoritative and has no base version of its own.
 *
 * Writing the bare payload through `setSetting` instead reset the version to 0:
 * a tab still holding baseVersion 0 then passed the concurrency check and
 * silently replaced the file that had just been imported, while a tab loaded at
 * a higher version had every later save refused as newer forever. Advancing the
 * version turns both into a visible conflict the tab can recover from.
 */
export async function replaceRevisionedSetting<T>(
	key: string,
	value: T,
	tx: Db | Tx = db
): Promise<void> {
	const rows = await tx.select().from(settings).where(eq(settings.key, key));
	const current = revisionedValue<T>(rows[0]?.value ?? null);
	await setSetting(key, { value, version: current.version + 1, writerId: null, revision: 0 }, tx);
}

const WRITER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRevisionWriterId(value: string): boolean {
	return WRITER_ID.test(value);
}

/** Read a writer-versioned setting. Unwrapped legacy values are upgraded on
 * the first save without changing their meaning. */
export async function getRevisionedSetting<T>(
	key: string,
	fallback: T,
	handle: Queryable = db
): Promise<RevisionedSetting<T>> {
	const rows = await handle.select().from(settings).where(eq(settings.key, key));
	return revisionedValue<T>(rows[0]?.value ?? fallback);
}

/** Persist only a snapshot that is current in both concurrency dimensions.
 * A writer's revision orders its normal and page-exit requests. The shared
 * base version prevents a tab loaded before another tab's edit from replacing
 * that newer value just because its delayed request arrived last. */
export async function setRevisionedSetting<T>(
	key: string,
	writerId: string,
	baseVersion: number,
	revision: number,
	value: T,
	handle: Queryable = db
): Promise<boolean> {
	if (!isRevisionWriterId(writerId)) return false;
	if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) return false;
	if (!Number.isSafeInteger(revision) || revision < 1) return false;

	const operation = async (tx: Queryable) => {
		// Ensure even the first two writers have one row they can serialize on.
		await tx
			.insert(settings)
			.values({ key, value: { value, version: 0, writerId: null, revision: 0 } })
			.onConflictDoNothing();
		const rows = await tx.select().from(settings).where(eq(settings.key, key)).for('update');
		const current = revisionedValue<T>(rows[0].value);
		const sameWriter = current.writerId === writerId;
		// The normal and keepalive transports may deliver the same snapshot twice.
		// Treat an exact revision retry as idempotent success; only an older one is stale.
		if (sameWriter && current.revision === revision) return true;
		if (sameWriter ? current.revision > revision : current.version !== baseVersion) return false;

		await tx
			.update(settings)
			.set({
				value: {
					value,
					version: current.version + 1,
					writerId,
					revision
				}
			})
			.where(eq(settings.key, key));
		return true;
	};

	const transactional = handle as Db;
	return typeof transactional.transaction === 'function'
		? transactional.transaction(operation)
		: operation(handle);
}

export async function getModules(): Promise<ModuleToggles> {
	const stored = await getSetting<Partial<ModuleToggles>>('modules', {});
	return { ...DEFAULT_MODULES, ...stored };
}

export async function getBaseCurrency(): Promise<string> {
	return getSetting<string>('baseCurrency', 'CZK');
}

export async function getHouseholdName(): Promise<string> {
	return getSetting<string>('householdName', '');
}

/** The wizard has run once at least one person exists. */
export async function isSetUp(): Promise<boolean> {
	const rows = await db.select({ count: sql<number>`count(*)::int` }).from(person);
	return rows[0].count > 0;
}
