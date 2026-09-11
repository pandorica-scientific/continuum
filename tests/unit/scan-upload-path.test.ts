// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isImageFile } from '$lib/scan/core/accept';

/**
 * "A dropped image and a photographed page produce the same artifact."
 *
 * Without this the two paths diverge completely: photographing a page gives a
 * cropped, flattened A4 PDF of about 50 KB, while dropping a photo of the SAME
 * page files a 1.8 MB crooked snapshot of a desk. It is the path for pictures
 * someone already has — a bill sent to them, something shot earlier — which
 * would otherwise never be scanned at all.
 */
const dropzone = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');

describe('isImageFile', () => {
	it('recognises an ordinary photo by its type', () => {
		expect(isImageFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(true);
	});

	it('recognises a HEIC that arrived with no type at all', () => {
		// Safari and several Android pickers hand over HEIC with an empty or
		// wrong MIME type — the same reason the decoder sniffs magic bytes.
		expect(isImageFile({ name: 'IMG_7538.HEIC', type: '' })).toBe(true);
		expect(isImageFile({ name: 'IMG_7538.heic', type: 'application/octet-stream' })).toBe(true);
	});

	it('does not claim a PDF', () => {
		// PDFs pass through untouched; only images enter the pipeline.
		expect(isImageFile({ name: 'statement.pdf', type: 'application/pdf' })).toBe(false);
	});

	it('does not claim a spreadsheet or a backup', () => {
		expect(isImageFile({ name: 'report.xlsx', type: '' })).toBe(false);
		expect(isImageFile({ name: 'ledger.config.json', type: 'application/json' })).toBe(false);
	});
});

describe('the dropzone', () => {
	it('sends a dropped photograph into the pipeline', () => {
		expect(dropzone).toMatch(/offersCrop && picked\.length === 1 && isImageFile\(picked\[0\]\)/);
	});

	// The corner editor is wanted by two different jobs: a document, which ends
	// as a PDF, and a picture — a wine label — which must not be thresholded and
	// comes back as an image. A dropzone that admits only images has no PDF in
	// its `accept` and would otherwise be offered no crop at all.
	it('offers the crop for a picture as well as for a document', () => {
		expect(dropzone).toMatch(/offersScan \|\| \(crop && admitsImages\(accept\)\)/);
		expect(dropzone).toMatch(/finish=\{crop \? 'picture' : 'document'\}/);
	});

	it('leaves a multiple drop alone until the review screen exists', () => {
		// The spec has several dropped images becoming ONE PDF, which needs a
		// screen to order them on. Half-doing it would file several documents
		// where the user asked for one.
		expect(dropzone).toMatch(/picked\.length === 1/);
	});
});

describe('the flow', () => {
	it('starts on the reading screen, not the viewfinder', () => {
		// Mounting the viewfinder even for a frame asks for camera permission —
		// for a photograph already in hand.
		expect(flow).toMatch(/incoming\.length \? 'reading' : 'capture'/);
	});

	it('names the wait, which is now the upload rather than a decode', () => {
		// It used to be 3.6 seconds of decoding a 48 MP HEIC in the tab. It is now
		// the photograph going up and the crop coming back, which is shorter on a
		// LAN and honest either way.
		expect(flow).toContain('Reading photo…');
		expect(flow).toContain('Sending the photo…');
	});

	it('reads a dropped file the thorough way, with the gates off', () => {
		// There is no retake: the file is whatever the gallery held, so refusing
		// it for being blurry tells the user no and offers nothing. `detectBest`
		// runs gateless by construction and reads the picture both ways round.
		// It runs on the server now, so this reads the pipeline rather than the
		// flow — the decision is unchanged, only its address is.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/detectBest\(cv, measured\)/);
	});

	it('measures the page at a known width, never at the photograph’s own', () => {
		// Every kernel inside detectOnce is an absolute number of pixels and is
		// sized for a frame about DETECT_WIDTH across — its own doc comment says
		// so. Handed a full 2400-wide capture, the 9 px close cannot seal the
		// holes text punches in the page mask, the contour breaks up, and
		// nothing is found: the photograph came back slowly AND uncropped.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/downscaleFrame\(source, REFINE_WIDTH\)/);
		// And the corners found on the measured frame must be carried back onto
		// the frame that actually gets warped — by the ratio between the two, and
		// by nothing else. The detected LINES scale by the same factor, which is
		// why it is named rather than written out twice.
		expect(pipeline).toMatch(/const factor = source\.width \/ measured\.width;/);
		expect(pipeline).toMatch(/scaleOutline\(found, factor\)/);
		expect(pipeline).toMatch(/scaleLine\(line, factor\)/);
		// Corners AND curve scale together. Both were measured in the same
		// downscaled frame, so scaling one alone would leave a bow describing an
		// edge 1280 px wide on a page four thousand across.
		expect(pipeline).toMatch(/corners: state\.corners, edges: state\.edges/);
		// The full frame must not reach the detector.
		expect(flow).not.toMatch(/detectBest\(cv, frame\)/);
	});

	it('does not take the kept pages when one photograph is retaken', () => {
		// "Choose another file" handed control back to the call site, which
		// unmounts ScanFlow — and the session, holding every page scanned so far,
		// went with it. Someone eight pages into a contract who disliked the
		// ninth lost all nine, with no warning and no undo.
		expect(flow).toMatch(/if \(session\.pages\.length > 0\) \{/);
		// Retake in place, and leave somewhere to land if the camera is dismissed.
		expect(flow).toMatch(/screen = 'review';\s*\n\s*nextPage\(\);/);
	});

	it('does not compound JPEG loss on the page it keeps', () => {
		// v0.8.5 had to RAISE both qualities because the kept page was encoded
		// twice — once when kept and again inside the PDF — and at the 0.85
		// default twice over, a photograph of a laminated card came back visibly
		// blocked. v0.8.6 removes the second pass instead: the artefact written
		// when the page is kept is the artefact the document embeds, so there is
		// one encode for the whole journey.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/await write\(request\.outPath, page, request\.mode, 95\)/);

		const document = readFileSync('src/routes/scan/document/+server.ts', 'utf8');
		expect(document).toMatch(/jpeg: new Uint8Array\(await readFile\(colour\)\)/);
	});

	it('survives a photo it cannot read', () => {
		expect(flow).toMatch(/could not be read/);
	});
});
