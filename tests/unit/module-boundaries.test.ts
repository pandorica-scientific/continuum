import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `src/lib/server` held twenty loose files beside nine directories, so where a
 * new domain belonged was a coin toss and the answer drifted: `calendar.ts` sat
 * beside `calendar/`, `policy.ts` beside `auth/policy.ts`, `demo.ts` beside
 * `home/demo.ts`.
 *
 * One rule fixes that permanently — a domain is a directory — and it is only a
 * rule if something checks it. `$lib/server/x` resolves to `x/index.ts` exactly
 * as it resolved to `x.ts`, so obeying it costs no caller anything.
 */
const SERVER = 'src/lib/server';

describe('src/lib/server', () => {
	it('holds directories only', () => {
		const loose = readdirSync(SERVER).filter((entry) => statSync(join(SERVER, entry)).isFile());
		expect(loose).toEqual([]);
	});

	it('gives every directory an entry point', () => {
		// A directory with no index.ts cannot be imported as a unit, which is the
		// whole point of the rule above.
		const missing = readdirSync(SERVER)
			.filter((entry) => statSync(join(SERVER, entry)).isDirectory())
			.filter((dir) => !readdirSync(join(SERVER, dir)).includes('index.ts'));
		expect(missing).toEqual([]);
	});
});
