/**
 * Where remembered layouts live.
 *
 * Two sources, merged: profiles that ship with Continuum, and profiles this
 * household has confirmed or imported. A shipped profile is a starting point
 * and can be superseded by a local one for the same layout — the household's
 * own confirmation always outranks ours, because they have the actual file.
 */
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { importProfile } from '$lib/server/db/schema';
import {
	fromDocument,
	toDocument,
	type ImportProfile,
	type ProfileDocument
} from './tabular/profile';

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
		id: randomUUID(),
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

/** Export for sharing. */
export const exportProfile = (profile: ImportProfile): ProfileDocument => toDocument(profile);

/** Import a shared profile, refusing anything that is not one. */
export function importProfileDocument(raw: unknown): ImportProfile {
	return fromDocument(raw, randomUUID());
}
