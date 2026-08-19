// Pure mapping from Home Assistant API payloads to the HomeProvider shapes.
// No fetch, no WebSocket — unit tests feed canned payloads.

import type { AttentionItem, HomeDevice, HomeMetric, HomeRoom } from './provider';

export interface HaState {
	entity_id: string;
	state: string;
	attributes: {
		friendly_name?: string;
		device_class?: string;
		unit_of_measurement?: string;
		brightness?: number;
		current_temperature?: number;
		temperature?: number;
		current_position?: number;
		[key: string]: unknown;
	};
}

export interface HaRegistry {
	/** entity_id → area_id */
	entityArea: Map<string, string>;
	/** area_id → name */
	areaName: Map<string, string>;
}

export interface HaEntityConfig {
	powerEntity?: string;
	energyEntity?: string;
	waterEntity?: string;
	tempEntity?: string;
	airEntity?: string;
}

const DOMAIN_EMOJI: Record<string, string> = {
	light: '💡',
	switch: '🔌',
	cover: '🪟',
	fan: '🌬️',
	climate: '🔥',
	media_player: '📺',
	vacuum: '🧹',
	humidifier: '💧'
};

const CONTROLLABLE_DOMAINS = new Set([
	'light',
	'switch',
	'cover',
	'fan',
	'media_player',
	'vacuum',
	'humidifier'
]);

export function domainOf(entityId: string): string {
	return entityId.split('.')[0];
}

function deviceState(state: HaState): { on: boolean; text: string } {
	const domain = domainOf(state.entity_id);
	if (domain === 'cover') {
		const open = state.state === 'open' || state.state === 'opening';
		const position = state.attributes.current_position;
		return { on: open, text: open ? (position != null ? `Open ${position}%` : 'Open') : 'Closed' };
	}
	if (domain === 'climate') {
		const heating = state.state !== 'off';
		const target = state.attributes.temperature;
		return {
			on: heating,
			text: heating && target != null ? `Heating to ${target}°` : heating ? state.state : 'Idle'
		};
	}
	if (domain === 'light') {
		const on = state.state === 'on';
		const brightness = state.attributes.brightness;
		return {
			on,
			text: on
				? brightness != null
					? `On, ${Math.round((brightness / 255) * 100)}%`
					: 'On'
				: 'Off'
		};
	}
	const on = !['off', 'unavailable', 'unknown', 'closed', 'idle', 'standby', 'docked'].includes(
		state.state
	);
	return { on, text: on ? state.state.replace(/_/g, ' ') : 'Off' };
}

/** Group device-like entities into rooms via the area registry. */
export function mapRooms(states: HaState[], registry: HaRegistry): HomeRoom[] {
	const deviceStates = states.filter((s) => DOMAIN_EMOJI[domainOf(s.entity_id)]);
	const byArea = new Map<string, HaState[]>();
	for (const state of deviceStates) {
		const area = registry.entityArea.get(state.entity_id) ?? '';
		if (!byArea.has(area)) byArea.set(area, []);
		byArea.get(area)!.push(state);
	}

	const climateFor = (areaId: string): string | null => {
		const temps = states.filter(
			(s) =>
				registry.entityArea.get(s.entity_id) === areaId &&
				domainOf(s.entity_id) === 'sensor' &&
				s.attributes.device_class === 'temperature' &&
				Number.isFinite(Number(s.state))
		);
		const humidity = states.find(
			(s) =>
				registry.entityArea.get(s.entity_id) === areaId &&
				s.attributes.device_class === 'humidity' &&
				Number.isFinite(Number(s.state))
		);
		if (temps.length === 0) return null;
		const t = `${Number(temps[0].state).toFixed(1)} °C`;
		return humidity ? `${t} · ${Math.round(Number(humidity.state))}%` : t;
	};

	return [...byArea.entries()]
		.map(([areaId, entities]) => ({
			name: registry.areaName.get(areaId) ?? (areaId ? areaId : 'Devices'),
			climate: areaId ? climateFor(areaId) : null,
			devices: entities
				.map((s): HomeDevice => {
					const domain = domainOf(s.entity_id);
					const { on, text } = deviceState(s);
					return {
						id: s.entity_id,
						emoji: DOMAIN_EMOJI[domain] ?? '🔘',
						name: s.attributes.friendly_name ?? s.entity_id,
						on,
						state: text,
						controllable: CONTROLLABLE_DOMAINS.has(domain)
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name))
		}))
		.filter((room) => room.devices.length > 0)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The five headline tiles, from the configured meter entities. */
export function mapMetrics(
	states: HaState[],
	config: HaEntityConfig,
	monthKwh: number | null,
	costNote: string | null
): HomeMetric[] {
	const byId = new Map(states.map((s) => [s.entity_id, s]));
	const metric = (
		key: string,
		label: string,
		entityId: string | undefined,
		fallbackUnit: string,
		note?: string
	): HomeMetric | null => {
		if (!entityId) return null;
		const state = byId.get(entityId);
		if (!state || !Number.isFinite(Number(state.state))) {
			return { key, label, value: '—', note: 'entity unavailable' };
		}
		return {
			key,
			label,
			value: Number(state.state).toLocaleString('en', { maximumFractionDigits: 1 }),
			unit: state.attributes.unit_of_measurement ?? fallbackUnit,
			note
		};
	};

	const metrics = [
		metric('power', 'Power now', config.powerEntity, 'W'),
		monthKwh !== null
			? {
					key: 'energyMonth',
					label: 'This month',
					value: monthKwh.toLocaleString('en', { maximumFractionDigits: 1 }),
					unit: 'kWh',
					note: costNote ?? undefined
				}
			: null,
		metric('water', 'Water', config.waterEntity, 'm³', 'month to date'),
		metric('temperature', 'Indoors', config.tempEntity, '°C'),
		metric('air', 'Air quality', config.airEntity, 'µg/m³', 'PM2.5')
	];
	return metrics.filter((m): m is HomeMetric => m !== null);
}

/** Open doors/windows and low batteries — only what needs attention. */
export function mapAttention(states: HaState[]): AttentionItem[] {
	const items: AttentionItem[] = [];
	for (const s of states) {
		if (domainOf(s.entity_id) !== 'binary_sensor') continue;
		const cls = s.attributes.device_class;
		if (
			(cls === 'door' || cls === 'window' || cls === 'opening' || cls === 'garage_door') &&
			s.state === 'on'
		) {
			items.push({
				emoji: '🚪',
				text: `${s.attributes.friendly_name ?? s.entity_id} is open`,
				hue: 'yellow'
			});
		}
		if (cls === 'battery' && s.state === 'on') {
			items.push({
				emoji: '🪫',
				text: `${s.attributes.friendly_name ?? s.entity_id} battery is low`,
				hue: 'yellow'
			});
		}
	}
	for (const s of states) {
		if (
			domainOf(s.entity_id) === 'sensor' &&
			s.attributes.device_class === 'battery' &&
			Number.isFinite(Number(s.state)) &&
			Number(s.state) <= 15
		) {
			items.push({
				emoji: '🪫',
				text: `${(s.attributes.friendly_name ?? s.entity_id).replace(/ [Bb]attery.*$/, '')} battery at ${Math.round(Number(s.state))}%`,
				hue: Number(s.state) <= 5 ? 'red' : 'yellow'
			});
		}
	}
	return items;
}

/** Sensor entities suitable for each meter slot, for the settings pickers. */
export function meterCandidates(states: HaState[]): Record<string, { id: string; name: string }[]> {
	const pick = (predicate: (s: HaState) => boolean) =>
		states
			.filter((s) => domainOf(s.entity_id) === 'sensor' && predicate(s))
			.map((s) => ({ id: s.entity_id, name: s.attributes.friendly_name ?? s.entity_id }))
			.sort((a, b) => a.name.localeCompare(b.name));
	return {
		power: pick((s) => s.attributes.device_class === 'power'),
		// Energy sensors keep their unit in the label: the same device class
		// covers Wh, kWh and MWh entities, and picking the wrong one is a
		// thousandfold error in the bill rather than a cosmetic one.
		energy: states
			.filter((s) => domainOf(s.entity_id) === 'sensor' && s.attributes.device_class === 'energy')
			.map((s) => {
				const unit = s.attributes.unit_of_measurement;
				const name = s.attributes.friendly_name ?? s.entity_id;
				return {
					id: s.entity_id,
					name: unit ? `${name} (${unit})` : name
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name)),
		water: pick((s) => s.attributes.device_class === 'water'),
		temperature: pick((s) => s.attributes.device_class === 'temperature'),
		air: pick((s) => ['pm25', 'aqi', 'carbon_dioxide'].includes(s.attributes.device_class ?? ''))
	};
}

/**
 * Multiplier turning a reading in the sensor's own unit into kWh, or null when
 * the unit is not an energy unit we can convert.
 *
 * The unit lives in the entity's attributes, never in its state, and Home
 * Assistant energy sensors report whatever their integration reports — Shelly,
 * Tasmota and ESPHome commonly report Wh. Assuming kWh made a 186 kWh month
 * read as 186 000, and that figure is not merely displayed: it is multiplied by
 * the price per kWh and written onto the household's bill as money.
 *
 * Null rather than a guess of 1: an energy figure a thousand times wrong is
 * worse than no energy figure.
 */
export function energyToKwh(unit: string | null | undefined): number | null {
	switch ((unit ?? '').trim().toLowerCase()) {
		case 'wh':
			return 0.001;
		case 'kwh':
			return 1;
		case 'mwh':
			return 1000;
		case 'gwh':
			return 1_000_000;
		case 'j':
			return 1 / 3_600_000;
		case 'kj':
			return 1 / 3600;
		case 'mj':
			return 1 / 3.6;
		case 'gj':
			return 1000 / 3.6;
		default:
			return null;
	}
}

/**
 * Total consumption across a run of readings from a total-increasing counter,
 * in the counter's own unit.
 *
 * Sums the rises rather than subtracting the ends, because the counter does
 * reset — a Home Assistant restart, a meter swap, an integration reload. Taking
 * `last - first` then clamping at zero reported such a month as 0, which is
 * indistinguishable on screen from a month of no consumption at all.
 */
export function risingTotal(readings: readonly number[]): number {
	let total = 0;
	for (let i = 1; i < readings.length; i++) {
		const delta = readings[i] - readings[i - 1];
		// A decrease is a counter reset, not negative consumption: the counter
		// restarted from zero and climbed to its current reading, so that reading
		// is the part of the period we can still account for. Whatever it counted
		// between the previous sample and the reset is unrecoverable — but
		// discarding the whole step reported a reset month as zero, which reads
		// exactly like a month of no consumption at all.
		total += delta > 0 ? delta : readings[i];
	}
	return total;
}

/**
 * Daily kWh from history samples of a total-increasing energy sensor.
 *
 * Each day's figure is `risingTotal` over that day's own samples plus the
 * previous day's last reading, so the two views of the same data agree about
 * what a counter reset means. Comparing only the day's last reading against the
 * previous day's dropped the reset day from the series entirely — not zero, not
 * a gap, simply absent, which reads on screen as a day nobody was home, while
 * the month tile beside it counted the consumption.
 */
export function dailyDeltas(
	samples: { at: string; value: number }[],
	days: number,
	today: string
): { day: string; kwh: number }[] {
	// Every sample of a day, in order, so a reset inside the day is visible.
	const perDay = new Map<string, number[]>();
	for (const sample of samples) {
		if (!Number.isFinite(sample.value)) continue;
		const day = sample.at.slice(0, 10);
		const list = perDay.get(day) ?? [];
		list.push(sample.value);
		perDay.set(day, list);
	}

	const out: { day: string; kwh: number }[] = [];
	let carry: number | null = null;
	for (let i = days; i >= 0; i--) {
		const day = new Date(new Date(today).getTime() - i * 86400000).toISOString().slice(0, 10);
		const values = perDay.get(day);
		if (!values || values.length === 0) continue;
		// The previous day's last reading opens this day's run, so consumption
		// between midnights is counted exactly once.
		const run = carry === null ? values : [carry, ...values];
		if (carry !== null) out.push({ day, kwh: risingTotal(run) });
		carry = values[values.length - 1];
	}
	return out.slice(-days);
}
