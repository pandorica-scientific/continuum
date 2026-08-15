import { rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const SCRATCH_ROOT = resolve('scratch-workspace');

/**
 * Embedded Postgres leaves its data directory behind when a test process is
 * interrupted. Remove only a named directory below the repository scratch
 * root so a subsequent run can initialise cleanly.
 */
export function removeStalePostgresDirectory(databaseDir: string): void {
	const relativePath = relative(SCRATCH_ROOT, resolve(databaseDir));
	if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
		throw new Error(
			`Refusing to remove embedded Postgres directory outside scratch-workspace: ${databaseDir}`
		);
	}
	rmSync(databaseDir, { recursive: true, force: true });
}
