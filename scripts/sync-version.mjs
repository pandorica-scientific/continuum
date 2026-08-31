// SPDX-License-Identifier: AGPL-3.0-or-later
// package.json's version is the source of truth. Everything else that names a
// version follows from it.
//
// There are three such places and they drift silently, because nothing reads
// them back: package-lock.json is only rewritten when a DEPENDENCY changes, so
// a bump touching package.json alone leaves it behind — it had read 0.4.1 for
// three releases before anyone looked. docs/install.md pins an image tag people
// copy. And a release with no changelog section is a release with no notes.
//
// Two modes, one rule:
//   node scripts/sync-version.mjs           write the files into agreement
//   node scripts/sync-version.mjs --check   report disagreement, change nothing
//
// The pre-commit hook runs the first, CI runs the second. Sharing the file is
// the point: a check that reimplements what the fixer does is a check that
// eventually disagrees with it.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const check = process.argv.includes('--check');
const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const version = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`package.json version "${version}" does not look like a version`);
	process.exit(1);
}

/** Each target reports what it found and what it should be. */
const targets = [
	{
		file: 'package-lock.json',
		// Both fields, not just the top one: npm keeps a second copy under
		// packages[""] and tooling reads whichever it happens to prefer.
		find: (text) => {
			const lock = JSON.parse(text);
			const found = [lock.version, lock.packages?.['']?.version].filter(Boolean);
			return found.every((v) => v === version) ? null : found.join(' / ');
		},
		fix: (text) => {
			const lock = JSON.parse(text);
			lock.version = version;
			if (lock.packages?.['']) lock.packages[''].version = version;
			// npm writes tabs and a trailing newline; matching that keeps the
			// diff to the two lines that changed.
			return JSON.stringify(lock, null, '\t') + '\n';
		}
	},
	{
		file: 'docs/install.md',
		find: (text) => {
			const stale = [...text.matchAll(/continuum:(\d+\.\d+\.\d+)/g)]
				.map((m) => m[1])
				.filter((v) => v !== version);
			return stale.length ? [...new Set(stale)].join(', ') : null;
		},
		fix: (text) => text.replace(/continuum:\d+\.\d+\.\d+/g, `continuum:${version}`)
	}
];

let drifted = 0;
for (const target of targets) {
	const text = read(target.file);
	const found = target.find(text);
	if (!found) continue;
	drifted++;
	if (check) {
		console.error(`${target.file}: says ${found}, expected ${version}`);
	} else {
		writeFileSync(resolve(root, target.file), target.fix(text));
		console.log(`${target.file}: ${found} -> ${version}`);
	}
}

// The changelog cannot be written for you, so this only ever reports. It is a
// warning rather than a failure because the version and its notes legitimately
// land in different commits while a branch is in progress — the release job
// refuses at the point it actually matters, which is publishing.
const hasNotes = read('CHANGELOG.md')
	.split('\n')
	.some((line) => line.startsWith(`## ${version} `));
if (!hasNotes) {
	console.warn(
		`CHANGELOG.md: no "## ${version}" section yet — the release will be refused without one`
	);
}

if (check && drifted) {
	console.error('\nRun: npm run version:sync');
	process.exit(1);
}
