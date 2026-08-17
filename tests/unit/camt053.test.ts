import { describe, expect, it } from 'vitest';
import { parseCamt053 } from '$lib/server/import/standards/camt053';
import { parseXml, textAt, descendants } from '$lib/server/import/standards/xml';

const entry = (o: {
	amount: string;
	ind: 'CRDT' | 'DBIT';
	reversal?: boolean;
	date: string;
	ref?: string;
	name?: string;
	iban?: string;
	info?: string;
}) => `
      <Ntry>
        <Amt Ccy="CZK">${o.amount}</Amt>
        <CdtDbtInd>${o.ind}</CdtDbtInd>
        ${o.reversal ? '<RvslInd>true</RvslInd>' : ''}
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${o.date}</Dt></BookgDt>
        <ValDt><Dt>${o.date}</Dt></ValDt>
        <AcctSvcrRef>${o.ref ?? 'REF'}</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties>
            <Cdtr><Nm>${o.name ?? 'Protistrana'}</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>${o.iban ?? 'CZ2010000000002500834780'}</IBAN></Id></CdtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>${o.info ?? 'platba'}</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`;

const FILE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG-1</MsgId></GrpHdr>
    <Stmt>
      <Id>STMT-2025-03</Id>
      <Acct><Id><IBAN>CZ6955000000000093531803</IBAN></Id><Ccy>CZK</Ccy></Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="CZK">35971.21</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2025-03-01</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLAV</Cd></CdOrPrtry></Tp>
        <Amt Ccy="CZK">30000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2025-03-31</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="CZK">39452.31</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2025-03-31</Dt></Dt>
      </Bal>
      <TxsSummry>
        <TtlNtries><NbOfNtries>3</NbOfNtries></TtlNtries>
        <TtlCdtNtries><NbOfNtries>1</NbOfNtries><Sum>15000.00</Sum></TtlCdtNtries>
        <TtlDbtNtries><NbOfNtries>2</NbOfNtries><Sum>11518.90</Sum></TtlDbtNtries>
      </TxsSummry>
      ${entry({ amount: '6103.00', ind: 'DBIT', date: '2025-03-03', ref: '7108202415', name: 'Spole&#269;enstv&#237;' })}
      ${entry({ amount: '15000.00', ind: 'CRDT', date: '2025-03-04', ref: '7110240770' })}
      ${entry({ amount: '5415.90', ind: 'DBIT', date: '2025-03-05', ref: '7112671245' })}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('minimal XML reader', () => {
	it('reads elements, attributes and nesting', () => {
		const doc = parseXml('<a x="1"><b>hello</b><c/></a>');
		expect(textAt(doc, 'a', 'b')).toBe('hello');
		expect(descendants(doc, 'a')[0].attrs.x).toBe('1');
	});

	it('drops namespace prefixes, which banks disagree about', () => {
		const doc = parseXml('<ns:Doc xmlns:ns="urn:x"><ns:Stmt><ns:Id>7</ns:Id></ns:Stmt></ns:Doc>');
		expect(textAt(doc, 'Doc', 'Stmt', 'Id')).toBe('7');
	});

	it('decodes the predefined entities and numeric references', () => {
		expect(textAt(parseXml('<a>P&#345;&#237;jem &amp; v&#253;daj</a>'), 'a')).toBe(
			'Příjem & výdaj'
		);
	});

	it('refuses a file with no elements at all', () => {
		expect(() => parseXml('just text')).toThrow(/no XML elements/);
	});
});

describe('CAMT.053', () => {
	const [statement] = parseCamt053(FILE);

	it('reads the account and currency', () => {
		expect(statement.bank).toBe('camt053');
		expect(statement.accountNumber).toBe('CZ6955000000000093531803');
		expect(statement.currency).toBe('CZK');
	});

	it('uses booked balances and ignores the available balance', () => {
		// CLAV is 30 000,00 and would never reconcile; CLBD is the ledger balance.
		expect(statement.openingBalanceMinor).toBe(3597121n);
		expect(statement.closingBalanceMinor).toBe(3945231n);
		expect(statement.periodStart).toBe('2025-03-01');
		expect(statement.periodEnd).toBe('2025-03-31');
	});

	it('takes the currency from the Amt attribute', () => {
		expect(statement.rows[0].currency).toBe('CZK');
		expect(statement.rows[0].amountMinor).toBe(-610300n);
	});

	it('reads the transaction summary, so the statement can prove itself fully', () => {
		expect(statement.statedCreditTotalMinor).toBe(1500000n);
		expect(statement.statedDebitTotalMinor).toBe(1151890n);
		expect(statement.statedRowCount).toBe(3);
		expect(statement.rows).toHaveLength(statement.statedRowCount!);
	});

	it('reconciles on every independent check', () => {
		const sum = statement.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
		const credits = statement.rows
			.filter((r) => r.amountMinor > 0n)
			.reduce((a, r) => a + r.amountMinor, 0n);
		const debits = statement.rows
			.filter((r) => r.amountMinor < 0n)
			.reduce((a, r) => a - r.amountMinor, 0n);
		expect(credits).toBe(statement.statedCreditTotalMinor);
		expect(debits).toBe(statement.statedDebitTotalMinor);
	});

	it('reads counterparty, account and remittance from the transaction details', () => {
		expect(statement.rows[0].counterparty).toBe('Společenství');
		expect(statement.rows[0].counterpartyAccount).toBe('CZ2010000000002500834780');
		expect(statement.rows[0].bankRef).toBe('7108202415');
		expect(statement.rows[0].description).toBe('platba');
	});

	it('inverts an entry flagged as a reversal', () => {
		const reversed = parseCamt053(
			FILE.replace(
				'<Amt Ccy="CZK">6103.00</Amt>\n        <CdtDbtInd>DBIT</CdtDbtInd>',
				'<Amt Ccy="CZK">6103.00</Amt>\n        <CdtDbtInd>DBIT</CdtDbtInd>\n        <RvslInd>true</RvslInd>'
			)
		)[0];
		// A reversed debit puts the money back.
		expect(reversed.rows[0].amountMinor).toBe(610300n);
	});

	it('returns one statement per <Stmt>, which is why the pipeline takes an array', () => {
		const two = FILE.replace(
			'</Stmt>\n  </BkToCstmrStmt>',
			'</Stmt>\n    <Stmt><Id>B</Id><Acct><Id><IBAN>CZ111</IBAN></Id><Ccy>EUR</Ccy></Acct></Stmt>\n  </BkToCstmrStmt>'
		);
		const parsed = parseCamt053(two);
		expect(parsed).toHaveLength(2);
		expect(parsed[1].accountNumber).toBe('CZ111');
		expect(parsed[1].currency).toBe('EUR');
	});

	it('refuses XML that is not a statement', () => {
		expect(() => parseCamt053('<Document><Other/></Document>')).toThrow(/CAMT\.053/);
	});
});
