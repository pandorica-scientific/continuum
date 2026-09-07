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
		expect(dropzone).toMatch(/offersScan && picked\.length === 1 && isImageFile\(picked\[0\]\)/);
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

	it('names the wait, because decoding a 48 MP HEIC took 3.6 seconds', () => {
		expect(flow).toContain('Reading photo…');
	});

	it('reads a dropped file the thorough way, with the gates off', () => {
		// There is no retake: the file is whatever the gallery held, so refusing
		// it for being blurry tells the user no and offers nothing. detectBest
		// runs gateless by construction and reads the picture twice.
		expect(flow).toMatch(/detectBest\(cv, measured\)/);
	});

	it('measures the page at a known width, never at the photograph’s own', () => {
		// Every kernel inside detectOnce is an absolute number of pixels and is
		// sized for a frame about DETECT_WIDTH across — its own doc comment says
		// so. Handed a full 2400-wide capture, the 9 px close cannot seal the
		// holes text punches in the page mask, the contour breaks up, and
		// nothing is found: the photograph came back slowly AND uncropped.
		expect(flow).toMatch(/frameFromBitmapSource\(frame, REFINE_WIDTH\)/);
		// And the corners found on the measured frame must be carried back onto
		// the frame that actually gets warped.
		expect(flow).toMatch(/scaleCorners\(found, frame\.width \/ measured\.width\)/);
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
		// The kept frame is encoded here and again inside the PDF. At the 0.85
		// default twice over, a photograph of a laminated card came back blocked.
		expect(flow).toMatch(/const KEEP_QUALITY = 0\.9[5-9];/);
		expect(flow).toMatch(/encodeJpeg: \(frame\) => encodeJpeg\(frame, KEEP_QUALITY\)/);
	});

	it('survives a photo it cannot read', () => {
		expect(flow).toMatch(/could not be read/);
	});
});
