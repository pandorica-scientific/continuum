#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Turn a batch of engraving masters into the WebP this repository ships.
 *
 *   node scripts/convert-place-icons.mjs <masters-directory>
 *
 * Run by hand when a batch arrives, and its output is COMMITTED. That is the
 * one thing to understand about this file: unlike the map geometry and the OCR
 * models, the engravings are not fetched at build time, so nothing in CI and
 * nothing in the Docker build runs this. The build only ever copies what is
 * already in `assets/place-icons/`.
 *
 * ## Why the masters are not in the repository
 *
 * They are 1254px PNGs at about 2.85 MB each. All 3,437 of them is 9.8 GB,
 * which cannot live in git and cannot be re-encoded on every CI run — the
 * geodata build currently spends about two seconds. So conversion happens once,
 * here, and only the ~24 kB result is committed.
 *
 * ## Why 256 and quality 85
 *
 * A coin draws at 84 CSS pixels, which is 252 physical pixels on a 3x screen.
 * On hatched line art the first thing lost to upscaling is the hatching, which
 * is the entire subject of these images. Measured across the first 112: 24 kB
 * each at these settings, against 26 kB for re-encoding the supplied 256px PNGs
 * — no smaller, and softer, because those have already been downsampled once.
 *
 * 256 is the LONG side, not both. Most masters are not square — 1536×1024 is
 * the commonest — and forcing them to 256×256 stretches every building upward
 * by half. The coin draws its image `object-fit: contain`, so a 256×171 file
 * sits centred in the disc with the vignette's transparent edges round it.
 *
 * Delivery is partial and will be for a while. A place whose engraving has not
 * arrived simply has no coin.
 *
 * ## Why each file carries its own copyright
 *
 * `NOTICE.md` and `assets/place-icons/README.md` state the terms, and neither travels
 * with an image somebody has extracted from the repository or pulled out of the
 * container. An XMP block inside the file does. cwebp cannot write one — it only
 * COPIES metadata, and the masters have none — so webpmux adds it afterwards.
 */
import { execFileSync } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const OUT = 'assets/place-icons';

/** Whose work this is. Matches README.md and NOTICE.md; change all three. */
const HOLDER = 'Robert Kiewisz';
const YEAR = '2026';
const TERMS = 'AGPL-3.0-or-later';

/**
 * The rights statement embedded in every file.
 *
 * Dublin Core inside XMP, which is what image tools read and what a stock
 * library or a reverse-image search will surface. `xmpRights:Marked` true is the
 * machine-readable "this is not public domain".
 */
const xmp = (id) => `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright \u00a9 ${YEAR} ${HOLDER}</rdf:li></rdf:Alt></dc:rights>
   <dc:creator><rdf:Seq><rdf:li>${HOLDER}</rdf:li></rdf:Seq></dc:creator>
   <dc:identifier>${id}</dc:identifier>
   <dc:source>Continuum</dc:source>
   <xmpRights:Marked>True</xmpRights:Marked>
   <xmpRights:WebStatement>https://github.com/pandorica-scientific/continuum/blob/main/NOTICE.md</xmpRights:WebStatement>
   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${TERMS}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** The long side of every engraving. See "Why 256" above. */
const LONG_SIDE = 256;

/**
 * A PNG's width and height, from its header.
 *
 * The first chunk of every PNG is IHDR, and its width and height sit at fixed
 * offsets 16 and 20 as big-endian integers — no decoder needed for two numbers.
 */
function pngSize(path) {
	const head = Buffer.alloc(24);
	const handle = openSync(path, 'r');
	try {
		readSync(handle, head, 0, 24, 0);
	} finally {
		closeSync(handle);
	}
	return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const source = process.argv[2];
if (!source) {
	console.error('usage: node scripts/convert-place-icons.mjs <masters-directory>');
	process.exit(1);
}
if (!existsSync(source)) {
	console.error(`no such directory: ${source}`);
	process.exit(1);
}

for (const tool of ['cwebp', 'webpmux']) {
	try {
		execFileSync(tool, ['-version'], { stdio: 'ignore' });
	} catch {
		console.error(`${tool} is not installed — \`brew install webp\``);
		process.exit(1);
	}
}

mkdirSync(OUT, { recursive: true });

// The file name IS the place id, which is what the app looks an engraving up
// by. Anything else in the directory is not ours.
const masters = readdirSync(source).filter((name) => name.endsWith('.png'));
let written = 0;
let bytes = 0;

for (const name of masters) {
	const id = basename(name, '.png');
	const out = join(OUT, `${id}.webp`);
	// cwebp keeps the aspect ratio when one side is 0.
	const { width, height } = pngSize(join(source, name));
	const [w, h] = width >= height ? [LONG_SIDE, 0] : [0, LONG_SIDE];
	execFileSync('cwebp', [
		'-quiet',
		'-q',
		'85',
		'-alpha_q',
		'90',
		'-resize',
		String(w),
		String(h),
		'-m',
		'6',
		join(source, name),
		'-o',
		out
	]);

	// The rights statement, into the file itself. Written to a scratch file
	// because webpmux takes the payload by path, not on the command line.
	const packet = join(tmpdir(), `${id}.xmp`);
	writeFileSync(packet, xmp(id));
	execFileSync('webpmux', ['-set', 'xmp', packet, out, '-o', out]);
	rmSync(packet, { force: true });

	written += 1;
	bytes += statSync(out).size;
}

if (written === 0) {
	console.error(`no .png masters in ${source}`);
	process.exit(1);
}

console.log(
	`  ${written} engravings, ${(bytes / 1e6).toFixed(1)} MB, average ${(bytes / written / 1e3).toFixed(0)} kB`
);
console.log(`  each carries \u00a9 ${YEAR} ${HOLDER}, ${TERMS}, as XMP`);
console.log(`  commit ${OUT}/ — these are shipped, not fetched`);
