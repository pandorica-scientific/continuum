/**
 * What kind of file is this, decided from its own bytes.
 *
 * The extension is not evidence. Banks serve CSV as `.txt`, MT940 as `.sta`,
 * CAMT as `.xml` or `.camt`, ABO as `.gpc`, and users rename things. Worse, a
 * mislabelled file that reaches the wrong parser does not fail loudly — it
 * reads zero rows and reports success, which is the exact failure this release
 * exists to make impossible.
 *
 * Routing by FORMAT first and bank second is also what makes the standards
 * parsers worth writing: one CAMT.053 reader serves every bank that exports
 * it, with no per-bank code at all.
 */

export type StatementFormat =
	| 'pdf'
	| 'xlsx'
	| 'ods'
	| 'xls'
	| 'camt053'
	| 'xml'
	| 'ofx'
	| 'qif'
	| 'mt940'
	| 'abo'
	| 'delimited'
	| 'image'
	| 'unknown';

interface FormatSniff {
	format: StatementFormat;
	/** Why we concluded this — carried into error messages and provenance. */
	evidence: string;
}

/** Human name for a format, for messages the user reads. */
export const FORMAT_LABEL: Record<StatementFormat, string> = {
	pdf: 'PDF',
	xlsx: 'Excel workbook',
	ods: 'OpenDocument spreadsheet',
	xls: 'legacy Excel workbook',
	camt053: 'CAMT.053 (ISO 20022)',
	xml: 'XML',
	ofx: 'OFX/QFX',
	qif: 'QIF',
	mt940: 'MT940',
	abo: 'ABO/GPC',
	delimited: 'delimited text',
	image: 'image',
	unknown: 'unrecognised'
};

const starts = (buffer: Uint8Array, bytes: number[], offset = 0): boolean =>
	bytes.every((b, i) => buffer[offset + i] === b);

/**
 * A zip holds its entry names in plain bytes in each local file header, so the
 * container's flavour can be told apart without inflating anything.
 */
function zipFlavour(buffer: Uint8Array): FormatSniff {
	const head = new TextDecoder('latin1').decode(buffer.subarray(0, Math.min(buffer.length, 8192)));
	if (head.includes('xl/workbook.xml') || head.includes('xl/_rels')) {
		return { format: 'xlsx', evidence: 'zip containing xl/workbook.xml' };
	}
	if (head.includes('opendocument.spreadsheet')) {
		return { format: 'ods', evidence: 'zip declaring an OpenDocument spreadsheet' };
	}
	// Unknown zip: treat as an Excel workbook attempt rather than refusing
	// outright — SheetJS reads several containers, and the safety boundary has
	// already bounded what it may expand.
	return { format: 'xlsx', evidence: 'zip container' };
}

export function sniffFormat(buffer: Uint8Array): FormatSniff {
	if (buffer.length === 0) return { format: 'unknown', evidence: 'the file is empty' };

	// --- binary containers, by magic number ---
	if (starts(buffer, [0x25, 0x50, 0x44, 0x46])) return { format: 'pdf', evidence: '%PDF header' };
	if (starts(buffer, [0x50, 0x4b, 0x03, 0x04]) || starts(buffer, [0x50, 0x4b, 0x05, 0x06])) {
		return zipFlavour(buffer);
	}
	if (starts(buffer, [0xd0, 0xcf, 0x11, 0xe0])) {
		return { format: 'xls', evidence: 'OLE2 compound document' };
	}
	if (starts(buffer, [0xff, 0xd8, 0xff])) return { format: 'image', evidence: 'JPEG' };
	if (starts(buffer, [0x89, 0x50, 0x4e, 0x47])) return { format: 'image', evidence: 'PNG' };
	// HEIC/HEIF: "ftyp" at offset 4, brand right after. Phone cameras default to
	// it, so a photographed statement usually arrives this way.
	if (starts(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
		const brand = new TextDecoder('latin1').decode(buffer.subarray(8, 12));
		if (/heic|heix|hevc|mif1|msf1/i.test(brand)) {
			return { format: 'image', evidence: `HEIF container (${brand.trim()})` };
		}
	}

	// --- text formats, by their own declared structure ---
	// Decode leniently: an encoding we cannot read is still recognisable by its
	// ASCII skeleton, which is all these signatures are made of.
	const head = new TextDecoder('utf-8', { fatal: false })
		.decode(buffer.subarray(0, Math.min(buffer.length, 4096)))
		.replace(/^\uFEFF/, '');
	const trimmed = head.trimStart();

	if (/^<\?xml|^<[A-Za-z]/.test(trimmed)) {
		if (/camt\.053/i.test(head)) {
			return { format: 'camt053', evidence: 'XML declaring a camt.053 namespace' };
		}
		if (/<BkToCstmrStmt\b/i.test(head)) {
			return { format: 'camt053', evidence: 'XML containing BkToCstmrStmt' };
		}
		return { format: 'xml', evidence: 'XML document' };
	}
	if (/^OFXHEADER/i.test(trimmed) || /<OFX>/i.test(head)) {
		return { format: 'ofx', evidence: 'OFX header' };
	}
	// QIF: a `!Type:` header, then one-letter fields terminated by a lone `^`.
	// Recognised so it can be REFUSED for the right reason — see the note in
	// `detect.ts`. Without this it reads as an unknown delimited file and is
	// turned away with a message about banks, which explains nothing.
	if (/^!Type:/im.test(head) && /^\^\s*$/m.test(head)) {
		return { format: 'qif', evidence: 'QIF header and record terminator' };
	}
	// MT940: tag-led lines. :20: is the reference and :61: a statement line;
	// requiring both keeps a document that merely quotes a tag from matching.
	if (/(^|\n):20:/.test(head) && /(^|\n):(61|60F):/.test(head)) {
		return { format: 'mt940', evidence: 'SWIFT MT940 tags :20: and :61:' };
	}
	// ABO/GPC: fixed 128-character records, type in the first three characters.
	const firstLine = head.split(/\r?\n/)[0] ?? '';
	if (/^07[45]/.test(firstLine) && firstLine.length >= 100) {
		return { format: 'abo', evidence: `ABO record ${firstLine.slice(0, 3)}` };
	}

	if (!head.trim()) return { format: 'unknown', evidence: 'the file contains no text' };

	// Falling through to "delimited text" is the sniffer's default, so it has to
	// earn it: binary noise decodes to control characters that survive trim(),
	// and would otherwise be handed to a CSV parser. A statement never contains
	// a NUL byte, and is overwhelmingly printable.
	const probe = buffer.subarray(0, Math.min(buffer.length, 1024));
	if (probe.includes(0x00)) {
		return { format: 'unknown', evidence: 'contains NUL bytes, so it is not text' };
	}
	let printable = 0;
	for (const byte of probe) {
		if (byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) printable++;
	}
	if (printable / probe.length < 0.9) {
		return { format: 'unknown', evidence: 'mostly non-printable bytes' };
	}

	return { format: 'delimited', evidence: 'plain text' };
}
