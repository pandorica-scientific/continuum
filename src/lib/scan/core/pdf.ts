// SPDX-License-Identifier: AGPL-3.0-or-later
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

/**
 * A page ready to be written, either as pixels or as bytes already encoded.
 *
 * The `jpeg` shape exists because the server renders and encodes ONCE, before
 * assembly ever runs. Handing pdf-lib a `Frame` there would decode the stored
 * artefact and re-encode it — two lossy passes over the same page, which is
 * precisely the compounding v0.8.5 had to raise both qualities to survive.
 *
 * Black-and-white keeps the `frame` shape and must: it is not a JPEG at all by
 * the time it reaches the document, it is a 1-bit DeviceGray stream, and
 * `packBilevel` needs the pixels to build one.
 */
export type RenderedPage = { frame: Frame; mode: PageMode } | { jpeg: Uint8Array; mode: PageMode };

/**
 * A page fetched only when it is about to be written.
 *
 * Twenty A4 pages held as frames at once is about 700 MB, which no phone
 * survives — and twenty pages is the documented cap, so it is a case that will
 * happen rather than a theoretical one. Taking providers instead means each
 * page is decoded, embedded, and dropped before the next is touched, so peak
 * memory is one page however long the document is.
 */
export type PageProvider = () => Promise<RenderedPage>;

/**
 * A4 in PDF points — 210 × 297 mm at 72 points per inch.
 *
 * Every page is laid out at this size, oriented to match the image. Deriving
 * the page size from the pixel count instead — as this did at first — makes the
 * PHYSICAL page shrink when the capture resolution does: a 1240 px scan came
 * out as a 105 × 148 mm sheet, an A6 card, which prints and reads as wrong even
 * though the pixels are all present. Resolution should decide quality, not
 * paper size.
 */
const A4_WIDTH = 595.276;
const A4_HEIGHT = 841.89;

export async function assemblePdf(
	pages: readonly PageProvider[],
	options: { title: string; encodeJpeg: (frame: Frame) => Promise<Uint8Array> }
): Promise<Uint8Array<ArrayBuffer>> {
	if (pages.length === 0) throw new Error('A PDF needs at least one page.');

	const doc = await PDFDocument.create();
	doc.setTitle(options.title);
	doc.setCreator('Continuum');
	doc.setProducer('Continuum scan engine');

	for (const load of pages) {
		const loaded = await load();

		if ('jpeg' in loaded) {
			// Embedded as it arrived. The orientation decision has to come off the
			// EMBEDDED image rather than a frame, because there is no frame here —
			// that is the whole point of this shape.
			const image = await doc.embedJpg(loaded.jpeg);
			const upright = image.height >= image.width;
			const sheetWidth = upright ? A4_WIDTH : A4_HEIGHT;
			const sheetHeight = upright ? A4_HEIGHT : A4_WIDTH;
			const sheet = doc.addPage([sheetWidth, sheetHeight]);
			const fit = Math.min(sheetWidth / image.width, sheetHeight / image.height);
			const drawnWidth = image.width * fit;
			const drawnHeight = image.height * fit;
			sheet.drawImage(image, {
				x: (sheetWidth - drawnWidth) / 2,
				y: (sheetHeight - drawnHeight) / 2,
				width: drawnWidth,
				height: drawnHeight
			});
			continue;
		}

		const { frame, mode } = loaded;
		// A4, turned to match the image so a landscape page gets a landscape
		// sheet rather than being rotated into a portrait one.
		const portrait = frame.height >= frame.width;
		const pageWidth = portrait ? A4_WIDTH : A4_HEIGHT;
		const pageHeight = portrait ? A4_HEIGHT : A4_WIDTH;
		const page = doc.addPage([pageWidth, pageHeight]);

		// Fitted whole, centred. A scan that has been cropped to the page should
		// fill the sheet; cropping it again to fill would cut off the edges the
		// rectification just worked to find.
		const scale = Math.min(pageWidth / frame.width, pageHeight / frame.height);
		const width = frame.width * scale;
		const height = frame.height * scale;
		const x = (pageWidth - width) / 2;
		const y = (pageHeight - height) / 2;

		if (mode === 'bw' && isBilevel(frame)) {
			// Drawn through the operator API rather than `drawImage`, which type-
			// checks its argument against pdf-lib's own PDFImage class — there is
			// no public way to construct one around a stream we built ourselves.
			// The operators below are exactly what drawImage emits.
			const name = page.node.newXObject('Img', await embedBilevel(doc, frame));
			page.pushOperators(
				pushGraphicsState(),
				concatTransformationMatrix(width, 0, 0, height, x, y),
				drawObject(name),
				popGraphicsState()
			);
		} else {
			const image = await doc.embedJpg(await options.encodeJpeg(frame));
			page.drawImage(image, { x, y, width, height });
		}
	}

	// Pinned to ArrayBuffer rather than ArrayBufferLike so the result can go
	// straight into a File without a cast at every call site.
	return new Uint8Array(await doc.save());
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
