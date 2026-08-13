import { describe, expect, it } from 'vitest';
import { brokerAdapters, detectBroker } from '$lib/server/invest/adapter';
import '$lib/server/invest/xtb'; // registers the XTB adapter

const XLSX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

describe('broker adapter registry', () => {
	it('XTB registers itself and is detected from an xlsx file', () => {
		expect(brokerAdapters().some((a) => a.id === 'xtb')).toBe(true);
		expect(detectBroker('account_statement.xlsx', XLSX_MAGIC)?.id).toBe('xtb');
		expect(detectBroker('Account_Statement.XLSX', XLSX_MAGIC)?.id).toBe('xtb');
	});

	it('rejects files no adapter recognises', () => {
		expect(detectBroker('statement.csv', new Uint8Array([0x41, 0x42, 0x43]))).toBeNull();
		// right extension, wrong content — not a zip, so not an xlsx
		expect(detectBroker('report.xlsx', new Uint8Array([0x41, 0x42, 0x43]))).toBeNull();
	});
});
