// SPDX-License-Identifier: AGPL-3.0-or-later
// Print the CHANGELOG.md section for a version — the release notes, read from
// the one place they are written.
//
//   node scripts/changelog-section.mjs          the version in package.json
//   node scripts/changelog-section.mjs 0.4.6    any other
//
// Two callers in CI, and that is the reason this is a file rather than an awk
// one-liner inlined twice: the `gate` job runs it to refuse a release with no
// notes BEFORE the image build rather than after it, and the `release` job runs
// it again
// to write those notes. Two copies of the same extraction is two things that
// can come to disagree about where a section ends.
//
// Exits 1 with a clear message when the section is missing or empty, so either
// caller can simply let it fail.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const version = process.argv[2] ?? JSON.parse(read('package.json')).version;

// The heading is `## <version> — <date>`, so the version is matched with its
// trailing space: without it "## 0.5.0" would also match "## 0.5.01".
const lines = read('CHANGELOG.md').split('\n');
const start = lines.findIndex((line) => line.startsWith(`## ${version} `));
if (start === -1) {
	console.error(
		`CHANGELOG.md has no "## ${version}" section — a release without notes is not a release`
	);
	process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith('## '));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!body) {
	console.error(
		`CHANGELOG.md's "## ${version}" section is empty — a release without notes is not a release`
	);
	process.exit(1);
}

console.log(body);
