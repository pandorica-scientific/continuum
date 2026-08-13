// The Home Assistant provider: official REST API for states, services and
// history, one-shot WebSocket for the area/entity registries (REST does not
// expose areas). All payload interpretation lives in ha-map.ts, pure and
// unit-tested.

import {
	dailyDeltas,
	domainOf,
	mapAttention,
	mapMetrics,
	mapRooms,
	meterCandidates,
	type HaEntityConfig,
	type HaRegistry,
	type HaState
} from './ha-map';
import {
	registerHomeProvider,
	type DayEnergy,
	type HomeProvider,
	type HomeSnapshot
} from './provider';

interface HaConfig extends HaEntityConfig {
	url: string;
	token: string;
	/** price of one kWh in minor units of the base currency, as a string */
	pricePerKwh?: string;
}

async function rest<T>(config: HaConfig, path: string): Promise<T> {
	const response = await fetch(`${config.url.replace(/\/$/, '')}${path}`, {
		headers: { authorization: `Bearer ${config.token}` },
		signal: AbortSignal.timeout(8000)
	});
	if (!response.ok) throw new Error(`Home Assistant ${path} answered ${response.status}`);
	return (await response.json()) as T;
}

async function callService(
	config: HaConfig,
	domain: string,
	service: string,
	entityId: string
): Promise<void> {
	const response = await fetch(
		`${config.url.replace(/\/$/, '')}/api/services/${domain}/${service}`,
		{
			method: 'POST',
			headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ entity_id: entityId }),
			signal: AbortSignal.timeout(8000)
		}
	);
	if (!response.ok) throw new Error(`Service ${domain}.${service} answered ${response.status}`);
}

/** One-shot WebSocket fetch of the area and entity registries. */
async function fetchRegistry(config: HaConfig): Promise<HaRegistry> {
	const empty: HaRegistry = { entityArea: new Map(), areaName: new Map() };
	try {
		const wsUrl = config.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket';
		const socket = new WebSocket(wsUrl);
		const send = (data: object) => socket.send(JSON.stringify(data));
		const result = await new Promise<HaRegistry>((resolve, reject) => {
			const registry: HaRegistry = { entityArea: new Map(), areaName: new Map() };
			const timer = setTimeout(() => reject(new Error('registry timeout')), 8000);
			let pending = 2;
			socket.onmessage = (event) => {
				const message = JSON.parse(String(event.data));
				if (message.type === 'auth_required') send({ type: 'auth', access_token: config.token });
				else if (message.type === 'auth_ok') {
					send({ id: 1, type: 'config/area_registry/list' });
					send({ id: 2, type: 'config/entity_registry/list' });
				} else if (message.type === 'auth_invalid') {
					clearTimeout(timer);
					reject(new Error('Home Assistant rejected the token'));
				} else if (message.type === 'result') {
					if (message.id === 1) {
						for (const area of message.result ?? []) {
							registry.areaName.set(area.area_id, area.name);
						}
					}
					if (message.id === 2) {
						for (const entity of message.result ?? []) {
							if (entity.area_id) registry.entityArea.set(entity.entity_id, entity.area_id);
						}
					}
					if (--pending === 0) {
						clearTimeout(timer);
						resolve(registry);
					}
				}
			};
			socket.onerror = () => {
				clearTimeout(timer);
				reject(new Error('websocket error'));
			};
		});
		socket.close();
		return result;
	} catch {
		// Areas are an enhancement; without them devices group under "Devices".
		return empty;
	}
}

function makeHomeAssistant(rawConfig: Record<string, string>): HomeProvider {
	const config = rawConfig as unknown as HaConfig;

	const monthToDate = async (): Promise<number | null> => {
		if (!config.energyEntity) return null;
		const start = new Date();
		start.setUTCDate(1);
		start.setUTCHours(0, 0, 0, 0);
		const history = await energyHistorySamples(start.toISOString());
		if (history.length < 2) return null;
		return Math.max(0, history[history.length - 1].value - history[0].value);
	};

	const energyHistorySamples = async (
		sinceIso: string
	): Promise<{ at: string; value: number }[]> => {
		const periods = await rest<HaState[][]>(
			config,
			`/api/history/period/${sinceIso}?filter_entity_id=${config.energyEntity}&minimal_response&no_attributes`
		);
		return (periods[0] ?? [])
			.map((s) => ({
				at: (s as unknown as { last_changed?: string }).last_changed ?? '',
				value: Number(s.state)
			}))
			.filter((s) => s.at && Number.isFinite(s.value));
	};

	return {
		id: 'homeassistant',
		label: 'Home Assistant',
		async probe() {
			try {
				await rest<{ message: string }>(config, '/api/');
				return { ok: true, detail: 'connected' };
			} catch (err) {
				return { ok: false, detail: err instanceof Error ? err.message : 'unreachable' };
			}
		},
		async snapshot(): Promise<HomeSnapshot> {
			const [states, registry, monthKwh] = await Promise.all([
				rest<HaState[]>(config, '/api/states'),
				fetchRegistry(config),
				monthToDate().catch(() => null)
			]);
			const price = Number(config.pricePerKwh);
			const costNote =
				monthKwh !== null && Number.isFinite(price) && price > 0
					? `≈ ${Math.round((monthKwh * price) / 100)
							.toLocaleString('en')
							.replace(/,/g, ' ')} into the budget`
					: null;
			return {
				metrics: mapMetrics(states, config, monthKwh, costNote),
				rooms: mapRooms(states, registry),
				attention: mapAttention(states),
				monthKwh
			};
		},
		async setDevice(deviceId, on) {
			const domain = domainOf(deviceId);
			if (domain === 'cover') {
				await callService(config, 'cover', on ? 'open_cover' : 'close_cover', deviceId);
			} else {
				await callService(config, domain, on ? 'turn_on' : 'turn_off', deviceId);
			}
		},
		async energyHistory(days): Promise<DayEnergy[]> {
			if (!config.energyEntity) return [];
			const since = new Date(Date.now() - (days + 1) * 86400000).toISOString();
			const samples = await energyHistorySamples(since);
			return dailyDeltas(samples, days, new Date().toISOString().slice(0, 10));
		}
	};
}

/** Entity candidates for the settings pickers. */
export async function haMeterCandidates(url: string, token: string) {
	const states = await rest<HaState[]>({ url, token } as HaConfig, '/api/states');
	return meterCandidates(states);
}

registerHomeProvider(
	'homeassistant',
	'Home Assistant',
	makeHomeAssistant,
	[
		{
			key: 'url',
			label: 'URL',
			placeholder: 'http://homeassistant.local:8123',
			required: true,
			kind: 'url'
		},
		{
			key: 'token',
			label: 'Long-lived access token',
			placeholder: 'from your HA profile → Security',
			required: true,
			secret: true
		},
		{ key: 'powerEntity', label: 'Power entity (optional)', placeholder: 'sensor.house_power' },
		{
			key: 'energyEntity',
			label: 'Energy entity (optional)',
			placeholder: 'sensor.house_energy_total'
		},
		{ key: 'waterEntity', label: 'Water entity (optional)', placeholder: 'sensor.water' },
		{
			key: 'tempEntity',
			label: 'Temperature entity (optional)',
			placeholder: 'sensor.living_temp'
		},
		{ key: 'airEntity', label: 'Air-quality entity (optional)', placeholder: 'sensor.pm25' },
		{ key: 'pricePerKwh', label: 'Price per kWh (optional)', placeholder: '6.50', kind: 'amount' }
	],
	'Entity ids are in Home Assistant under Settings → Devices & services → Entities. Leave slots empty and add them later.'
);
