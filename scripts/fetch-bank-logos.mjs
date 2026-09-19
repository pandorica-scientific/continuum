#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fetch bank logos into `assets/bank-logos/`, one WebP per bank key.
 *
 *   node scripts/fetch-bank-logos.mjs              # every seeded bank
 *   node scripts/fetch-bank-logos.mjs ing n26      # just these
 *   node scripts/fetch-bank-logos.mjs --list       # what would be fetched
 *
 * ## Read this before running it
 *
 * A bank's logo is its trademark. This script downloads marks belonging to
 * other companies, and whether they may be redistributed — in a container
 * image, a public fork, a screenshot — is a question about the use, not about
 * this script. Displaying the mark of the bank an account is actually held
 * with, inside a household's own instance, is the use this was written for,
 * and the folder is committed and copied into the image for it, with
 * `CREDITS.md` beside the files naming each one's source and terms and
 * `NOTICE.md` at the root saying what they are. Anyone shipping the folder
 * onward under another name reads those terms first.
 *
 * Nothing here runs in CI or in the Docker build; it runs by hand when a bank
 * rebrands or a new one is seeded. A bank with no file draws its emoji and is
 * missing nothing else.
 *
 * ## Where the files come from
 *
 * Wikidata's LOGO property (P154), resolved to a file on Wikimedia Commons —
 * the same source the geodata build already trusts, and for the same reason: it
 * names its provenance and licence per file instead of leaving them to
 * guesswork. Each bank below carries the Wikipedia article its Wikidata item is
 * reached through, so a wrong mark is traceable to a page somebody can look at.
 * The licence Commons reports is printed for every file, and it is yours to
 * read — bank marks are frequently non-free even there.
 *
 * ## Why P154 and nothing else
 *
 * The obvious shortcut is the article's lead image, and it is wrong. Asked for
 * ING that way, this script fetched `2020_ING_Bijlmerdreef_106.jpg` — a
 * photograph of their head office. A page leads with whatever it leads with.
 * P154 is the statement "this is that organisation's logo", so a bank whose
 * item has no P154 is SKIPPED and keeps its emoji. Guessing is how you end up
 * with a building where a logo should be, and nothing downstream could tell.
 *
 * ## Why WebP at 128px
 *
 * It is what the accounts screen draws (30 CSS px, so 120 physical on a 4x
 * screen) and what `$lib/server/banks/logos` looks for. `cwebp` is required,
 * the same dependency `convert-place-icons.mjs` already documents.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = process.env.BANK_LOGOS_DIR ?? 'assets/bank-logos';

/**
 * Where each bank's mark is found: a Wikidata id, or an English Wikipedia
 * article to reach one through.
 *
 * A `Q…` id is the better answer and is used directly. The article route was
 * the original one and it quietly fails for a bank with no English article —
 * Fio banka and Česká spořitelna both have a Wikidata item carrying their logo
 * and no en.wikipedia page to find it by, so both came back empty and looked
 * like banks that simply had no logo.
 *
 * Keys match `BANK_SEED` in `src/lib/banks.ts`. A key absent here is simply
 * never fetched and keeps its emoji, which is the right outcome for "Other"
 * and for anything a household added themselves.
 */
const SOURCES = {
	revolut: 'Revolut',
	wise: 'Wise_(company)',
	n26: 'N26',
	bunq: 'Bunq',
	ing: 'ING_Group',
	'deutsche-bank': 'Deutsche_Bank',
	commerzbank: 'Commerzbank',
	sparkasse: 'Sparkassen-Finanzgruppe',
	dkb: 'Deutsche_Kreditbank',
	'bnp-paribas': 'BNP_Paribas',
	'credit-agricole': 'Crédit_Agricole',
	'societe-generale': 'Société_Générale',
	santander: 'Banco_Santander',
	bbva: 'Banco_Bilbao_Vizcaya_Argentaria',
	caixabank: 'CaixaBank',
	unicredit: 'UniCredit',
	intesa: 'Intesa_Sanpaolo',
	'abn-amro': 'ABN_AMRO',
	rabobank: 'Rabobank',
	kbc: 'KBC_Bank',
	belfius: 'Belfius',
	erste: 'Erste_Group',
	'bank-of-ireland': 'Bank_of_Ireland',
	aib: 'Allied_Irish_Banks',
	nordea: 'Nordea',
	op: 'OP_Financial_Group',
	pko: 'PKO_Bank_Polski',
	fio: 'Q12016657', // Fio banka — no English article
	mbank: 'MBank',
	rb: 'Raiffeisen_Bank_International',
	cs: 'Q341100' // Česká spořitelna — no English article
};

const AGENT = 'continuum-bank-logos/1.0 (self-hosted household finance; one-off asset fetch)';

/**
 * How long to wait between requests, and how patiently to retry.
 *
 * Wikimedia rate-limits, and four requests per bank across thirty-odd banks
 * with no pause earns a 429 on every one of them — which is what the first run
 * of this script did. This is somebody else's free infrastructure being used
 * for a one-off fetch, so it is paced rather than hammered, and a 429 is waited
 * out rather than retried immediately.
 */
const PACE_MS = 350;
const RETRIES = 4;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One request, paced, and backed off when asked to slow down. */
async function polite(url, accept) {
	for (let attempt = 0; ; attempt++) {
		await sleep(PACE_MS);
		const res = await fetch(url, {
			headers: accept ? { 'user-agent': AGENT, accept } : { 'user-agent': AGENT },
			redirect: 'follow'
		});
		if (res.status !== 429 || attempt >= RETRIES) return res;
		// Their Retry-After when they send one, doubling otherwise.
		const after = Number(res.headers.get('retry-after'));
		await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
	}
}

/** The Wikidata item for a source: an id as given, or the one an article names. */
async function itemFor(source) {
	if (/^Q\d+$/.test(source)) return source;
	const url =
		`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops` +
		`&titles=${encodeURIComponent(source)}`;
	const res = await polite(url);
	if (!res.ok) throw new Error(`article ${res.status}`);
	const body = await res.json();
	const qid = Object.values(body?.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
	// Say which of the two it is. "No Wikidata item" and "no English article"
	// are different problems and only one of them is fixed by editing this map.
	if (!qid)
		throw new Error(`no Wikidata item via en.wikipedia "${source}" — give its Q-id instead`);
	return qid;
}

/** That item's logo (P154), as a Commons filename, or null where it states none. */
async function logoFile(qid) {
	const url =
		`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json` +
		`&property=P154&entity=${encodeURIComponent(qid)}`;
	const res = await polite(url);
	if (!res.ok) throw new Error(`wikidata ${res.status}`);
	const body = await res.json();
	return body?.claims?.P154?.[0]?.mainsnak?.datavalue?.value ?? null;
}

/**
 * The file's bytes at a usable size.
 *
 * `width` matters beyond bandwidth: most of these are SVG, which cwebp cannot
 * read. Commons rasterises to PNG when asked for a width, so the conversion
 * happens on their side and this script needs no SVG toolchain.
 */
async function bytesOf(file, width) {
	const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
	const res = await polite(url);
	if (!res.ok) throw new Error(`file ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

/**
 * What Commons says about the file.
 *
 * Read for the record, not just the console: these files are COMMITTED, so the
 * terms have to travel with them. `CREDITS.md` beside them is written from
 * this, which is the same job `NOTICE.md` does for the place engravings.
 */
const strip = (html) => {
	let text = String(html ?? '');
	// Until it stops changing, not once: one pass over "<<b>b>" removes the
	// inner tag and closes the outer one up into a whole new tag, and a
	// "<script" that never closes is not a tag to this pattern at all.
	for (let previous = null; previous !== text;) {
		previous = text;
		text = text.replace(/<[^>]*>/g, '');
	}
	// Entities after the tags, so a decoded bracket still meets the removal
	// below rather than arriving as markup once the stripping is over.
	text = text.replace(
		/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g,
		(match, dec, hex, name) => {
			if (dec) return String.fromCodePoint(Number(dec));
			if (hex) return String.fromCodePoint(parseInt(hex, 16));
			return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name] ?? match;
		}
	);
	return (
		text
			// What is left is prose for CREDITS.md, a licence and an author's
			// name, and prose there has no use for a bracket that a reader or a
			// renderer might take for markup.
			.replace(/[<>]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
};

async function credit(file) {
	const api =
		`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo` +
		`&iiprop=extmetadata&titles=${encodeURIComponent(`File:${file}`)}`;
	try {
		const res = await polite(api);
		const body = await res.json();
		const pages = body?.query?.pages ?? {};
		const meta = Object.values(pages)[0]?.imageinfo?.[0]?.extmetadata ?? {};
		return {
			file,
			licence: strip(meta.LicenseShortName?.value) || 'not stated',
			author: strip(meta.Artist?.value) || 'not stated',
			page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
		};
	} catch {
		return { file, licence: 'not read', author: 'not read', page: '' };
	}
}

function haveCwebp() {
	try {
		execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const listOnly = process.argv.includes('--list');
const keys = asked.length > 0 ? asked : Object.keys(SOURCES);

if (listOnly) {
	for (const key of keys) console.log(`${key.padEnd(18)} ${SOURCES[key] ?? '(no source)'}`);
	process.exit(0);
}

if (!haveCwebp()) {
	console.error('cwebp is required (brew install webp / apt install webp).');
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`Fetching ${keys.length} logo(s) into ${OUT_DIR}\n`);
console.log('These are other companies’ trademarks. See the header of this');
console.log('script and assets/bank-logos/CREDITS.md before redistributing them.\n');

let written = 0;
let skipped = 0;
const credits = [];
for (const key of keys) {
	const article = SOURCES[key];
	if (!article) {
		console.log(`${key.padEnd(18)} skipped — no source article`);
		skipped++;
		continue;
	}
	const temp = join(OUT_DIR, `${key}.source`);
	try {
		const file = await logoFile(await itemFor(article));
		if (!file) {
			// Not a failure: Wikidata simply does not state a logo for them. The
			// bank keeps its emoji, which is a correct answer rather than a wrong
			// picture.
			console.log(`${key.padEnd(18)} skipped — ${article} states no logo (P154)`);
			skipped++;
			continue;
		}
		writeFileSync(temp, await bytesOf(file, 256));
		// -resize 128 0 keeps the aspect ratio; a mark squared off is a different mark.
		execFileSync('cwebp', [
			'-quiet',
			'-q',
			'90',
			'-resize',
			'128',
			'0',
			temp,
			'-o',
			join(OUT_DIR, `${key}.webp`)
		]);
		const record = await credit(file);
		credits.push({ key, ...record });
		console.log(`${key.padEnd(18)} ok — ${file} — ${record.licence}`);
		written++;
	} catch (err) {
		console.log(`${key.padEnd(18)} failed — ${err.message}`);
	} finally {
		rmSync(temp, { force: true });
	}
}

console.log(`\n${written} written, ${skipped} skipped.`);

// The terms, written beside the files they describe. Merged rather than
// replaced, so fetching two banks does not throw away the record of the
// other twenty-seven.
if (credits.length > 0) {
	const path = join(OUT_DIR, 'CREDITS.md');
	const kept = new Map();
	if (existsSync(path)) {
		for (const line of readFileSync(path, 'utf8').split('\n')) {
			// Tolerant of padding: prettier pads these columns to align them, so a
			// pattern expecting single spaces read none of the existing rows back
			// and quietly rewrote the file with only the keys just fetched.
			const row = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|/);
			if (row) kept.set(row[1], line);
		}
	}
	for (const c of credits) {
		kept.set(c.key, `| \`${c.key}\` | [${c.file}](${c.page}) | ${c.licence} | ${c.author} |`);
	}
	writeFileSync(
		path,
		[
			'# Bank logo credits',
			'',
			'Written by `scripts/fetch-bank-logos.mjs`. Every file in this folder, where',
			'it came from, and the terms Wikimedia Commons states for it.',
			'',
			'These are trademarks of the organisations named. They are included to',
			'identify the bank an account is held with — see `NOTICE.md` at the root.',
			'',
			'| Key | Source file | Licence | Author |',
			'| --- | --- | --- | --- |',
			...[...kept.keys()].sort().map((k) => kept.get(k)),
			''
		].join('\n')
	);
	// Formatted by the repository's own prettier, because this file is COMMITTED
	// and `npm run lint` checks it: a generator whose output its own repo rejects
	// makes every run a dirty tree that has to be tidied by hand.
	try {
		execFileSync('npx', ['prettier', '--write', path], { stdio: 'ignore' });
	} catch {
		console.log('prettier could not format CREDITS.md — run it by hand.');
	}
	console.log(`CREDITS.md updated (${kept.size} entries).`);
}
