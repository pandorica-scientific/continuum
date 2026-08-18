/**
 * Fetch the OCR language data Continuum reads scanned statements with.
 *
 * Runs at BUILD or SETUP time, never at import time. The product promises it
 * never calls home, and that promise is about what happens while someone is
 * using it — a one-off fetch when the image is built is the opposite of
 * telemetry. The alternative, letting tesseract.js pull each language from a
 * CDN the first time a scan arrives, would break the promise exactly when a
 * user is handing us their bank statements.
 *
 *   npm run fetch:tessdata
 *
 * The files land in tessdata/ (gitignored — 12 MB of binaries do not belong in
 * a git history) and the Dockerfile runs this in its build stage.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Czech, Polish, German, Spanish and English: the languages the sampled
// statements are actually written in.
const LANGUAGES = ['eng', 'ces', 'pol', 'deu', 'spa'];
/**
 * The "fast" models, not the full ones — measured, not assumed.
 *
 * On the sampled pages fast matched the full data exactly on German (50/50
 * amounts) and Spanish (41/41), did slightly BETTER on Czech, and ran about
 * 40% quicker. It is 7.4 MB against 40 MB, which on a self-hosted image is the
 * difference between a rounding error and a noticeable download.
 */
const BASE = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const DIRECTORY = 'tessdata';

const exists = async (path) => {
	try {
		return (await stat(path)).size > 0;
	} catch {
		return false;
	}
};

await mkdir(DIRECTORY, { recursive: true });

let fetched = 0;
for (const language of LANGUAGES) {
	const name = `${language}.traineddata.gz`;
	const target = join(DIRECTORY, name);
	if (await exists(target)) {
		console.log(`  have ${name}`);
		continue;
	}
	const url = `${BASE}/${name}`;
	process.stdout.write(`  fetching ${name} … `);
	const response = await fetch(url);
	if (!response.ok) {
		console.error(`failed (${response.status})`);
		process.exitCode = 1;
		continue;
	}
	await writeFile(target, Buffer.from(await response.arrayBuffer()));
	const { size } = await stat(target);
	console.log(`${(size / 1024 / 1024).toFixed(1)} MB`);
	fetched++;
}

console.log(
	fetched === 0
		? 'OCR language data already present.'
		: `OCR language data ready in ${DIRECTORY}/ (${fetched} fetched).`
);
