import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertSafeToParse } from '$lib/server/import/safety';

/**
 * A zip's declared sizes are written by whoever made the file, so they are
 * not trusted alone: entries are actually inflated under a shared byte budget.
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
		// Regression: a central directory claiming zero bytes still let a 300 MB expansion through.
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
