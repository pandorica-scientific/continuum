import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { property, propertyBill } from '$lib/server/db/schema';
import {
	availableHomeProviders,
	configuredHomeProvider,
	configuredMeterProperty,
	getHomeConfig,
	haMeterCandidates,
	syncMeterBill
} from '$lib/server/home';
import { generateEvents } from '$lib/server/calendar';
import { getBaseCurrency, setSetting } from '$lib/server/settings';
import { parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [config, providers, properties] = await Promise.all([
		getHomeConfig(),
		Promise.resolve(availableHomeProviders()),
		db.select().from(property)
	]);
	const livedInOptions = properties
		.filter((candidate) => candidate.kind === 'lived')
		.map((candidate) => ({ id: candidate.id, name: candidate.name }));
	const livedIn = configuredMeterProperty(config, properties);

	if (!config) {
		return {
			configured: false as const,
			providers,
			livedInOptions,
			livedInName: livedIn?.name ?? null
		};
	}

	const provider = await configuredHomeProvider();
	if (!provider) {
		return {
			configured: false as const,
			providers,
			livedInOptions,
			livedInName: livedIn?.name ?? null
		};
	}

	const probe = await provider.probe();
	if (!probe.ok) {
		return {
			configured: true as const,
			unreachable: probe.detail,
			providerLabel: provider.label,
			providers,
			livedInName: livedIn?.name ?? null
		};
	}

	const [snapshot, energyDays, week] = await Promise.all([
		provider.snapshot(),
		provider.energyHistory(14),
		generateEvents(
			new Date().toISOString().slice(0, 10),
			new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
		)
	]);

	// Read-only: the meter bill is written by syncMeterBill on the hourly tick
	// and when a platform is connected, never here. A GET load that writes is a
	// load that runs on hover, because app.html sets preload-data="hover".
	let billNote: string | null = null;
	const price = Number(config.pricePerKwh);
	if (livedIn && snapshot.monthKwh !== null && Number.isFinite(price) && price > 0) {
		const meterBills = await db
			.select({ id: propertyBill.id })
			.from(propertyBill)
			.where(and(eq(propertyBill.propertyId, livedIn.id), eq(propertyBill.source, 'meter')));
		if (meterBills.length > 0) {
			const baseCurrency = await getBaseCurrency();
			billNote = `These readings replace the estimated energy line on ${livedIn.name}'s bills, so the budget follows what the meter actually did. (${baseCurrency})`;
		}
	}

	const maxKwh = Math.max(...energyDays.map((d) => d.kwh), 1);
	const threshold = maxKwh * 0.75;

	return {
		configured: true as const,
		providerLabel: provider.label,
		providers,
		livedInName: livedIn?.name ?? null,
		snapshot,
		energyDays: energyDays.map((d) => ({
			...d,
			pct: Math.round((d.kwh / maxKwh) * 100),
			high: d.kwh >= threshold
		})),
		billNote,
		week: week.slice(0, 6).map((e) => ({ date: e.date.slice(5), label: e.label }))
	};
};

export const actions: Actions = {
	configure: async ({ request }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const provider = availableHomeProviders().find((p) => p.id === kind);
		if (!provider) return fail(400, { message: 'Pick a platform.' });
		const meterPropertyId = String(form.get('meterPropertyId') ?? '');
		const meterProperties = await db
			.select({ id: property.id })
			.from(property)
			.where(and(eq(property.id, meterPropertyId), eq(property.kind, 'lived')));
		if (!meterProperties[0]) {
			return fail(400, { message: 'Pick the lived-in property whose meter this is.' });
		}

		// Generic: the provider's own field description drives validation, so
		// a new platform never adds code here.
		const config: Record<string, string> = { kind, meterPropertyId };
		for (const field of provider.fields) {
			let value = String(form.get(field.key) ?? '').trim();
			if (!value) {
				if (field.required) return fail(400, { message: `${field.label} is required.` });
				continue;
			}
			if (field.kind === 'url') {
				value = value.replace(/\/$/, '');
				if (!/^https?:\/\//.test(value)) {
					return fail(400, { message: `${field.label} must start with http(s)://.` });
				}
			} else if (field.kind === 'amount') {
				const typedIn = await getBaseCurrency();
				try {
					value = String(parseAmountToMinor(value, typedIn));
				} catch {
					return fail(400, { message: `${field.label} must be a number.` });
				}
				// Minor units are meaningless without the currency they were typed
				// in, and the base currency can change afterwards — so record it
				// beside the amount rather than assuming today's base still applies.
				config[`${field.key}Currency`] = typedIn;
			}
			config[field.key] = value;
		}
		await setSetting('home', config);
		// Fill the bill line straight away rather than making the household wait
		// for the hourly tick. Failures are not fatal: the platform is connected
		// either way, and the next tick tries again.
		await syncMeterBill().catch((err) =>
			console.warn('Meter bill sync failed:', err?.message ?? err)
		);
		return { ok: true };
	},

	disconnect: async () => {
		await setSetting('home', null);
		return { ok: true };
	},

	toggleDevice: async ({ request }) => {
		const form = await request.formData();
		const deviceId = String(form.get('deviceId') ?? '');
		const on = String(form.get('on')) === 'true';
		const provider = await configuredHomeProvider();
		if (!provider) return fail(400, { message: 'No platform connected.' });
		try {
			await provider.setDevice(deviceId, on);
		} catch (err) {
			return fail(502, {
				message: err instanceof Error ? err.message : 'The device did not respond.'
			});
		}
		return { ok: true };
	},

	// Entity pickers for the HA form: probe the given credentials and list
	// candidate sensors per meter slot.
	discover: async ({ request }) => {
		const form = await request.formData();
		const url = String(form.get('url') ?? '')
			.trim()
			.replace(/\/$/, '');
		const token = String(form.get('token') ?? '').trim();
		if (!url || !token) return fail(400, { message: 'URL and token first.' });
		try {
			const candidates = await haMeterCandidates(url, token);
			return { candidates };
		} catch (err) {
			return fail(502, {
				message: err instanceof Error ? err.message : 'Home Assistant did not answer.'
			});
		}
	}
};
