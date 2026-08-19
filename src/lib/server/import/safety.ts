// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * What must be true before a parser is allowed near an uploaded file.
 *
 * Uploads are untrusted, and XLSX is a zip: a few hundred kilobytes can expand
 * to gigabytes and exhaust a self-hosted box long before any statement is read.
 *
 * The cheap defence — reading the sizes a zip states in its own central
 * directory — was the whole defence here, and it defends against nothing,
 * because those numbers belong to whoever made the file. Measured: a 299 KB
 * upload declaring 0 bytes of content passed every check and then moved RSS by
 * 812 MB in 586 ms when SheetJS inflated it anyway.
 *
 * So the declared sizes are read first, because they give the clearest message
 * when they are honest, and then the entries are actually inflated under a hard
 * byte budget. Nothing downstream is reached until the file has proved it fits.
 *
 * Everything here runs BEFORE the format's parser, and every failure is a
 * message the person who uploaded the file can act on.
 */
import { inflateRawSync } from 'node:zlib';
import { FORMAT_LABEL, type StatementFormat } from './format';

/** Matches BODY_SIZE_LIMIT in docker/Dockerfile; a statement is 1–300 KB. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
/** A workbook of statements; far beyond any real bank export. */
const MAX_ZIP_ENTRIES = 512;
const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024;
/** Ordinary spreadsheet XML compresses ~20:1; 200:1 is not a spreadsheet. */
const MAX_COMPRESSION_RATIO = 200;
/** A ceiling on the checking itself, so a pathological archive cannot stall. */
const MAX_INSPECTION_MS = 5000;
/**
 * Shape limits for a workbook, applied after it opens.
 *
 * Bounding the compressed bytes bounds the XML, and the XML is not what costs
 * the memory — a sheet declaring a million rows of a hundred columns becomes a
 * hundred million JavaScript values, several times the size of the file it came
 * from. A bank statement is a few hundred rows of a dozen columns; a broker
 * report might reach a few thousand.
 */
export const MAX_SHEETS = 64;
export const MAX_CELLS_PER_SHEET = 2_000_000;

const NESTED_ARCHIVE = /\.(zip|xlsx|xlsm|docx|pptx|7z|rar|gz|tar|bz2)$/i;

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function u16(b: Uint8Array, i: number) {
	return b[i] | (b[i + 1] << 8);
}
function u32(b: Uint8Array, i: number) {
	return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

/** One entry, as the directory describes it and as it can be located. */
interface ZipEntry {
	name: string;
	method: number;
	compressed: number;
	localHeaderOffset: number;
}

interface ZipReport {
	entries: number;
	files: ZipEntry[];
	totalUncompressed: number;
	totalCompressed: number;
	nested: string[];
	encrypted: boolean;
	zip64: boolean;
}

/**
 * Read the central directory only. No entry is inflated, so a bomb costs us the
 * bytes already in memory and nothing more.
 */
export function inspectZip(buffer: Uint8Array): ZipReport | null {
	// End of central directory, scanning back over the optional comment.
	const limit = Math.max(0, buffer.length - (0xffff + 22));
	let eocd = -1;
	for (let i = buffer.length - 22; i >= limit; i--) {
		if (u32(buffer, i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) return null;

	const entries = u16(buffer, eocd + 10);
	let offset = u32(buffer, eocd + 16);

	const report: ZipReport = {
		entries,
		files: [],
		totalUncompressed: 0,
		totalCompressed: 0,
		nested: [],
		encrypted: false,
		zip64: false
	};

	for (let n = 0; n < entries; n++) {
		if (offset + 46 > buffer.length || u32(buffer, offset) !== 0x02014b50) break;
		const flags = u16(buffer, offset + 8);
		const compressed = u32(buffer, offset + 20);
		const uncompressed = u32(buffer, offset + 24);
		const nameLen = u16(buffer, offset + 28);
		const extraLen = u16(buffer, offset + 30);
		const commentLen = u16(buffer, offset + 32);
		const name = new TextDecoder('latin1').decode(
			buffer.subarray(offset + 46, offset + 46 + nameLen)
		);

		if (flags & 0x1) report.encrypted = true;
		// 0xFFFFFFFF is the ZIP64 escape: the real size lives in an extra field
		// we deliberately do not parse. Treat it as unbounded rather than as 4 GB.
		if (compressed === 0xffffffff || uncompressed === 0xffffffff) report.zip64 = true;
		report.totalCompressed += compressed;
		report.totalUncompressed += uncompressed;
		if (NESTED_ARCHIVE.test(name)) report.nested.push(name);
		report.files.push({
			name,
			method: u16(buffer, offset + 10),
			compressed,
			localHeaderOffset: u32(buffer, offset + 42)
		});

		offset += 46 + nameLen + extraLen + commentLen;
	}
	return report;
}

/**
 * Inflate every entry under one shared byte budget.
 *
 * This is the check that cannot be lied to. The directory's numbers are the
 * file author's claim; these are what the file actually does.
 *
 * The budget is shared across entries rather than applied per entry, so the
 * total work is bounded no matter how the payload is divided — 512 entries of
 * 500 MB each cost the same as one, because the first few exhaust the budget
 * and the rest are never reached.
 *
 * Stored entries cannot bomb: their output is their input, which is already
 * inside an upload we have measured. They are charged to the budget and not
 * inflated.
 */
function assertZipReallyFits(buffer: Uint8Array, report: ZipReport, format: StatementFormat): void {
	let budget = MAX_TOTAL_UNCOMPRESSED;
	const startedAt = Date.now();

	for (const entry of report.files) {
		const header = entry.localHeaderOffset;
		if (header + 30 > buffer.length || u32(buffer, header) !== 0x04034b50) continue;
		const start = header + 30 + u16(buffer, header + 26) + u16(buffer, header + 28);
		if (start >= buffer.length) continue;

		if (entry.method === 0) {
			budget -= Math.min(entry.compressed, buffer.length - start);
		} else {
			try {
				// No declared length is trusted: the deflate stream ends where it
				// ends, and `maxOutputLength` stops it if that is too far away.
				budget -= inflateRawSync(buffer.subarray(start), {
					maxOutputLength: Math.max(budget, 1)
				}).length;
			} catch {
				throw new Error(
					`That ${FORMAT_LABEL[format]} expands past the ${mb(MAX_TOTAL_UNCOMPRESSED)} limit, or one of its parts is damaged. It has not been opened.`
				);
			}
		}

		if (budget <= 0) {
			throw new Error(
				`That ${FORMAT_LABEL[format]} expands past the ${mb(MAX_TOTAL_UNCOMPRESSED)} limit. It has not been opened.`
			);
		}
		if (Date.now() - startedAt > MAX_INSPECTION_MS) {
			throw new Error(
				`That ${FORMAT_LABEL[format]} took too long to check, so it has not been opened.`
			);
		}
	}
}

/**
 * Throws a user-facing Error when the file must not be parsed. Returns quietly
 * when it may be.
 */
export function assertSafeToParse(buffer: Uint8Array, format: StatementFormat): void {
	if (buffer.length === 0) throw new Error('That file is empty.');
	if (buffer.length > MAX_UPLOAD_BYTES) {
		throw new Error(
			`That file is ${mb(buffer.length)}. The limit is ${mb(MAX_UPLOAD_BYTES)} — a bank statement is normally well under a megabyte, so this is probably not one.`
		);
	}

	if (format !== 'xlsx' && format !== 'ods') return;

	const zip = inspectZip(buffer);
	if (!zip) {
		throw new Error(
			`This looks like a ${FORMAT_LABEL[format]} but its directory could not be read, so it is damaged or not really a spreadsheet.`
		);
	}
	if (zip.encrypted) {
		throw new Error(
			'That workbook is password-protected. Save an unprotected copy and upload that.'
		);
	}
	if (zip.zip64) {
		throw new Error('That workbook declares ZIP64 sizes, which is far larger than any statement.');
	}
	if (zip.nested.length > 0) {
		throw new Error(
			`That workbook contains another archive (${zip.nested[0]}). Nested archives are not opened.`
		);
	}
	if (zip.entries > MAX_ZIP_ENTRIES) {
		throw new Error(
			`That workbook declares ${zip.entries} internal parts; the limit is ${MAX_ZIP_ENTRIES}.`
		);
	}
	if (zip.totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
		throw new Error(
			`That workbook expands to ${mb(zip.totalUncompressed)}, over the ${mb(MAX_TOTAL_UNCOMPRESSED)} limit. It has not been opened.`
		);
	}
	// Ratio last among the DECLARED checks: it is the signature of a bomb
	// specifically, so its message should not pre-empt the plainer size
	// explanations above.
	if (zip.totalCompressed > 0) {
		const ratio = zip.totalUncompressed / zip.totalCompressed;
		if (ratio > MAX_COMPRESSION_RATIO && zip.totalUncompressed > 8 * 1024 * 1024) {
			throw new Error(
				`That workbook expands ${Math.round(ratio)} times over, which no spreadsheet does. It has not been opened.`
			);
		}
	}

	// Everything above believed the file about itself. This does not.
	assertZipReallyFits(buffer, zip, format);
}
