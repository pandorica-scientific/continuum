export type BankId = 'fio' | 'revolut' | 'mbank' | 'rb' | 'cs';

export interface ParsedRow {
	/** ISO date the bank booked the movement. */
	bookedAt: string;
	/** Minor units of `currency`; negative = money out. */
	amountMinor: bigint;
	currency: string;
	counterparty?: string;
	/** Counter-account in the bank's own printed form, e.g. "93531803/5500". */
	counterpartyAccount?: string;
	variableSymbol?: string;
	description?: string;
	/** Bank-unique reference for this movement, when the format provides one. */
	bankRef?: string;
	/** Account balance after this movement, when the format provides one. */
	balanceAfterMinor?: bigint;
}

export interface ParsedStatement {
	bank: BankId;
	format: 'csv' | 'pdf';
	/** Account number as the statement prints it (no IBAN normalisation). */
	accountNumber?: string;
	currency: string;
	periodStart?: string;
	periodEnd?: string;
	openingBalanceMinor?: bigint;
	closingBalanceMinor?: bigint;
	rows: ParsedRow[];
}

/** A text line reconstructed from a PDF page: cells ordered left to right. */
export interface PdfLine {
	page: number;
	y: number;
	cells: string[];
}
