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
		// Sniff the issuer from the statement's own header, not from anywhere in
		// the document. Both banks print their name deep in the body — in the
		// real samples "Raiffeisenbank" first appears on line 57 and "Česká
		// spořitelna" on line 54 — so an anywhere-substring test also fires on a
		// counterparty's bank mentioned in someone else's statement. That routed
		// the file to the wrong parser, which read zero rows, minted an account
		// for a bank the user does not have, and recorded the content hash, so
		// the correct re-import was then refused as a duplicate.
		//
		// The title line and the account's BIC both sit in the first dozen lines
		// and belong to the issuer: RZBCCZPP is Raiffeisenbank, GIBACZPX is
		// Česká spořitelna. "Výpis z účtu" is not a substring of "Výpis z
		// běžného účtu", so the two titles cannot cross-match.
		const head = lines
			.slice(0, 24)
			.map((l) => l.cells.join(' '))
			.join('\n');
		if (/RZBCCZPP|Výpis z běžného účtu/.test(head)) return parseRbLines(lines);
		if (/GIBACZPX|Výpis z účtu/.test(head)) return parseCsLines(lines);

		// Header unrecognised — a template may have moved. Fall back to the bank
		// name anywhere in the file, but only when exactly one bank is named:
		// an ambiguous document is a misroute waiting to happen, and a clear
		// error beats a silent zero-row parse under the wrong bank.
		const namesRb = text.includes('Raiffeisenbank');
		const namesCs = text.includes('Česká spořitelna');
		if (namesRb && !namesCs) return parseRbLines(lines);
		if (namesCs && !namesRb) return parseCsLines(lines);
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
