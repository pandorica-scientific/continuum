// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What happens once the process starts, as a list rather than a function body.
 *
 * A STEP runs once, in registration order, and must finish before any request
 * is served (migrations, seeds later writes depend on). A TASK is recurring
 * work, first run at boot and then every `every` milliseconds.
 *
 * A step that rejects fails the boot (retried on the next request, see
 * hooks.server.ts). A task that rejects is logged and its schedule continues —
 * a home server that cannot reach the currency fixing must keep working on
 * the rates it has.
 *
 * Kept as a registry so a project built on this repository can drop steps
 * that make no sense for it without editing the boot retry semantics.
 */
import { registerCoreBoot } from './defaults';

export interface BootStep {
	id: string;
	run(): Promise<void>;
}

export interface BootTask {
	id: string;
	/** Milliseconds between runs. The first run is at boot. */
	every: number;
	/** What a failure is called in the log; kept separate from `id`. */
	label: string;
	run(): Promise<void>;
}

const steps: BootStep[] = [];
const tasks: BootTask[] = [];

export function registerBootStep(step: BootStep): void {
	steps.push(step);
}

export function registerBootTask(task: BootTask): void {
	tasks.push(task);
}

/** Drop a registration by id, so a downstream can switch off a default without editing defaults.ts. */
export function unregisterBoot(id: string): void {
	for (const list of [steps, tasks] as { id: string }[][]) {
		const at = list.findIndex((entry) => entry.id === id);
		if (at >= 0) list.splice(at, 1);
	}
}

export function bootSteps(): BootStep[] {
	return [...steps];
}

export function bootTasks(): BootTask[] {
	return [...tasks];
}

// A call rather than a side-effecting `import './defaults'`: an import
// declaration hoists, so defaults.ts would run its registerBootStep calls
// while `steps` and `tasks` above are still in the temporal dead zone.
registerCoreBoot();
