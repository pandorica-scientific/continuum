// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The downstream surface, pinned.
 *
 * A separate private repository builds on this one by registering into the
 * seams below and editing nothing. Under fork-and-merge nothing tells this
 * repository when it has broken that arrangement: a rename applies cleanly to
 * a fork that only CALLS the renamed thing, and the breakage surfaces days
 * later in a different repository.
 *
 * So this file is a tripwire rather than a behaviour test. The behaviour of
 * each seam is covered where it always was; what is asserted here is only that
 * the seam still exists, still has its shape, and still accepts and forgets a
 * registration. Deleting or renaming any of it fails CI in the repository that
 * did it, which is the only place the failure is cheap.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setStorageDriver, storageDriver, type StorageDriver } from '$lib/server/system/storage';
import { localDisk } from '$lib/server/system/local-disk';
import { openUpload, readUpload, removeUpload, uploadSize } from '$lib/server/system/files';
import { db, resetDbResolver, setDbResolver, type Db } from '$lib/server/db';
import {
	bootSteps,
	bootTasks,
	registerBootStep,
	registerBootTask,
	unregisterBoot
} from '$lib/server/boot';
import {
	AREAS,
	areas,
	defaultModules,
	modules,
	pathDisabled,
	registerArea,
	registerModule,
	registerScreen,
	visibleAreas,
	type ModuleToggles
} from '$lib/modules/registry';
import type { RequestEvent } from '@sveltejs/kit';
import {
	isPublicPath,
	publicPaths,
	registerPublicPath,
	registerRequestGate,
	requestGates,
	unregisterRequestGate
} from '$lib/server/auth/gates';

describe('the extensions front door', () => {
	it('exists and is empty', () => {
		const source = readFileSync('src/lib/server/extensions/index.ts', 'utf8');
		// A core registration here would disappear when a downstream overwrote
		// the file, taking a platform default with it.
		expect(source).toContain('export {};');
		expect(source).not.toMatch(/^import\s/m);
	});

	it('is imported by the server hooks before any registry is read', () => {
		const hooks = readFileSync('src/hooks.server.ts', 'utf8');
		expect(hooks).toContain("import '$lib/server/extensions';");
	});
});

/** A driver that keeps everything in a Map, for asserting the seam is real. */
function memoryDriver(): StorageDriver {
	const store = new Map<string, Uint8Array>();
	return {
		id: 'memory',
		async put(name, bytes) {
			store.set(name, bytes);
		},
		async get(name) {
			return store.get(name) ?? null;
		},
		async size(name) {
			return store.get(name)?.byteLength ?? null;
		},
		async remove(name) {
			return store.delete(name);
		},
		async open(name) {
			const bytes = store.get(name);
			if (!bytes) return null;
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				}
			});
			return { stream, size: bytes.byteLength };
		}
	};
}

describe('the storage seam', () => {
	// A uuid + extension, which is the only shape files.ts will handle.
	const NAME = '00000000-0000-4000-8000-000000000000.pdf';

	it('serves uploads through whichever driver is registered', async () => {
		setStorageDriver(memoryDriver());
		try {
			await storageDriver().put(NAME, new Uint8Array([1, 2, 3]));
			expect(await readUpload(NAME)).toEqual(new Uint8Array([1, 2, 3]));
			expect(await uploadSize(NAME)).toBe(3);
			expect(await removeUpload(NAME)).toBe(true);
			expect(await readUpload(NAME)).toBeNull();
		} finally {
			setStorageDriver(localDisk);
		}
	});

	// The headers are policy and must not come from the driver: an uploaded SVG
	// is inert because of the content-security-policy below, whoever stores it.
	it('builds the served response above the driver', async () => {
		setStorageDriver(memoryDriver());
		try {
			await storageDriver().put(NAME, new Uint8Array([1, 2, 3]));
			const response = await openUpload(NAME);
			expect(response?.headers.get('content-type')).toBe('application/pdf');
			expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response?.headers.get('content-security-policy')).toContain("default-src 'none'");
			expect(response?.headers.get('content-length')).toBe('3');
		} finally {
			setStorageDriver(localDisk);
		}
	});

	// The path-traversal guard sits above the driver, so a driver cannot lose it.
	it('refuses a name it did not mint, whatever the driver holds', async () => {
		setStorageDriver(memoryDriver());
		try {
			await storageDriver().put('../secret.pdf', new Uint8Array([1]));
			expect(await readUpload('../secret.pdf')).toBeNull();
			expect(await openUpload('../secret.pdf')).toBeNull();
		} finally {
			setStorageDriver(localDisk);
		}
	});

	it('has the local disk registered by default', () => {
		expect(storageDriver().id).toBe('local-disk');
	});
});

describe('the database seam', () => {
	it('resolves the handle through the registered resolver', () => {
		const calls: string[] = [];
		// Not a real handle — the point is only that the proxy asks the resolver
		// and hands back what it gets, which is what a per-tenant resolver needs.
		const fake = {
			marker: 'fake',
			select: () => calls.push('select')
		} as unknown as Db;

		setDbResolver(() => fake);
		try {
			expect((db as unknown as { marker: string }).marker).toBe('fake');
			(db as unknown as { select: () => void }).select();
			expect(calls).toEqual(['select']);
		} finally {
			resetDbResolver();
		}
	});
});

describe('the boot seam', () => {
	it('registers the core steps in dependency order', () => {
		const ids = bootSteps().map((s) => s.id);
		// Currencies before anything that writes one; banks before any account.
		expect(ids).toEqual(['migrate', 'currencies', 'categories', 'banks', 'demo']);
	});

	it('registers the core recurring work', () => {
		const ids = bootTasks()
			.map((t) => t.id)
			.sort();
		expect(ids).toEqual(
			['backup', 'calendar', 'cpu-queue', 'fx', 'meter', 'networth', 'scan-sweep'].sort()
		);
	});

	// These lines are what an operator reads when something is wrong on their
	// own server, and they predate the registry. Deriving them from the id would
	// have quietly reworded all seven.
	it('keeps the log label each task had before it was a registration', () => {
		const labels = Object.fromEntries(bootTasks().map((t) => [t.id, t.label]));
		expect(labels['cpu-queue']).toBe('CPU queue');
		expect(labels['fx']).toBe('FX refresh');
		expect(labels['networth']).toBe('Net worth snapshot');
	});

	it('accepts and forgets a registration', () => {
		registerBootStep({ id: 'test-step', run: async () => {} });
		registerBootTask({ id: 'test-task', label: 'Test task', every: 1000, run: async () => {} });
		expect(bootSteps().map((s) => s.id)).toContain('test-step');
		expect(bootTasks().map((t) => t.id)).toContain('test-task');

		unregisterBoot('test-step');
		unregisterBoot('test-task');
		expect(bootSteps().map((s) => s.id)).not.toContain('test-step');
		expect(bootTasks().map((t) => t.id)).not.toContain('test-task');
	});

	// A downstream drops what makes no sense for it; that has to actually work.
	it('lets a core default be dropped', () => {
		expect(bootTasks().map((t) => t.id)).toContain('backup');
		unregisterBoot('backup');
		expect(bootTasks().map((t) => t.id)).not.toContain('backup');
	});
});

describe('the navigation seam', () => {
	it('gates a registered module exactly like a core one', () => {
		registerModule('billing', { emoji: '💳', label: 'Billing', note: 'the subscription' });
		registerArea({
			key: 'billing',
			label: 'Billing',
			icon: 'wallet',
			hue: 'fg3',
			screens: [{ path: '/billing', label: 'Billing', icon: 'wallet', module: 'billing' }]
		});

		expect(Object.keys(modules())).toContain('billing');
		expect(areas().map((a) => a.key)).toContain('billing');

		const on = { billing: true } as unknown as ModuleToggles;
		const off = { billing: false } as unknown as ModuleToggles;
		expect(pathDisabled('/billing', on)).toBe(false);
		expect(pathDisabled('/billing', off)).toBe(true);
		// The route guard covers children, as it does for a core module.
		expect(pathDisabled('/billing/invoices', off)).toBe(true);
		expect(visibleAreas(off).map((a) => a.key)).not.toContain('billing');
	});

	// Settings spreads these under whatever is stored, so a module missing here
	// would arrive switched off rather than on.
	it('turns a registered module on by default', () => {
		expect(defaultModules().billing).toBe(true);
		expect(defaultModules().property).toBe(true);
	});

	it('adds a screen to an area that already exists', () => {
		registerScreen('money', { path: '/usage', label: 'Usage', icon: 'ledger' });
		expect(
			areas()
				.find((a) => a.key === 'money')
				?.screens.map((s) => s.path)
		).toContain('/usage');
		// Registering into a core area mutates the literal. Vitest isolates test
		// FILES, so nav-areas.test.ts gets its own module graph and is unaffected;
		// this is belt on braces.
		AREAS.find((a) => a.key === 'money')?.screens.pop();
	});

	it('refuses a screen for an area that does not exist', () => {
		expect(() => registerScreen('nope', { path: '/x', label: 'X', icon: 'wallet' })).toThrow();
	});
});

describe('the request-gate seam', () => {
	it('starts with no gates, so the core behaves as it always did', () => {
		expect(requestGates()).toEqual([]);
	});

	it('accepts and forgets a gate', async () => {
		registerRequestGate({
			id: 'test-gate',
			check: async () => new Response('no', { status: 402 })
		});
		expect(requestGates().map((g) => g.id)).toEqual(['test-gate']);

		const refusal = await requestGates()[0].check({} as RequestEvent);
		expect(refusal?.status).toBe(402);

		unregisterRequestGate('test-gate');
		expect(requestGates()).toEqual([]);
	});

	it('keeps the five public prefixes the core needs', () => {
		expect(publicPaths()).toEqual(['/login', '/setup', '/ics', '/api', '/enroll']);
	});

	it('matches a public path and its children but not a longer sibling', () => {
		expect(isPublicPath('/api')).toBe(true);
		expect(isPublicPath('/api/v1/accounts')).toBe(true);
		expect(isPublicPath('/apifoo')).toBe(false);
		expect(isPublicPath('/overview')).toBe(false);
	});

	// Runs last: registerPublicPath is deliberately permanent, so this would
	// break the assertion on the five core prefixes if it ran before it.
	it('accepts a downstream public path', () => {
		registerPublicPath('/webhooks');
		expect(isPublicPath('/webhooks/stripe')).toBe(true);
	});
});
