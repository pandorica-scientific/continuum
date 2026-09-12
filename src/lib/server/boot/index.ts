// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What happens once the process starts, as a list rather than a function body.
 *
 * Two kinds. A STEP runs once, in registration order, and must finish before
 * any request is served — migrations, and the seeds that later writes depend
 * on. A TASK is recurring work whose first call happens at boot and then every
 * `every` milliseconds.
 *
 * The difference that matters is failure. A step that rejects fails the boot,
 * and the caller decides what to do about it (see hooks.server.ts, where a
 * failed boot is retried on the next request rather than memoised). A task
 * that rejects is logged and its schedule continues, because a home server
 * that cannot reach the currency fixing must keep working on the rates it has.
 *
 * It is a registry so that a project built on this repository can drop the
 * steps that make no sense for it — per-instance migrations, local scheduled
 * backups, the demo seed — without editing the file that also holds the boot
 * retry semantics.
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
	/**
	 * What a failure is called in the log.
	 *
	 * Separate from `id` because these lines are what an operator reads when
	 * something is wrong on their own server, and they predate this registry.
	 * Deriving them from the id would have quietly reworded seven of them.
	 */
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

/**
 * Drop a registration by id.
 *
 * This is what lets a downstream switch off a default without editing where it
 * was registered — the alternative being a conditional in defaults.ts for a
 * condition this repository knows nothing about.
 */
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

// A call at the bottom rather than a side-effecting import.
//
// `import './defaults'` was tried and does not work: an import declaration is
// hoisted whatever line it is written on, so defaults.ts ran its
// registerBootStep calls while `steps` and `tasks` above were still in the
// temporal dead zone — `ReferenceError: Cannot access 'steps' before
// initialization`, at import time, before a single test could run. A function
// called here happens after both arrays exist, which is the point.
registerCoreBoot();
