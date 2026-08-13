// The broker seam. A broker adapter turns that broker's report file into the
// one normalised shape the ingest, dedup, and value-curve reconstruction work
// from — the rest of the investments module never knows which broker it is.
// Adding a broker (Degiro, IBKR, …) means one adapter file that registers
// itself here; screens and ingest pick it up by detection.

export interface BrokerHolding {
	ticker: string;
	name: string;
	category: string;
	units: number;
	valueMinor: bigint;
	netProfitPct: number | null;
}

export interface BrokerCashOperation {
	/** broker-unique id — what makes re-uploads idempotent */
	id: string;
	type: string;
	ticker: string | null;
	happenedAt: string; // ISO datetime
	amountMinor: bigint;
	comment: string | null;
	positionId: string | null;
}

export interface BrokerPositionSpan {
	id: string;
	ticker: string;
	purchaseValueMinor: bigint | null;
	saleValueMinor: bigint | null;
	openedAt: string; // ISO datetime
	closedAt: string | null;
}

export interface BrokerReport {
	accountCurrency: string;
	generatedAt: string; // ISO datetime
	summaryValueMinor: bigint;
	holdings: BrokerHolding[];
	operations: BrokerCashOperation[];
	/** holding intervals: closed positions plus currently-open lots */
	positions: BrokerPositionSpan[];
}

export interface BrokerAdapter {
	id: string;
	label: string;
	/** cheap check whether this file looks like this broker's report */
	sniff(fileName: string, data: Uint8Array): boolean;
	parse(data: Uint8Array): BrokerReport;
}

const registry: BrokerAdapter[] = [];

export function registerBrokerAdapter(adapter: BrokerAdapter): void {
	registry.push(adapter);
}

export function brokerAdapters(): { id: string; label: string }[] {
	return registry.map((a) => ({ id: a.id, label: a.label }));
}

export function detectBroker(fileName: string, data: Uint8Array): BrokerAdapter | null {
	return registry.find((a) => a.sniff(fileName, data)) ?? null;
}
