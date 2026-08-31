// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The Identity wallet's card faces, composited from one generated background
// per country and document kind.
//
// WHAT THIS DELIBERATELY DOES NOT DRAW: the country flag, the country code and
// the document kind. Those are drawn live by `WalletView.svelte` from the
// record, and a mark baked in here would state the artwork's own key rather
// than the document's — a residence permit falling back to a country's generic
// art would read "IDENTITY DOCUMENT" in paint, with the truth beside it in
// pixels. The art is ground; every word on a card comes from the database.
//
// Run by hand when the set changes: `node src/lib/assets/doc-placeholders/render.mjs`.
// Needs `rsvg-convert` and `cwebp` on PATH (Homebrew: librsvg, webp). Neither is
// a project dependency — nothing at build time or at run time reads this file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Inputs, script and output all live in this directory, so the set can be
// rebuilt from a checkout without knowing where it was run from.
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const bgDir = path.join(here, 'backgrounds');
const outDir = path.join(here, 'cards');
fs.mkdirSync(outDir, { recursive: true });

/**
 * Quality, not size, is the setting that matters here.
 *
 * These were encoded at 640 px at first, reasoning that a card is at most 292
 * CSS px wide. That reasoning forgot the phone: at a device pixel ratio of 3 the
 * same card is 876 device pixels, so every face was being upscaled, and it
 * showed — softest exactly where the wallet is most used.
 *
 * So a card is encoded at its own size now, with no resize at all. PNG was the
 * other candidate and is the wrong tool: the art is a photograph over a
 * gradient, which is what PNG compresses worst — 785 kB against 37 kB for the
 * same pixels and no visible difference. WebP at 92 keeps the gradients clean
 * (80 bands them, and these images are almost all gradient) at about 80 kB a
 * card. The whole set is ~9 MB and a household fetches only the faces it owns.
 */
const QUALITY = 92;

/** SVG in, WebP out. rsvg-convert has no WebP encoder, so cwebp finishes it. */
function encode(svg, file) {
	const png = execFileSync('rsvg-convert', ['-w', String(W), '-h', String(H)], {
		input: svg,
		maxBuffer: 64 * 1024 * 1024
	});
	execFileSync(
		'cwebp',
		['-quiet', '-q', String(QUALITY), '-o', path.join(outDir, file), '--', '-'],
		{
			input: png,
			maxBuffer: 64 * 1024 * 1024
		}
	);
}

const { width: W, height: H } = manifest.canvas;

function renderCard(country, doc) {
	const file = `${country.code.toLowerCase()}-${doc.key}.webp`;
	const bgPath = path.join(bgDir, `${country.code.toLowerCase()}-${doc.key}.png`);
	if (!fs.existsSync(bgPath)) return false;
	// Only the base fill. The other two fed a palette wash laid over the whole
	// card, which tinted art that already carries its own colour per document
	// kind — a second tint over the first is what greyed the ibex out.
	const [c1] = country[doc.paletteKey];
	const backgroundData = fs.readFileSync(bgPath).toString('base64');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="cardClip"><rect width="${W}" height="${H}" rx="88"/></clipPath>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="0.72" stop-color="#000000" stop-opacity="0.04"/><stop offset="1" stop-color="#000000" stop-opacity="0.16"/></linearGradient>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="${W}" height="${H}" fill="${c1}"/>
    <image href="data:image/png;base64,${backgroundData}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${W}" height="${H}" fill="url(#shade)"/>
    ${doc.key === 'driving-licence' ? `<g fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="3"><path d="M-100 780 C310 580 510 930 900 735 S1450 620 1820 780"/><path d="M-80 850 C300 660 550 1000 940 800 S1460 700 1810 850"/><path d="M-50 920 C370 740 610 1040 990 875 S1470 790 1800 930"/></g>` : ''}
    ${doc.key === 'passport' ? `<rect x="45" y="45" width="${W - 90}" height="${H - 90}" rx="58" fill="none" stroke="#EFD58B" stroke-opacity="0.22" stroke-width="3"/>` : ''}
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="86" fill="none" stroke="#FFFFFF" stroke-opacity="0.30" stroke-width="3"/>
  </g>
  </svg>`;
	encode(svg, file);
	return true;
}

function renderGenericDocument() {
	const file = 'generic-document.webp';
	const bgPath = path.join(bgDir, 'generic-document.png');
	if (!fs.existsSync(bgPath)) return false;
	const backgroundData = fs.readFileSync(bgPath).toString('base64');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="cardClip"><rect width="${W}" height="${H}" rx="88"/></clipPath>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="0.72" stop-color="#000000" stop-opacity="0.04"/><stop offset="1" stop-color="#000000" stop-opacity="0.16"/></linearGradient>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="${W}" height="${H}" fill="#102B46"/>
    <image href="data:image/png;base64,${backgroundData}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${W}" height="${H}" fill="url(#shade)"/>
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="86" fill="none" stroke="#FFFFFF" stroke-opacity="0.30" stroke-width="3"/>
  </g>
  </svg>`;
	encode(svg, file);
	return true;
}

let rendered = 0;
let missing = 0;
for (const country of manifest.countries) {
	for (const doc of manifest.documents) {
		if (renderCard(country, doc)) rendered++;
		else missing++;
	}
}
if (renderGenericDocument()) rendered++;
else missing++;
console.log(JSON.stringify({ rendered, missing, output: outDir }));
