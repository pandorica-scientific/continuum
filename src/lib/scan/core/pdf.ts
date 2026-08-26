// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// pdf-lib, one page per scan page, image drawn edge to edge.
//
// Output is a plain PDF, not PDF/A: conformance needs XMP metadata, an
// OutputIntent and an embedded ICC profile. That was free while OCRmyPDF was in
// the stack and is real work without it, and nothing in a household ledger
// requires archival conformance.

import {
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
	concatTransformationMatrix,
	drawObject,
	popGraphicsState,
	pushGraphicsState
} from 'pdf-lib';
import { deflate, isBilevel, packBilevel } from './bilevel.ts';
import type { Frame, PageMode } from './types.ts';

export type RenderedPage = { frame: Frame; mode: PageMode };

/** 300 DPI expressed in PDF points: 72 points per inch, 300 pixels per inch. */
const POINTS_PER_PIXEL = 72 / 300;

export async function assemblePdf(
	pages: RenderedPage[],
	options: { title: string; encodeJpeg: (frame: Frame) => Promise<Uint8Array> }
): Promise<Uint8Array> {
	if (pages.length === 0) throw new Error('A PDF needs at least one page.');

	const doc = await PDFDocument.create();
	doc.setTitle(options.title);
	doc.setCreator('Continuum');
	doc.setProducer('Continuum scan engine');

	for (const { frame, mode } of pages) {
		// The draw box is what decides whether this looks like a scan or a photo
		// pasted onto A4: 2480px across 210mm IS 300 DPI, and nothing downstream
		// reads a DPI tag. Sizing the page from the image also means a landscape
		// page gets a landscape box rather than being rotated into a portrait one.
		const width = frame.width * POINTS_PER_PIXEL;
		const height = frame.height * POINTS_PER_PIXEL;
		const page = doc.addPage([width, height]);

		if (mode === 'bw' && isBilevel(frame)) {
			// Drawn through the operator API rather than `drawImage`, which type-
			// checks its argument against pdf-lib's own PDFImage class — there is
			// no public way to construct one around a stream we built ourselves.
			// The operators below are exactly what drawImage emits.
			const name = page.node.newXObject('Img', await embedBilevel(doc, frame));
			page.pushOperators(
				pushGraphicsState(),
				concatTransformationMatrix(width, 0, 0, height, 0, 0),
				drawObject(name),
				popGraphicsState()
			);
		} else {
			const image = await doc.embedJpg(await options.encodeJpeg(frame));
			page.drawImage(image, { x: 0, y: 0, width, height });
		}
	}

	return doc.save();
}

/**
 * A 1-bit DeviceGray image XObject, built through pdf-lib's low-level API, and
 * returned as a reference for the caller to place.
 *
 * `embedPng` would decode the PNG and re-embed it as RGB — three bytes a pixel
 * where this uses one bit. Going through the raw stream is what makes the size
 * claim true rather than aspirational.
 */
async function embedBilevel(doc: PDFDocument, frame: Frame) {
	const compressed = await deflate(packBilevel(frame));
	const stream = PDFRawStream.of(
		doc.context.obj({
			Type: 'XObject',
			Subtype: 'Image',
			Width: PDFNumber.of(frame.width),
			Height: PDFNumber.of(frame.height),
			ColorSpace: PDFName.of('DeviceGray'),
			BitsPerComponent: PDFNumber.of(1),
			Filter: PDFName.of('FlateDecode')
		}),
		compressed
	);
	return doc.context.register(stream);
}
