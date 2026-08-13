// The demo provider: the design handoff's fixture household, served through
// the same HomeProvider seam as a real platform. Proves the interface and
// powers demo mode. Device toggles mutate in-memory state so the screen
// behaves like the real thing.

import { registerHomeProvider, type HomeProvider, type HomeSnapshot } from './provider';

const deviceState = new Map<string, boolean>([
	['lr_light', true],
	['lr_blinds', true],
	['lr_heat', false],
	['k_light', false],
	['k_dish', true],
	['b_light', false],
	['b_heat', true],
	['b_blinds', false],
	['e_light', true],
	['e_air', true]
]);

interface DemoDevice {
	id: string;
	emoji: string;
	name: string;
	onText: string;
	offText: string;
}

const ROOMS: { name: string; climate: string; devices: DemoDevice[] }[] = [
	{
		name: 'Living room',
		climate: '23.1 °C · 44%',
		devices: [
			{ id: 'lr_light', emoji: '💡', name: 'Ceiling lights', onText: 'Warm, 40%', offText: 'Off' },
			{ id: 'lr_blinds', emoji: '🪟', name: 'Blinds', onText: 'Open', offText: 'Closed' },
			{ id: 'lr_heat', emoji: '🔥', name: 'Radiator', onText: 'Heating to 22°', offText: 'Idle' }
		]
	},
	{
		name: 'Kitchen',
		climate: '22.6 °C · 48%',
		devices: [
			{ id: 'k_light', emoji: '💡', name: 'Worktop', onText: 'On, 80%', offText: 'Off' },
			{
				id: 'k_dish',
				emoji: '🍽️',
				name: 'Dishwasher',
				onText: 'Running · 38 min',
				offText: 'Finished'
			}
		]
	},
	{
		name: 'Bedroom',
		climate: '20.4 °C · 46%',
		devices: [
			{ id: 'b_light', emoji: '💡', name: 'Bedside', onText: 'On, 15%', offText: 'Off' },
			{ id: 'b_heat', emoji: '🔥', name: 'Radiator', onText: 'Heating to 20°', offText: 'Idle' },
			{ id: 'b_blinds', emoji: '🪟', name: 'Blinds', onText: 'Open', offText: 'Closed' }
		]
	},
	{
		name: 'Eliška’s room',
		climate: '21.8 °C · 45%',
		devices: [
			{ id: 'e_light', emoji: '💡', name: 'Lamp', onText: 'On, 30%', offText: 'Off' },
			{ id: 'e_air', emoji: '🌬️', name: 'Air purifier', onText: 'Auto · PM2.5 6', offText: 'Off' }
		]
	}
];

function makeDemo(): HomeProvider {
	return {
		id: 'demo',
		label: 'Demo home',
		async probe() {
			return { ok: true, detail: 'demo data' };
		},
		async snapshot(): Promise<HomeSnapshot> {
			return {
				metrics: [
					{ key: 'power', label: 'Power now', value: '412', unit: 'W' },
					{
						key: 'energyMonth',
						label: 'This month',
						value: '186.4',
						unit: 'kWh',
						note: '≈ 1 220 into the budget'
					},
					{ key: 'water', label: 'Water', value: '4.8', unit: 'm³', note: 'month to date' },
					{ key: 'temperature', label: 'Indoors', value: '22.6', unit: '°C' },
					{ key: 'air', label: 'Air quality', value: '6', unit: 'µg/m³', note: 'PM2.5' }
				],
				rooms: ROOMS.map((room) => ({
					name: room.name,
					climate: room.climate,
					devices: room.devices.map((d) => {
						const on = deviceState.get(d.id) ?? false;
						return {
							id: d.id,
							emoji: d.emoji,
							name: d.name,
							on,
							state: on ? d.onText : d.offText,
							controllable: true
						};
					})
				})),
				attention: [
					{ emoji: '🚪', text: 'Balcony door is open', hue: 'yellow' },
					{ emoji: '🪫', text: 'Bedroom window sensor battery at 11%', hue: 'yellow' }
				],
				monthKwh: 186.4
			};
		},
		async setDevice(deviceId, on) {
			if (deviceState.has(deviceId)) deviceState.set(deviceId, on);
		},
		async energyHistory(days) {
			// A believable fortnight: weekday base ~5.9 kWh, weekend peaks.
			const shape = [6.1, 5.8, 5.9, 6.3, 6.0, 8.9, 9.4, 6.2, 5.7, 6.0, 6.1, 6.4, 9.1, 8.6];
			const today = Date.now();
			return Array.from({ length: days }, (_, i) => ({
				day: new Date(today - (days - 1 - i) * 86400000).toISOString().slice(0, 10),
				kwh: shape[i % shape.length]
			}));
		}
	};
}

registerHomeProvider('demo', 'Demo home', makeDemo);
