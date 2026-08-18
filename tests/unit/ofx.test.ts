import { describe, expect, it } from 'vitest';
import { parseOfx } from '$lib/server/import/standards/ofx';

/**
 * OFX arrives in two dialects under one extension, and the older one is not
 * XML: OFX 1.x is SGML, where a tag is opened, never closed, and its value runs
 * to the end of the line. Handing that to an XML parser fails with a message
 * about malformed markup, which tells the person who exported it nothing.
 */
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>GBP</CURDEF><BANKACCTFROM><ACCTID>12345678</ACCTID></BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260101120000[0:GMT]</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>REF1</FITID><NAME>Acme</NAME><MEMO>Salary</MEMO></STMTTRN><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260102</DTPOSTED><TRNAMT>-40.50</TRNAMT><FITID>REF2</FITID><NAME>Shop</NAME></STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1059.50</BALAMT><DTASOF>20260131</DTASOF></LEDGERBAL><AVAILBAL><BALAMT>959.50</BALAMT></AVAILBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>EUR</CURDEF><BANKACCTFROM><ACCTID>99</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260305</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>X1</FITID><NAME>Kiosk</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>87.66</BALAMT><DTASOF>20260331</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
	it('reads every movement in the SGML dialect', () => {
		const [statement] = parseOfx(SGML);
		expect(statement.currency).toBe('GBP');
		expect(statement.accountNumber).toBe('12345678');
		// A transaction ends where the next one begins, with no closing tag to
		// wait for. Filing it after resetting the fields instead of before yields
		// exactly one movement however many the file holds.
		expect(statement.rows).toHaveLength(2);
		expect(statement.rows.map((row) => row.amountMinor)).toEqual([10_000n, -4_050n]);
		expect(statement.rows[0].bookedAt).toBe('2026-01-01');
		expect(statement.rows[0].counterparty).toBe('Acme');
		expect(statement.rows[0].description).toBe('Salary');
	});

	it('takes the balance from LEDGERBAL and not from AVAILBAL', () => {
		// Available balance is what may be spent, not what the account holds. A
		// pending card authorisation makes them differ, and reading the wrong one
		// puts every such statement at odds with its own movements.
		const [statement] = parseOfx(SGML);
		expect(statement.closingBalanceMinor).toBe(105_950n);
	});

	it('derives the opening balance so the endpoints can be checked', () => {
		// The file states a closing balance and no opening one. Deriving the
		// opening from it cannot manufacture agreement — both sides come from the
		// same movements — but it does turn an unavailable check into a real one.
		const [statement] = parseOfx(SGML);
		const moved = statement.rows.reduce((total, row) => total + row.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + moved).toBe(statement.closingBalanceMinor);
	});

	it('reads the XML dialect the same way', () => {
		const [statement] = parseOfx(XML);
		expect(statement.currency).toBe('EUR');
		expect(statement.rows.map((row) => row.amountMinor)).toEqual([-1_234n]);
		expect(statement.closingBalanceMinor).toBe(8_766n);
	});

	it('ignores the timezone on a timestamp', () => {
		// The booking date is the date the bank printed. Shifting it into the
		// reader's zone moves movements across midnight, which changes the month
		// they fall in.
		expect(parseOfx(SGML)[0].rows[0].bookedAt).toBe('2026-01-01');
	});

	it('says so plainly when the file carries no statement', () => {
		expect(() => parseOfx('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>')).toThrow(/no <STMTRS>/i);
	});
});
