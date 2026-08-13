import { and, asc, desc, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	loan,
	loanProperty,
	netWorthSnapshot,
	portfolioSnapshot,
	property
} from '$lib/server/db/schema';
import { convertMinor } from '$lib/server/fx';
import { getBaseCurrency } from '$lib/server/settings';

export interface NetWorthComponent {
	key: string;
	label: string;
	valueMinor: bigint; // base currency; negative for debts
	colorVar: string;
	detail: string;
}

export interface NetWorth {
	baseCurrency: string;
	totalMinor: bigint;
	components: NetWorthComponent[];
	/** change since the first snapshot of this calendar month, if known */
	deltaThisMonthMinor: bigint | null;
}

/**
 * Net worth = cash + (property values − mortgages) + portfolio − other loans.
 * Mortgages secured by a property fold into that property's equity; loans
 * without a property count as their own negative component.
 */
export async function computeNetWorth(): Promise<NetWorth> {
	const baseCurrency = await getBaseCurrency();
	const [accounts, properties, loans, links, snapshots] = await Promise.all([
		db.select().from(account),
		db.select().from(property),
		db.select().from(loan),
		db.select({ loanId: loanProperty.loanId }).from(loanProperty),
		db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1)
	]);
	const securedLoanIds = new Set(links.map((l) => l.loanId));

	const toBase = async (amount: bigint, currency: string) =>
		(await convertMinor(amount, currency, baseCurrency)) ?? amount;

	let cash = 0n;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		cash += await toBase(a.balanceMinor, a.currency);
	}

	let flatsEquity = 0n;
	let mortgagesOwed = 0n;
	for (const p of properties) {
		flatsEquity += await toBase(p.valueMinor, p.currency);
	}
	let otherLoans = 0n;
	for (const l of loans) {
		const owedBase = await toBase(l.owedMinor, l.currency);
		if (securedLoanIds.has(l.id)) {
			flatsEquity -= owedBase;
			mortgagesOwed += owedBase;
		} else {
			otherLoans += owedBase;
		}
	}

	let portfolio = 0n;
	if (snapshots[0]) {
		portfolio = await toBase(snapshots[0].valueMinor, snapshots[0].currency);
	}

	const components: NetWorthComponent[] = [];
	if (properties.length > 0) {
		components.push({
			key: 'flats',
			label: 'Flats, net of mortgage',
			valueMinor: flatsEquity,
			colorVar: '--blue',
			detail: `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}${mortgagesOwed > 0n ? ' after mortgages' : ''}`
		});
	}
	if (snapshots[0]) {
		components.push({
			key: 'investments',
			label: 'Investments',
			valueMinor: portfolio,
			colorVar: '--teal',
			detail: `broker report of ${snapshots[0].day}`
		});
	}
	components.push({
		key: 'cash',
		label: 'Cash across accounts',
		valueMinor: cash,
		colorVar: '--green',
		detail: `${accounts.filter((a) => a.kind !== 'brokerage').length} accounts, statement balances`
	});
	if (otherLoans > 0n) {
		components.push({
			key: 'loans',
			label: 'Other loans',
			valueMinor: -otherLoans,
			colorVar: '--red',
			detail: 'car and consumer debt'
		});
	}

	const totalMinor = components.reduce((s, c) => s + c.valueMinor, 0n);

	// Persist today's figure and read the month baseline.
	const today = new Date().toISOString().slice(0, 10);
	await db
		.insert(netWorthSnapshot)
		.values({ day: today, valueMinor: totalMinor, currency: baseCurrency })
		.onConflictDoUpdate({
			target: netWorthSnapshot.day,
			set: { valueMinor: totalMinor, currency: baseCurrency }
		});

	const monthStart = today.slice(0, 8) + '01';
	const baseline = await db
		.select()
		.from(netWorthSnapshot)
		.where(and(lt(netWorthSnapshot.day, monthStart)))
		.orderBy(desc(netWorthSnapshot.day))
		.limit(1);
	const earliest = baseline[0]
		? baseline[0]
		: (await db.select().from(netWorthSnapshot).orderBy(asc(netWorthSnapshot.day)).limit(1))[0];
	const deltaThisMonthMinor =
		earliest && earliest.day !== today ? totalMinor - earliest.valueMinor : null;

	return { baseCurrency, totalMinor, components, deltaThisMonthMinor };
}
