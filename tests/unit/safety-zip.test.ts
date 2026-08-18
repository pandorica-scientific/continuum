import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertSafeToParse } from '$lib/server/import/safety';

/**
 * A zip's central directory is written by whoever made the file.
 *
 * Every size limit here used to be checked against those numbers alone, which
 * is a defence against honesty. Measured before this suite existed: a 299 KB
 * upload declaring nothing at all passed every check, and SheetJS then inflated
 * it anyway — RSS moved by 812 MB in 586 ms, on the self-hosted box the limits
 * exist to protect.
 *
 * So the declared sizes are still read, because they give the clearest message
 * when they are honest, and then the entries are actually inflated under a
 * shared byte budget.
 */
function workbookDeclaring(uncompressedBytes: number, megabytesOfPayload: number): Uint8Array {
	const payload = Buffer.alloc(megabytesOfPayload * 1024 * 1024, 0x41);
	const deflated = deflateRawSync(payload, { level: 9 });
	const name = Buffer.from('xl/worksheets/sheet1.xml');

	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(8, 8);
	local.writeUInt32LE(deflated.length, 18);
	local.writeUInt32LE(uncompressedBytes, 22);
	local.writeUInt16LE(name.length, 26);

	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(8, 10);
	central.writeUInt32LE(deflated.length, 20);
	central.writeUInt32LE(uncompressedBytes, 24);
	central.writeUInt16LE(name.length, 28);
	central.writeUInt32LE(0, 42);

	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(central.length + name.length, 12);
	eocd.writeUInt32LE(local.length + name.length + deflated.length, 16);

	return new Uint8Array(Buffer.concat([local, name, deflated, central, name, eocd]));
}

describe('the upload safety boundary', () => {
	it('refuses a bomb that declares its real size', () => {
		expect(() => assertSafeToParse(workbookDeclaring(300 * 1024 * 1024, 300), 'xlsx')).toThrow(
			/over the .* limit/i
		);
	});

	it('refuses a bomb that declares nothing at all', () => {
		// The case the old boundary accepted: 299 KB in, 300 MB out, and a
		// central directory claiming zero bytes of content.
		expect(() => assertSafeToParse(workbookDeclaring(0, 300), 'xlsx')).toThrow(/expands past/i);
	});

	it('refuses a bomb that declares a plausible small size', () => {
		expect(() => assertSafeToParse(workbookDeclaring(12 * 1024, 300), 'xlsx')).toThrow(
			/expands past/i
		);
	});

	it('opens an honest workbook', () => {
		expect(() => assertSafeToParse(workbookDeclaring(40 * 1024, 0), 'xlsx')).not.toThrow();
	});

	it('refuses an empty upload, whatever the format', () => {
		expect(() => assertSafeToParse(new Uint8Array(0), 'delimited')).toThrow(/empty/i);
	});
});
