import type { PdfLine } from './types';

/**
 * Extract a line model from a text-layer PDF: text items grouped into lines by
 * vertical position, cells ordered left to right. Both PDF adapters parse this
 * model, which also keeps their unit tests free of binary fixtures.
 */
export async function extractPdfLines(data: Uint8Array): Promise<PdfLine[]> {
	const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await getDocument({ data, useSystemFonts: true }).promise;
	const lines: PdfLine[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const content = await page.getTextContent();
		const byY = new Map<number, { x: number; str: string }[]>();
		for (const item of content.items) {
			if (!('str' in item) || !item.str.trim()) continue;
			const y = Math.round(item.transform[5] / 2) * 2;
			if (!byY.has(y)) byY.set(y, []);
			byY.get(y)!.push({ x: item.transform[4], str: item.str });
		}
		for (const [y, items] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
			lines.push({
				page: p,
				y,
				cells: items
					.sort((a, b) => a.x - b.x)
					.map((i) => i.str.trim())
					.filter(Boolean)
			});
		}
	}
	await doc.cleanup?.();
	return lines;
}
