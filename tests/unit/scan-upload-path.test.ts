// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isImageFile } from '$lib/scan/core/accept';

// A dropped image and a photographed page must produce the same artifact —
// this is the path for pictures the user already has, not documents to scan.
const dropzone = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');

describe('isImageFile', () => {
	it('recognises an ordinary photo by its type', () => {
		expect(isImageFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(true);
	});

	it('recognises a HEIC that arrived with no type at all', () => {
		// Safari and several Android pickers hand over HEIC with an empty or
		// wrong MIME type, so isImageFile sniffs magic bytes.
		expect(isImageFile({ name: 'IMG_7538.HEIC', type: '' })).toBe(true);
		expect(isImageFile({ name: 'IMG_7538.heic', type: 'application/octet-stream' })).toBe(true);
	});

	it('does not claim a PDF', () => {
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

	// A dropzone admitting only images has no PDF in `accept`, so it would
	// otherwise never offer a crop at all.
	it('offers the crop for a picture as well as for a document', () => {
		expect(dropzone).toMatch(/offersScan \|\| \(crop && admitsImages\(accept\)\)/);
		expect(dropzone).toMatch(/finish=\{crop \? 'picture' : 'document'\}/);
	});

	it('leaves a multiple drop alone until the review screen exists', () => {
		// Several dropped images become ONE PDF, which needs a screen to order
		// them on; half-doing it would file several documents instead of one.
		expect(dropzone).toMatch(/picked\.length === 1/);
	});
});

describe('the flow', () => {
	it('starts on the reading screen, not the viewfinder', () => {
		// Mounting the viewfinder for a photograph already in hand would needlessly
		// ask for camera permission.
		expect(flow).toMatch(/incoming\.length \? 'reading' : 'capture'/);
	});

	it('names the wait, which is now the upload rather than a decode', () => {
		expect(flow).toContain('Reading photo…');
		expect(flow).toContain('Sending the photo…');
	});

	it('reads a dropped file the thorough way, with the gates off', () => {
		// There is no retake for a dropped file, so refusing it for being blurry
		// would offer nothing; `detectBest` runs gateless. Detection is now
		// server-side, so this asserts against the pipeline, not the flow.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/detectBest\(cv, measured\)/);
	});

	it('measures the page at a known width, never at the photograph’s own', () => {
		// detectOnce's kernels are pixel-absolute, sized for a frame about
		// DETECT_WIDTH across; a full-resolution capture breaks contour detection.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/downscaleFrame\(source, REFINE_WIDTH\)/);
		// Corners found on the measured frame must be scaled back onto the frame
		// that gets warped, by the ratio between the two; lines scale the same way.
		expect(pipeline).toMatch(/const factor = source\.width \/ measured\.width;/);
		expect(pipeline).toMatch(/scaleOutline\(found, factor\)/);
		expect(pipeline).toMatch(/scaleLine\(line, factor\)/);
		// Corners and curve were measured in the same downscaled frame and must
		// scale together, or the outline stops matching the page.
		expect(pipeline).toMatch(/corners: state\.corners, edges: state\.edges/);
		// The full frame must not reach the detector.
		expect(flow).not.toMatch(/detectBest\(cv, frame\)/);
	});

	it('does not take the kept pages when one photograph is retaken', () => {
		// Regression: "Choose another file" used to unmount ScanFlow, discarding
		// every already-scanned page with no warning.
		expect(flow).toMatch(/if \(session\.pages\.length > 0\) \{/);
		// Retake in place, and leave somewhere to land if the camera is dismissed.
		expect(flow).toMatch(/screen = 'review';\s*\n\s*nextPage\(\);/);
	});

	it('does not compound JPEG loss on the page it keeps', () => {
		// Regression: the kept page was JPEG-encoded twice (once on keep, once in
		// the PDF), visibly blocking scans of laminated cards. Now encoded once.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/await write\(request\.outPath, page, request\.mode, 95\)/);

		const document = readFileSync('src/routes/scan/document/+server.ts', 'utf8');
		expect(document).toMatch(/jpeg: new Uint8Array\(await readFile\(colour\)\)/);
	});

	it('survives a photo it cannot read', () => {
		expect(flow).toMatch(/could not be read/);
	});
});
