export type BankId = 'fio' | 'revolut' | 'mbank' | 'rb' | 'cs';

export interface ParsedRow {
	/** ISO date the bank booked the movement. */
	bookedAt: string;
	/** The value date (valuta / operation date), when the format provides it. */
	valueDate?: string;
	/** Minor units of `currency`; negative = money out. Gross of any fee. */
	amountMinor: bigint;
	/** Separate bank fee on this movement, positive minor units. */
	feeMinor?: bigint;
	currency: string;
	/** Original amount for FX card payments billed in the account currency. */
	originalAmountMinor?: bigint;
	originalCurrency?: string;
	counterparty?: string;
	/** Counter-account in the bank's own printed form, e.g. "93531803/5500". */
	counterpartyAccount?: string;
	variableSymbol?: string;
	constantSymbol?: string;
	specificSymbol?: string;
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
	/**
	 * Totals the statement states for itself, when it prints them. These are
	 * independent evidence, not a convenience: opening + credits − debits =
	 * closing can still hold when two transactions are missing and happen to
	 * offset each other, but that pair cannot also leave both stated totals
	 * intact. Every bank sampled prints at least these two — Fio as "Suma
	 * příjmů/výdajů", Raiffeisenbank as "Příjmy/Výdaje celkem", Česká spořitelna
	 * as "Celkem přišlo/odešlo", mBank as "Uznania/Obciążenia".
	 */
	statedCreditTotalMinor?: bigint;
	statedDebitTotalMinor?: bigint;
	/** Movements the statement says it contains; mBank prints one per direction. */
	statedRowCount?: number;
	rows: ParsedRow[];
}

/** A text line reconstructed from a PDF page: cells ordered left to right. */
export interface PdfLine {
	page: number;
	y: number;
	cells: string[];
}
