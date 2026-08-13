// The home module's front door: providers register themselves on import, and
// the configured one is built from settings. Screens import from here only.

import './homeassistant';
import './demo';

import { getSetting } from '$lib/server/settings';
import {
	homeProviderKinds,
	makeHomeProvider,
	type HomeProvider,
	type ProviderKind
} from './provider';

export * from './provider';
export { haMeterCandidates } from './homeassistant';

export interface HomeConfig {
	kind: string;
	[key: string]: string;
}

export async function getHomeConfig(): Promise<HomeConfig | null> {
	const stored = await getSetting<HomeConfig | null>('home', null);
	return stored && stored.kind ? stored : null;
}

export async function configuredHomeProvider(): Promise<HomeProvider | null> {
	const config = await getHomeConfig();
	if (!config) return null;
	const { kind, ...rest } = config;
	return makeHomeProvider(kind, rest);
}

export function availableHomeProviders(): ProviderKind[] {
	return homeProviderKinds();
}
