import { describe, expect, it } from 'vitest';
import {
	dailyDeltas,
	energyToKwh,
	mapAttention,
	mapMetrics,
	mapRooms,
	meterCandidates,
	risingTotal,
	type HaRegistry,
	type HaState
} from '$lib/server/home/ha-map';

const STATES: HaState[] = [
	{
		entity_id: 'light.living_ceiling',
		state: 'on',
		attributes: { friendly_name: 'Ceiling lights', brightness: 102 }
	},
	{
		entity_id: 'cover.living_blinds',
		state: 'open',
		attributes: { friendly_name: 'Blinds', current_position: 80 }
	},
	{ entity_id: 'climate.living_radiator', state: 'off', attributes: { friendly_name: 'Radiator' } },
	{ entity_id: 'light.kitchen_worktop', state: 'off', attributes: { friendly_name: 'Worktop' } },
	{
		entity_id: 'sensor.living_temp',
		state: '23.1',
		attributes: {
			friendly_name: 'Living temp',
			device_class: 'temperature',
			unit_of_measurement: '°C'
		}
	},
	{ entity_id: 'sensor.living_humidity', state: '44.2', attributes: { device_class: 'humidity' } },
	{
		entity_id: 'sensor.house_power',
		state: '412',
		attributes: { friendly_name: 'House power', device_class: 'power', unit_of_measurement: 'W' }
	},
	{
		entity_id: 'sensor.house_energy',
		state: '5231.8',
		attributes: {
			friendly_name: 'House energy',
			device_class: 'energy',
			unit_of_measurement: 'kWh'
		}
	},
	{
		entity_id: 'binary_sensor.balcony_door',
		state: 'on',
		attributes: { friendly_name: 'Balcony door', device_class: 'door' }
	},
	{
		entity_id: 'binary_sensor.front_door',
		state: 'off',
		attributes: { friendly_name: 'Front door', device_class: 'door' }
	},
	{
		entity_id: 'sensor.window_battery',
		state: '11',
		attributes: { friendly_name: 'Window sensor battery', device_class: 'battery' }
	}
];

const REGISTRY: HaRegistry = {
	entityArea: new Map([
		['light.living_ceiling', 'living'],
		['cover.living_blinds', 'living'],
		['climate.living_radiator', 'living'],
		['sensor.living_temp', 'living'],
		['sensor.living_humidity', 'living'],
		['light.kitchen_worktop', 'kitchen']
	]),
	areaName: new Map([
		['living', 'Living room'],
		['kitchen', 'Kitchen']
	])
};

describe('mapRooms', () => {
	const rooms = mapRooms(STATES, REGISTRY);

	it('groups devices by area with climate readings', () => {
		const living = rooms.find((r) => r.name === 'Living room')!;
		expect(living.devices).toHaveLength(3);
		expect(living.climate).toBe('23.1 °C · 44%');
	});

	it('renders device states like the design: brightness, position, idle', () => {
		const living = rooms.find((r) => r.name === 'Living room')!;
		expect(living.devices.find((d) => d.id === 'light.living_ceiling')?.state).toBe('On, 40%');
		expect(living.devices.find((d) => d.id === 'cover.living_blinds')?.state).toBe('Open 80%');
		expect(living.devices.find((d) => d.id === 'climate.living_radiator')?.state).toBe('Idle');
	});

	it('devices without an area fall back to a generic group', () => {
		const registry: HaRegistry = { entityArea: new Map(), areaName: new Map() };
		const rooms = mapRooms(STATES, registry);
		expect(rooms).toHaveLength(1);
		expect(rooms[0].name).toBe('Devices');
	});
});

describe('mapMetrics', () => {
	it('builds tiles from the configured entities only', () => {
		const metrics = mapMetrics(
			STATES,
			{ powerEntity: 'sensor.house_power', tempEntity: 'sensor.living_temp' },
			186.4,
			'≈ 1 220 into the budget'
		);
		expect(metrics.map((m) => m.key)).toEqual(['power', 'energyMonth', 'temperature']);
		expect(metrics[0].value).toBe('412');
		expect(metrics[1].note).toContain('budget');
	});

	it('marks a vanished entity as unavailable instead of dropping the tile', () => {
		const metrics = mapMetrics(STATES, { powerEntity: 'sensor.gone' }, null, null);
		expect(metrics[0].value).toBe('—');
		expect(metrics[0].note).toBe('entity unavailable');
	});
});

describe('mapAttention', () => {
	it('surfaces only open doors and low batteries', () => {
		const attention = mapAttention(STATES);
		expect(attention).toHaveLength(2);
		expect(attention[0].text).toContain('Balcony door');
		expect(attention[1].text).toContain('battery at 11%');
	});
});

describe('meterCandidates', () => {
	it('offers sensors by device class for the settings pickers', () => {
		const candidates = meterCandidates(STATES);
		expect(candidates.power).toEqual([{ id: 'sensor.house_power', name: 'House power' }]);
		// Energy candidates carry their unit: device_class 'energy' covers Wh,
		// kWh and MWh entities alike, and picking the wrong one is a
		// thousandfold error in the household's bill.
		expect(candidates.energy).toEqual([{ id: 'sensor.house_energy', name: 'House energy (kWh)' }]);
	});
});

describe('energyToKwh', () => {
	it('converts the units Home Assistant integrations actually report', () => {
		expect(energyToKwh('kWh')).toBe(1);
		expect(energyToKwh('Wh')).toBe(0.001);
		expect(energyToKwh('MWh')).toBe(1000);
		expect(energyToKwh('wh')).toBe(0.001); // case-insensitive
		expect(energyToKwh(' kWh ')).toBe(1);
		expect(energyToKwh('GJ')).toBeCloseTo(277.7778, 3);
	});

	it('refuses to guess for an unknown or missing unit', () => {
		// A Shelly or Tasmota entity reporting Wh, read as kWh, turned a 186 kWh
		// month into 186 000 — and that figure is multiplied by the price and
		// written onto the household's bill as money. No reading beats one that
		// is a thousand times wrong.
		expect(energyToKwh(undefined)).toBeNull();
		expect(energyToKwh(null)).toBeNull();
		expect(energyToKwh('')).toBeNull();
		expect(energyToKwh('m³')).toBeNull();
		expect(energyToKwh('°C')).toBeNull();
	});
});

describe('risingTotal', () => {
	it('sums consumption across a counter reset instead of reporting zero', () => {
		// last − first would be 40 − 500 = −460, which Math.max(0, …) flattened
		// to 0 — indistinguishable from a month of no consumption at all.
		const samples = [{ value: 400 }, { value: 500 }, { value: 0 }, { value: 40 }];
		expect(risingTotal(samples)).toBe(140);
	});

	it('is a plain difference when the counter never resets', () => {
		expect(risingTotal([{ value: 100 }, { value: 130 }, { value: 186 }])).toBe(86);
	});

	it('is zero for fewer than two samples', () => {
		expect(risingTotal([])).toBe(0);
		expect(risingTotal([{ value: 5 }])).toBe(0);
	});
});

describe('dailyDeltas', () => {
	it('turns a total-increasing meter into per-day consumption', () => {
		const samples = [
			{ at: '2026-08-10T21:00:00Z', value: 100 },
			{ at: '2026-08-11T09:00:00Z', value: 103 },
			{ at: '2026-08-11T21:00:00Z', value: 106.2 },
			{ at: '2026-08-12T21:00:00Z', value: 112.1 }
		];
		const deltas = dailyDeltas(samples, 3, '2026-08-13');
		expect(deltas).toEqual([
			{ day: '2026-08-11', kwh: expect.closeTo(6.2, 5) },
			{ day: '2026-08-12', kwh: expect.closeTo(5.9, 5) }
		]);
	});

	it('ignores meter resets instead of reporting negative days', () => {
		const samples = [
			{ at: '2026-08-11T21:00:00Z', value: 500 },
			{ at: '2026-08-12T21:00:00Z', value: 3 }
		];
		expect(dailyDeltas(samples, 3, '2026-08-13')).toEqual([]);
	});
});
