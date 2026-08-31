// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build the PDFs the extraction suites read.
 *
 *   node scripts/make-extract-fixtures.mjs
 *
 * Generated rather than committed as opaque binaries: a fixture nobody can
 * regenerate is a fixture nobody can change when the thing it tests changes.
 * The PDFs are written by hand — a few hundred bytes of PDF syntax — because
 * pulling in a PDF writer to make three test files would be a dependency the
 * product does not otherwise need.
 *
 * `mixed-contract.pdf` is the case per-page routing exists for: two typed pages
 * and one with no text layer at all, which is what a scanned signature page
 * looks like to a reader.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve('tests/fixtures/extract');

/** A page whose content stream draws words, so it HAS a text layer. */
const typed = (text) => `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;

/** A page that draws a filled rectangle and no glyphs at all. */
const untyped = () => '0.8 g 40 600 300 150 re f';

function buildPdf(pages) {
	const objects = [];
	const pageIds = pages.map((_, i) => 4 + i * 2);

	objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
	objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
	objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

	pages.forEach((content, i) => {
		const pageId = pageIds[i];
		objects[pageId] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
			`/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
		objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
	});

	let pdf = '%PDF-1.4\n';
	const offsets = [];
	for (let id = 1; id < objects.length; id++) {
		if (!objects[id]) continue;
		offsets[id] = pdf.length;
		pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
	}
	const startxref = pdf.length;
	const count = objects.length;
	pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
	for (let id = 1; id < count; id++) {
		pdf += offsets[id]
			? `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
			: '0000000000 65535 f \n';
	}
	pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

await mkdir(OUT, { recursive: true });

// Two typed pages and a scanned one — the mixed case, in one file.
await writeFile(
	resolve(OUT, 'mixed-contract.pdf'),
	buildPdf([
		typed('This tenancy agreement is made between the landlord and the tenant on this day.'),
		typed('The rent is payable monthly in advance and the deposit is held against damage.'),
		untyped()
	])
);

// Long enough to pass the automatic page limit twice, so the resumable slice
// has somewhere to resume to. Every page is untyped, so every page is OCR.
await writeFile(
	resolve(OUT, 'long-scan.pdf'),
	buildPdf(Array.from({ length: 250 }, () => untyped()))
);

// A file with a text layer throughout, for the case that needs no OCR at all.
await writeFile(
	resolve(OUT, 'typed-invoice.pdf'),
	buildPdf([typed('Invoice 10078410 for services rendered. Variable symbol 10078410.')])
);

console.log(`extraction fixtures written to ${OUT}`);
