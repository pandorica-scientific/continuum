import iconv from 'iconv-lite';
import { parseFio } from './adapters/fio';
import { parseRevolut } from './adapters/revolut';
import { parseMbank } from './adapters/mbank';
import { parseRbLines } from './adapters/rb';
import { parseCsLines } from './adapters/cs';
import { extractPdfLines } from './pdftext';
import type { ParsedStatement } from './types';

/**
 * Sniff the bank and format from the file body and parse it. Throws a
 * user-facing Error when nothing matches.
 */
export async function detectAndParse(buffer: Uint8Array): Promise<ParsedStatement> {
	// PDF?
	if (buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44) {
		const lines = await extractPdfLines(buffer);
		const text = lines.map((l) => l.cells.join(' ')).join('\n');
		if (text.includes('Raiffeisenbank')) return parseRbLines(lines);
		if (text.includes('Česká spořitelna') || text.includes('GIBACZPX')) return parseCsLines(lines);
		throw new Error('PDF statement from an unrecognised bank.');
	}

	// XLSX (zip container) — the XTB investment report, which is Phase 2.
	if (buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
		throw new Error('This looks like an XLSX broker report — investment import lands in Phase 2.');
	}

	const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
	const head = utf8.slice(0, 2000);

	if (head.includes('Výpis č.') && head.includes('z účtu')) return parseFio(utf8);
	if (head.startsWith('Type,Product,Started Date') || head.includes('Type,Product,Started Date')) {
		return parseRevolut(utf8);
	}
	// mBank ships windows-1250; its signature survives any decoding.
	if (head.includes('mBank') || head.includes('#Numer rachunku')) {
		return parseMbank(iconv.decode(Buffer.from(buffer), 'win1250'));
	}

	throw new Error('Unrecognised statement format.');
}
