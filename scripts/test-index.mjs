// Which tests cover which module, derived from what the tests import.
//
// 124 of 174 unit test files are named for a topic — `tax-band`, `scan-exif`,
// `calendar-merge` — not for a module, so the filesystem cannot answer "what
// already tests this?". Adding a new file was therefore always cheaper than
// finding the right existing one, and the suite grew by accretion.
//
// Names are the wrong key for that question anyway: a test named for a
// behaviour may exercise four modules. What a test IMPORTS is what it
// exercises, so imports are the key here.
//
// Run `npm run test:index` to refresh the committed map; `npm run test:where`
// answers a single question and builds its own index in memory, so the answer
// is never stale.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MARKDOWN = 'tests/COVERAGE.md';

// The globs live in vite.config.ts. Reading them rather than repeating them
// means a new test directory is picked up here the moment vitest sees it.
export function includePatterns(config = readFileSync('vite.config.ts', 'utf8')) {
	const block = config.match(/include:\s*\[([^\]]*)\]/s);
	if (!block) throw new Error('vite.config.ts has no test.include array to read');
	return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, pattern]) => pattern);
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
	// Only the three forms vitest's include uses: `**`, `*`, and literal text.
	const source = pattern
		.split('/')
		.map((/** @type {string} */ segment) => {
			if (segment === '**') return '(?:.+)?';
			return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
		})
		.join('/')
		.replace(/\(\?:\.\+\)\?\//g, '(?:.+/)?');
	return new RegExp(`^${source}$`);
}

/**
 * @param {string} dir
 * @param {string[]} found
 * @returns {string[]}
 */
function walk(dir, found = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, found);
		else found.push(path);
	}
	return found;
}

export function testFiles(roots = ['src', 'tests']) {
	const matchers = includePatterns().map(globToRegExp);
	return roots
		.flatMap((root) => walk(root))
		.filter((path) => matchers.some((matcher) => matcher.test(path)))
		.sort();
}

// `$lib/server/documents/shelves` names a module; on disk it is either that
// file or that directory's index. Resolving here keeps the map keyed by real
// paths, so a reader can open what it names.
/**
 * @param {string} specifier
 * @param {(path: string) => boolean} exists
 * @returns {string | null}
 */
export function resolveModule(specifier, exists = (path) => fileExists(path)) {
	if (!specifier.startsWith('$lib/')) return null;
	const base = specifier.replace(/^\$lib/, 'src/lib');
	for (const candidate of [base, `${base}.ts`, `${base}/index.ts`, `${base}.svelte`]) {
		if (exists(candidate)) return candidate;
	}
	// An unresolvable specifier is still a real edge in the map — record the
	// module name rather than dropping the test's only clue.
	return base;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function fileExists(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

// `it('name')` and `it.each([...])('name')` both name a test, but the second
// puts the name in a follow-on call. The optional group below matches that
// first call only when it does not open with a quote, so a plain `it('name')`
// still hands its own title straight to the capture.
const TITLE = {
	describe: /^(\s*)describe(?:\.\w+)?\s*(?:\(\s*[^'"`)][^)]*\)\s*)?\(\s*['"`]([^'"`]+)/,
	test: /^(\s*)(?:it|test)(?:\.\w+)?\s*(?:\(\s*[^'"`)][^)]*\)\s*)?\(\s*['"`]([^'"`]+)/
};

/**
 * @param {string} source
 * @returns {{
 *   imports: string[],
 *   suites: string[],
 *   tests: { suite: string, title: string }[]
 * }}
 */
export function parseTestFile(source) {
	const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
		([, specifier]) => specifier
	);

	// Prettier formats this repo, so indentation is trustworthy: a test belongs
	// to the nearest describe above it that is indented less deeply.
	/** @type {string[]} */
	const suites = [];
	/** @type {{ suite: string, title: string }[]} */
	const tests = [];
	/** @type {{ indent: string, title: string }[]} */
	const open = [];

	// Close every describe that is not shallower than this line before reading
	// what encloses it. Written as a loop over a local rather than
	// `open.at(-1).indent` so the empty case is handled rather than asserted.
	const closeTo = (/** @type {string} */ indent) => {
		while (open.length) {
			const top = open[open.length - 1];
			if (top.indent.length < indent.length) break;
			open.pop();
		}
	};
	for (const line of source.split('\n')) {
		const describe = line.match(TITLE.describe);
		if (describe) {
			const [, indent, title] = describe;
			closeTo(indent);
			open.push({ indent, title });
			suites.push(open.map((entry) => entry.title).join(' › '));
			continue;
		}
		const test = line.match(TITLE.test);
		if (test) {
			const [, indent, title] = test;
			closeTo(indent);
			tests.push({ suite: open.map((entry) => entry.title).join(' › '), title });
		}
	}
	return { imports, suites, tests };
}

/**
 * @param {string} path
 * @returns {string}
 */
function tierOf(path) {
	const [, tier] = path.match(/^tests\/([^/]+)\//) ?? [];
	return tier ?? 'colocated';
}

export function buildIndex() {
	const files = testFiles().map((path) => {
		const parsed = parseTestFile(readFileSync(path, 'utf8'));
		const modules = [
			...new Set(parsed.imports.map((specifier) => resolveModule(specifier)).filter(Boolean))
		].sort();
		return { path, tier: tierOf(path), modules, tests: parsed.tests };
	});

	const modules = new Map();
	for (const file of files) {
		for (const module of file.modules) {
			if (!modules.has(module)) modules.set(module, []);
			modules.get(module).push(file);
		}
	}

	const untested = walk('src/lib')
		.filter((path) => /\.(ts|svelte)$/.test(path) && !/\.test\.ts$/.test(path))
		.filter((path) => !modules.has(path))
		.sort();

	return {
		files,
		modules: new Map([...modules].sort(([a], [b]) => a.localeCompare(b))),
		untested,
		totals: {
			files: files.length,
			tests: files.reduce((sum, file) => sum + file.tests.length, 0),
			modules: modules.size,
			untested: untested.length
		}
	};
}

/**
 * @param {ReturnType<typeof buildIndex>} index
 * @returns {string}
 */
function markdown(index) {
	const { totals } = index;
	const lines = [
		'<!-- Generated by `npm run test:index`. Do not edit by hand. -->',
		'',
		'# What tests what',
		'',
		'Every source module below is followed by the test files that import it and',
		'the behaviours they pin. Keyed by imports rather than by filename, because a',
		'test named for a behaviour often exercises several modules.',
		'',
		'Before adding a test file, run `npm run test:where <module>` and read what is',
		'already here. Extend an existing file when the behaviour belongs with it.',
		'',
		`${totals.tests} static tests across ${totals.files} files, covering ${totals.modules} modules.`,
		`${totals.untested} modules under \`src/lib\` are imported by no test.`,
		'',
		'## Modules',
		''
	];

	for (const [module, files] of index.modules) {
		lines.push(`### \`${module}\``, '');
		for (const file of files) {
			lines.push(`- \`${file.path}\` (${file.tier}, ${file.tests.length} tests)`);
		}
		lines.push('');
	}

	lines.push('## Modules imported by no test', '');
	for (const module of index.untested) lines.push(`- \`${module}\``);
	lines.push('');
	return lines.join('\n');
}

if (process.argv[1] && relative(process.cwd(), process.argv[1]) === 'scripts/test-index.mjs') {
	const index = buildIndex();
	writeFileSync(MARKDOWN, markdown(index));
	const { totals } = index;
	console.log(
		`${MARKDOWN} rewritten: ${totals.tests} tests, ${totals.files} files, ` +
			`${totals.modules} modules covered, ${totals.untested} uncovered.`
	);
}
