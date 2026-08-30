// "What already tests this?" — the question to answer BEFORE writing a test.
//
// Builds the index in memory on every run, so the answer reflects the working
// tree rather than whatever was last committed to tests/COVERAGE.md. Searches
// module paths, test file paths, suite names and test titles, because you may
// arrive knowing any one of them.
//
//   npm run test:where account
//   npm run test:where '$lib/server/salary'
//   npm run test:where reconcil
import { buildIndex } from './test-index.mjs';

const term = process.argv.slice(2).join(' ').trim();
if (!term) {
	console.error('Usage: npm run test:where <module | path | words from a test name>');
	process.exit(2);
}

const needle = term.toLowerCase().replace(/^\$lib/, 'src/lib');
const matches = (text) => text.toLowerCase().includes(needle);

const index = buildIndex();

// A module hit is the strongest answer: it names every test that imports it.
const modules = [...index.modules].filter(([module]) => matches(module));

// A title hit catches behaviour that lives under a module you did not guess.
const titles = index.files
	.map((file) => ({
		file,
		hits: file.tests.filter((test) => matches(test.title) || matches(test.suite))
	}))
	.filter((entry) => entry.hits.length > 0 || matches(entry.file.path));

if (!modules.length && !titles.length) {
	console.log(`Nothing covers "${term}" yet — a new test file is the right call.`);
	process.exit(0);
}

if (modules.length) {
	console.log(`\nModules matching "${term}":\n`);
	for (const [module, files] of modules) {
		console.log(`  ${module}`);
		for (const file of files) {
			console.log(`    ← ${file.path}  (${file.tier}, ${file.tests.length} tests)`);
		}
		console.log('');
	}
}

if (titles.length) {
	console.log(`Tests naming "${term}":\n`);
	for (const { file, hits } of titles) {
		console.log(`  ${file.path}  (${file.tier})`);
		for (const test of hits.slice(0, 8)) {
			console.log(`    · ${test.suite ? `${test.suite} › ` : ''}${test.title}`);
		}
		if (hits.length > 8) console.log(`    · …and ${hits.length - 8} more`);
		console.log('');
	}
}

console.log('Extend one of these when the behaviour belongs with it; add a file only if not.');
