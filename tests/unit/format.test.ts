import { describe, expect, it } from 'vitest';
import { sniffFormat } from '$lib/server/import/format';
import { MAX_UPLOAD_BYTES, assertSafeToParse, inspectZip } from '$lib/server/import/safety';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new TextEncoder().encode(s);

describe('format sniffing', () => {
	it('reads binary containers from their magic numbers', () => {
		expect(sniffFormat(text('%PDF-1.4\n...')).format).toBe('pdf');
		expect(sniffFormat(bytes(0xd0, 0xcf, 0x11, 0xe0, 0, 0)).format).toBe('xls');
		expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0)).format).toBe('image');
		expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47)).format).toBe('image');
	});

	it('recognises a phone photo in HEIC, which is how scans usually arrive', () => {
		const heic = new Uint8Array(16);
		heic.set(text('ftypheic'), 4);
		expect(sniffFormat(heic).format).toBe('image');
	});

	it('tells a CAMT.053 apart from any other XML', () => {
		const camt = text(
			'<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">'
		);
		expect(sniffFormat(camt).format).toBe('camt053');
		expect(
			sniffFormat(text('<?xml version="1.0"?><invoice><total>1</total></invoice>')).format
		).toBe('xml');
	});

	it('recognises the interchange formats by their own structure', () => {
		expect(sniffFormat(text('OFXHEADER:100\nDATA:OFXSGML\n')).format).toBe('ofx');
		expect(
			sniffFormat(text(':20:STMT123\n:25:12345678\n:60F:C250301CZK123,45\n:61:2503010301D')).format
		).toBe('mt940');
	});

	it('needs both MT940 tags, so a document quoting one does not match', () => {
		expect(sniffFormat(text('Please quote :20: on your remittance advice.\n')).format).not.toBe(
			'mt940'
		);
	});

	it('recognises an ABO record only at full record width', () => {
		expect(sniffFormat(text(`074${'0'.repeat(125)}\n`)).format).toBe('abo');
		// A CSV that happens to start "074," is not a fixed-width ABO record.
		expect(sniffFormat(text('074,12.50,shop\n075,3.00,cafe\n')).format).toBe('delimited');
	});

	it('does not trust the extension — content decides', () => {
		// A CSV someone renamed to .pdf still sniffs as delimited text, because
		// only the bytes are consulted.
		expect(sniffFormat(text('Date;Amount;Balance\n01.03.2025;-10,00;90,00\n')).format).toBe(
			'delimited'
		);
	});

	it('handles empty and binary noise without guessing', () => {
		expect(sniffFormat(new Uint8Array(0)).format).toBe('unknown');
		expect(sniffFormat(bytes(0x00, 0x01, 0x02, 0x03)).format).toBe('unknown');
	});
});

/** Minimal zip: one central-directory record plus the end-of-directory block. */
function fakeZip(entry: {
	name: string;
	compressed: number;
	uncompressed: number;
	flags?: number;
}) {
	const name = text(entry.name);
	const cd = new Uint8Array(46 + name.length);
	const view = new DataView(cd.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(8, entry.flags ?? 0, true);
	view.setUint32(20, entry.compressed, true);
	view.setUint32(24, entry.uncompressed, true);
	view.setUint16(28, name.length, true);
	cd.set(name, 46);

	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(10, 1, true); // one entry
	ev.setUint32(16, 4, true); // central directory begins after the local header stub

	const out = new Uint8Array(4 + cd.length + eocd.length);
	out.set([0x50, 0x4b, 0x03, 0x04], 0);
	out.set(cd, 4);
	out.set(eocd, 4 + cd.length);
	return out;
}

describe('safety boundary', () => {
	it('reads a zip directory without inflating anything', () => {
		const zip = fakeZip({ name: 'xl/workbook.xml', compressed: 1000, uncompressed: 20000 });
		const report = inspectZip(zip)!;
		expect(report.entries).toBe(1);
		expect(report.totalUncompressed).toBe(20000);
	});

	it('refuses a decompression bomb before opening it', () => {
		// 400 KB claiming 400 MB: a ratio no spreadsheet reaches.
		const bomb = fakeZip({
			name: 'xl/workbook.xml',
			compressed: 400 * 1024,
			uncompressed: 400 * 1024 * 1024
		});
		expect(() => assertSafeToParse(bomb, 'xlsx')).toThrow(/expands to|expands \d+ times/);
	});

	it('refuses a workbook holding another archive', () => {
		const nested = fakeZip({ name: 'payload.zip', compressed: 100, uncompressed: 200 });
		expect(() => assertSafeToParse(nested, 'xlsx')).toThrow(/another archive/i);
	});

	it('refuses an encrypted workbook with advice, not a stack trace', () => {
		const locked = fakeZip({
			name: 'xl/workbook.xml',
			compressed: 100,
			uncompressed: 200,
			flags: 0x1
		});
		expect(() => assertSafeToParse(locked, 'xlsx')).toThrow(/password-protected/i);
	});

	it('lets an ordinary workbook through', () => {
		const ok = fakeZip({ name: 'xl/workbook.xml', compressed: 50_000, uncompressed: 900_000 });
		expect(() => assertSafeToParse(ok, 'xlsx')).not.toThrow();
	});

	it('caps the upload size whatever the format', () => {
		const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		huge.set(text('%PDF-1.4'));
		expect(() => assertSafeToParse(huge, 'pdf')).toThrow(/limit is/);
	});

	it('does not inspect zips it was not handed as spreadsheets', () => {
		expect(() => assertSafeToParse(text('%PDF-1.4'), 'pdf')).not.toThrow();
	});
});
