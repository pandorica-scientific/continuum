/**
 * Where remembered layouts live.
 *
 * Two sources, merged: profiles that ship with Continuum, and profiles this
 * household has confirmed or imported. A shipped profile is a starting point
 * and can be superseded by a local one for the same layout — the household's
 * own confirmation always outranks ours, because they have the actual file.
 *
 * ---
 *
 * STATUS: live. `loadProfiles` is read on every import, and `saveProfile`,
 * `deleteProfile` and `profileFromReading` are called by the mapping wizard
 * (`wizard.ts`) behind the `confirmMapping` action, so `import_profile` holds
 * real rows in production and a saved layout really does decide how the next
 * file from that bank is read.
 *
 * That matters, because a profile used to short-circuit every arithmetic
 * check and the only thing that made the hole unreachable was that no profile
 * could be created. `decideImport` now refuses P0 whatever the profile says,
 * and it is the reason this module is safe to have a trigger at all — anything
 * added here has to keep it that way.
 *
 * `saveDriftedProfile` and `recordProfileUse` are still uncalled. Note that
 * because nothing records a use, `lastUsedAt` is null on every row, and the
 * ordering `loadProfiles` relies on to make a household's own layout win is
 * not yet doing anything.
 */
import { uuidv7 } from 'uuidv7';
import { desc, eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { importProfile } from '$lib/server/db/schema';
import { type ImportProfile } from './tabular/profile';

type Handle = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Profiles shipped with the product.
 *
 * Empty today, deliberately. Every bank we hold a real export for already has
 * a hand-written adapter, and a profile authored from documentation we cannot
 * test against is worse than none: it would match, read plausibly, and only
 * the arithmetic would object. Contributed profiles land here once someone has
 * confirmed one against a real file.
 */
export const BUILTIN_PROFILES: ImportProfile[] = [];

const rowToProfile = (row: typeof importProfile.$inferSelect): ImportProfile => ({
	id: row.id,
	name: row.name,
	bank: row.bank ?? undefined,
	source: row.source === 'xlsx' ? 'xlsx' : 'delimited',
	encoding: row.encoding ?? undefined,
	delimiter: row.delimiter ?? undefined,
	signature: row.signature,
	headers: row.headers,
	mapping: row.mapping as unknown as ImportProfile['mapping'],
	version: row.version,
	verified: row.verified,
	origin: row.origin as ImportProfile['origin']
});

/**
 * Every profile that could match a file, local ones first.
 *
 * Order matters: `matchProfile` takes the first exact signature hit, so a
 * household's own confirmed layout wins over a shipped one describing the same
 * headers.
 */
export async function loadProfiles(handle: Handle = db): Promise<ImportProfile[]> {
	const rows = await handle.select().from(importProfile).orderBy(desc(importProfile.lastUsedAt));
	return [...rows.map(rowToProfile), ...BUILTIN_PROFILES];
}

export async function saveProfile(profile: ImportProfile, handle: Handle = db): Promise<void> {
	await handle
		.insert(importProfile)
		.values({
			id: profile.id,
			name: profile.name,
			bank: profile.bank,
			source: profile.source,
			encoding: profile.encoding,
			delimiter: profile.delimiter,
			signature: profile.signature,
			headers: profile.headers,
			mapping: profile.mapping,
			version: profile.version,
			verified: profile.verified,
			origin: profile.origin
		})
		.onConflictDoUpdate({
			target: importProfile.id,
			set: {
				name: profile.name,
				signature: profile.signature,
				headers: profile.headers,
				mapping: profile.mapping,
				version: profile.version,
				verified: profile.verified
			}
		});
}

/**
 * Store a re-confirmed layout as a NEW version rather than editing the old one.
 *
 * Files already imported were read under the previous mapping, and rewriting
 * it in place would make their stored provenance describe a mapping that never
 * touched them.
 */
export async function saveDriftedProfile(
	previous: ImportProfile,
	updated: Omit<ImportProfile, 'id' | 'version' | 'origin'>,
	handle: Handle = db
): Promise<ImportProfile> {
	const next: ImportProfile = {
		...updated,
		id: uuidv7(),
		version: previous.version + 1,
		origin: previous.origin === 'builtin' ? 'user' : previous.origin
	};
	await saveProfile(next, handle);
	return next;
}

export async function recordProfileUse(id: string, handle: Handle = db): Promise<void> {
	await handle
		.update(importProfile)
		.set({ lastUsedAt: new Date() })
		.where(eq(importProfile.id, id));
}

export async function deleteProfile(id: string, handle: Handle = db): Promise<void> {
	await handle.delete(importProfile).where(eq(importProfile.id, id));
}
