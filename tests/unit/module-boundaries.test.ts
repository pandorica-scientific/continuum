// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `src/lib/server` held twenty loose files beside nine directories, so where a
 * new domain belonged was a coin toss and the answer drifted: `calendar.ts` sat
 * beside `calendar/`, `policy.ts` beside `auth/policy.ts`, `demo.ts` beside
 * `home/demo.ts`.
 *
 * One rule fixes that permanently — a domain is a directory — and it is only a
 * rule if something checks it.
 */
const SERVER = 'src/lib/server';

const directories = () =>
	readdirSync(SERVER).filter((entry) => statSync(join(SERVER, entry)).isDirectory());

describe('src/lib/server', () => {
	it('holds directories only', () => {
		const loose = readdirSync(SERVER).filter((entry) => statSync(join(SERVER, entry)).isFile());
		expect(loose).toEqual([]);
	});

	/**
	 * The rule used to be "every directory has an index.ts", and it was enforced
	 * and defeated at the same time: seven barrels existed because the test
	 * demanded them and nothing imported any of them, while every real caller
	 * reached past them into submodules.
	 *
	 * A barrel is not the goal — being importable as a unit is, and most domains
	 * genuinely are. Where one is not, the honest answer is no barrel rather than
	 * an empty one, because a `export *` over a whole domain has a real cost:
	 * `import/` deliberately never had one, since it would pull the OCR and PDF
	 * stacks into every caller that only wanted a type.
	 *
	 * So the rule is now about dead ends. An `index.ts` nothing imports is a
	 * second, unused way in, and it is exactly what accumulated last time.
	 */
	it('has no entry point nothing enters through', () => {
		const sources = [...walk('src'), ...walk('tests')];
		const text = sources.map((file) => readFileSync(file, 'utf8')).join('\n');

		const unused = directories()
			.filter((dir) => readdirSync(join(SERVER, dir)).includes('index.ts'))
			.filter((dir) => !text.includes(`$lib/server/${dir}'`));
		expect(unused, 'delete these, or import the domain through them').toEqual([]);
	});
});

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return walk(full);
		return /\.(ts|svelte)$/.test(name) ? [full] : [];
	});
}
