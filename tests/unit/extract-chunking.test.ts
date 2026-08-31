// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isExtractable, slicePlainText } from '$lib/server/documents/extract';
import { MAX_CHUNK_BYTES } from '$lib/server/documents/extract/limits';

/**
 * The tsvector wall applies to a big CSV exactly as it does to a scan.
 *
 * PostgreSQL refuses a `tsvector` over about 1 MB, and the index is built on a
 * chunk — so plain text is cut under the same cap as OCR output rather than
 * being written as one column nobody can index.
 */
describe('slicing plain text', () => {
	it('keeps every slice under the chunk cap', () => {
		const chunks = slicePlainText('x'.repeat(250_000));
		expect(chunks).toHaveLength(3);
		expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
		expect(chunks.join('')).toHaveLength(250_000);
	});

	it('prefers to cut at a line break, so a row is rarely split', () => {
		const line = 'a'.repeat(999) + '\n';
		const chunks = slicePlainText(line.repeat(300), 100_000);
		expect(chunks[0].endsWith('\n')).toBe(true);
		expect(chunks.join('')).toBe(line.repeat(300));
	});

	it('leaves short text as one chunk', () => {
		expect(slicePlainText('a receipt')).toEqual(['a receipt']);
		expect(slicePlainText('')).toEqual([]);
	});
});

describe('what can be read at all', () => {
	it('reads documents, and says nothing about the rest', () => {
		// The absence of a `document_text` row IS the "N documents don't have
		// searchable contents" count, so this list decides what that number means.
		for (const ext of ['pdf', 'PDF', '.pdf', 'jpg', 'png', 'webp', 'heic', 'txt', 'csv', 'md']) {
			expect(isExtractable(ext), ext).toBe(true);
		}
		for (const ext of ['xlsx', 'ofx', 'abo', 'zip', 'docx', '']) {
			expect(isExtractable(ext), ext).toBe(false);
		}
	});
});
