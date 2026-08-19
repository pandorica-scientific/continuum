/**
 * Which institution a statement came from.
 *
 * No longer a closed union. Format-first routing means a single parser serves
 * every bank exporting that format, and there is often no way to tell which
 * bank issued the file — an ABO export names no issuer at all. Where the
 * issuer is unknown the format itself is the honest label.
 */
import type { EnumValue } from '$lib/enums';

export type BankId = string;

/**
 * How a statement was read, and what proved it.
 *
 * Kept because the proof engine used to decide whether to file a statement and
 * then discard its reasoning, which left the ledger holding numbers with no
 * account of where they came from. A row that later looks wrong could not be
 * traced back to the reading that produced it.
 */
interface StatementProvenance {
	/** Which reader produced this: an adapter, a standard, or which assembler. */
	method: string;
	proofClass: EnumValue<'proof_class'>;
	/** The ledger model the chain closed under, when one did. */
	ledgerModel?: string;
	checks: { name: string; status: 'pass' | 'fail' | 'unavailable'; detail: string }[];
}

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
	/** How this reading was produced and what proved it. */
	provenance?: StatementProvenance;
	/**
	 * A LABEL for the reading, not an identity.
	 *
	 * Since routing became format-first this field holds a real issuer only when
	 * an adapter read the file. Every other reader writes the format's own name
	 * — `tabular`, `camt053`, `ofx` — because an ABO export names no issuer at
	 * all and the format is then the honest thing to say. Good as a label, and
	 * the reason `issuer` exists: this must never decide which account a
	 * statement belongs to.
	 */
	bank: BankId;
	/**
	 * The institution, when the FILE actually named one.
	 *
	 * Undefined is the common case and means "this file does not say", which is
	 * different from "no bank" — it is the difference between evidence and a
	 * guess. Account identity may consult this; it may never consult `bank`,
	 * which for most readings is a format name. Treating the two as the same
	 * thing refused correct account choices ("the selected account belongs to
	 * cs, but this statement belongs to tabular"), collapsed unrelated banks
	 * sharing a currency into one account, and split one real account in two —
	 * importing everything twice — when the same account was read once by an
	 * adapter and once from a CAMT export.
	 */
	issuer?: BankId;
	format: 'csv' | 'pdf' | 'abo' | 'mt940' | 'camt053' | 'ofx' | 'xlsx';
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
	/**
	 * Left edge of each cell, in PDF units.
	 *
	 * Kept because a PDF has no columns — only glyphs at coordinates — so the
	 * only way to recover a table is to cluster cells by where they sit. The
	 * existing per-bank parsers read cells positionally within a line and never
	 * needed this; the generic reader cannot work without it.
	 */
	xs?: number[];
	/**
	 * Right edge of each cell.
	 *
	 * Money columns are RIGHT-aligned, so their cells share an ending position
	 * and not a starting one: `3.250,00` begins further left than `87,45` and
	 * clustering by left edge splits one column into two. The amounts of a real
	 * statement landed in two different columns because of exactly this.
	 */
	xEnds?: number[];
}
