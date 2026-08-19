// Exported names that no OTHER file mentions. Advisory, not a gate: a name
// reached only through `import * as x` looks unused here and is not, which is
// why this prints a list for a person to judge rather than failing a build.
//
// Run it, then prove each candidate by deleting it and running `npm run check`.
// The compiler is the authority; this only says where to look.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sources = execSync("find src -name '*.ts' -not -name '*.d.ts'", { encoding: 'utf8' })
	.trim()
	.split('\n');
const everything = execSync("find src tests -name '*.ts' -o -name '*.svelte'", {
	encoding: 'utf8'
})
	.trim()
	.split('\n');
const corpus = new Map(everything.map((file) => [file, readFileSync(file, 'utf8')]));

const declaration =
	/^export\s+(?:async\s+)?(const|let|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

const hits = [];
for (const file of sources) {
	for (const [, kind, name] of (corpus.get(file) ?? '').matchAll(declaration)) {
		const mentioned = [...corpus].some(
			([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text)
		);
		if (!mentioned) hits.push(`${file}  ${kind} ${name}`);
	}
}

console.log(hits.join('\n'));
console.log(`\n${hits.length} exported names are mentioned in no other file.`);
