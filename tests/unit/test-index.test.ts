import { describe, expect, it } from 'vitest';
import {
	globToRegExp,
	includePatterns,
	parseTestFile,
	resolveModule
} from '../../scripts/test-index.mjs';

/**
 * The coverage index answers "what already tests this module?", which is the
 * question that stops the suite growing by accretion. It is only trustworthy
 * if its parsing is, so the parsing is pinned here.
 */
describe('includePatterns', () => {
	it('reads the globs out of a vite config rather than repeating them', () => {
		const config = `export default {
			test: {
				include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
				environment: 'node'
			}
		};`;
		expect(includePatterns(config)).toEqual(['src/**/*.test.ts', 'tests/unit/**/*.test.ts']);
	});

	it('refuses a config with no include array instead of silently indexing nothing', () => {
		expect(() => includePatterns('export default { test: {} };')).toThrow(/no test.include/);
	});

	it('matches what this repository actually configures', () => {
		// Guards the regex against a reformat of vite.config.ts.
		expect(includePatterns()).toContain('tests/unit/**/*.test.ts');
	});
});

describe('globToRegExp', () => {
	it('matches a file directly inside the globbed directory', () => {
		// `**` has to be optional — `tests/unit/x.test.ts` has nothing in its place.
		expect(globToRegExp('tests/unit/**/*.test.ts').test('tests/unit/salary.test.ts')).toBe(true);
	});

	it('matches a file nested any number of directories deep', () => {
		expect(globToRegExp('src/**/*.test.ts').test('src/lib/server/fx/rates.test.ts')).toBe(true);
	});

	it('does not match a neighbouring directory that shares a prefix', () => {
		expect(globToRegExp('tests/unit/**/*.test.ts').test('tests/units/x.test.ts')).toBe(false);
	});

	it('does not match a file that is not a test', () => {
		expect(globToRegExp('tests/unit/**/*.test.ts').test('tests/unit/harness.ts')).toBe(false);
	});
});

describe('parseTestFile', () => {
	it('collects the module specifiers a test imports', () => {
		const source = `import { a } from '$lib/server/salary';
import { b } from './harness';`;
		expect(parseTestFile(source).imports).toEqual(['$lib/server/salary', './harness']);
	});

	it('pairs each test with the describe that encloses it', () => {
		const source = `describe('salary', () => {
	it('reads gross pay', () => {});
});`;
		expect(parseTestFile(source).tests).toEqual([{ suite: 'salary', title: 'reads gross pay' }]);
	});

	it('joins nested describes into one path', () => {
		const source = `describe('salary', () => {
	describe('bonus', () => {
		it('prorates a part year', () => {});
	});
});`;
		expect(parseTestFile(source).tests[0].suite).toBe('salary › bonus');
	});

	it('closes a describe when the next one is no deeper', () => {
		// Without this the second suite inherits the first as a parent, and every
		// title in the map reads as nested under something unrelated.
		const source = `describe('first', () => {
	it('one', () => {});
});
describe('second', () => {
	it('two', () => {});
});`;
		const { tests } = parseTestFile(source);
		expect(tests.map((test) => test.suite)).toEqual(['first', 'second']);
	});

	it('records a test written outside any describe', () => {
		expect(parseTestFile(`it('stands alone', () => {});`).tests).toEqual([
			{ suite: '', title: 'stands alone' }
		]);
	});

	it('reads it.each and test.skip as tests', () => {
		const source = `it.each([1])('handles %i', () => {});
test.skip('parked', () => {});`;
		expect(parseTestFile(source).tests.map((test) => test.title)).toEqual(['handles %i', 'parked']);
	});
});

describe('resolveModule', () => {
	const present = new Set([
		'src/lib/server/salary/index.ts',
		'src/lib/server/csrf.ts',
		'src/lib/Chart.svelte'
	]);
	const exists = (path: string) => present.has(path);

	it('resolves a directory module to its entry point', () => {
		expect(resolveModule('$lib/server/salary', exists)).toBe('src/lib/server/salary/index.ts');
	});

	it('resolves a file module to the file', () => {
		expect(resolveModule('$lib/server/csrf', exists)).toBe('src/lib/server/csrf.ts');
	});

	it('resolves a component', () => {
		expect(resolveModule('$lib/Chart.svelte', exists)).toBe('src/lib/Chart.svelte');
	});

	it('ignores a specifier that does not name a project module', () => {
		// Relative and package imports say nothing about which module is covered.
		expect(resolveModule('./harness', exists)).toBeNull();
		expect(resolveModule('vitest', exists)).toBeNull();
	});

	it('keeps an unresolvable $lib specifier rather than dropping the edge', () => {
		expect(resolveModule('$lib/server/ghost', exists)).toBe('src/lib/server/ghost');
	});
});
