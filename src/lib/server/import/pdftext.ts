import type { PdfLine } from './types';

/**
 * Extract a line model from a text-layer PDF: text items grouped into lines by
 * vertical position, cells ordered left to right. Both PDF adapters parse this
 * model, which also keeps their unit tests free of binary fixtures.
 */
export async function extractPdfLines(data: Uint8Array): Promise<PdfLine[]> {
	const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	// pdf.js TAKES OWNERSHIP of the array it is handed and detaches it, leaving
	// the caller holding a zero-length view. That is invisible until something
	// reads the buffer afterwards — and two things do: the original file is
	// written to disk AFTER parsing, so every stored PDF was a 0-byte file, and
	// OCR arbitration needs the same bytes a second time. Hand pdf.js a copy.
	const doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
	const lines: PdfLine[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const content = await page.getTextContent();
		const byY = new Map<number, { x: number; end: number; str: string }[]>();
		for (const item of content.items) {
			if (!('str' in item) || !item.str.trim()) continue;
			const y = Math.round(item.transform[5] / 2) * 2;
			if (!byY.has(y)) byY.set(y, []);
			byY.get(y)!.push({
				x: item.transform[4],
				end: item.transform[4] + ('width' in item ? (item.width as number) : 0),
				str: item.str
			});
		}
		for (const [y, items] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
			const ordered = items.sort((a, b) => a.x - b.x).filter((i) => i.str.trim());
			lines.push({
				page: p,
				y,
				cells: ordered.map((i) => i.str.trim()),
				xs: ordered.map((i) => i.x),
				xEnds: ordered.map((i) => i.end)
			});
		}
	}
	await doc.cleanup?.();
	return lines;
}
