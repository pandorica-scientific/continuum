// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A domain is a directory in `src/lib/server` — enforced here so it stays true.
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
	 * An `index.ts` nothing imports is a second, unused way into a domain, not a
	 * barrel worth keeping.
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
