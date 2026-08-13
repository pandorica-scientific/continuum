import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, settings } from '$lib/server/db/schema';
import { DEFAULT_MODULES, type ModuleToggles } from '$lib/modules/registry';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const rows = await db.select().from(settings).where(eq(settings.key, key));
	return rows.length > 0 ? (rows[0].value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
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
