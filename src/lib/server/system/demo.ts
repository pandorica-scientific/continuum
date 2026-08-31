// SPDX-License-Identifier: AGPL-3.0-or-later
// Demo mode: with DEMO=1 a pristine instance seeds itself with a fictional
// household — Jana & Petr Novák, two flats on one shared mortgage, six months
// of categorised cash flow, payslips, a portfolio snapshot — so screenshots
// and first impressions need no real data. Runs only when no person exists;
// a set-up instance is never touched.

import { uuidv7 } from 'uuidv7';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { initialsFor } from '$lib/people';
import { interestForMonth } from '$lib/loans/amortise';
import { formatMinor } from '$lib/money';
// The panel registry is a plain data module — no server imports, nothing to
// pull into the seed but the arrangement itself.
import { SUGGESTED_LAYOUT } from '$lib/overview/panels';
import type { EnumValue } from '$lib/enums';
import {
	contact,
	contactLink,
	account,
	brokerImportState,
	brokerOperation,
	currencyRate,
	loan,
	loanEvent,
	loanFixationPeriod,
	loanProperty,
	person,
	holding,
	portfolioSnapshot,
	property,
	propertyBill,
	rule,
	taxStatement,
	taxStatementLine,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { upsertIdentity, type IdentityFields } from '$lib/server/documents/identity';
import { createDocument } from '$lib/server/documents/mutations';
import { addSubject, archiveSubject } from '$lib/server/documents/subjects';
import { filePayslipDocument, recordSalary } from '$lib/server/salary';
import { hashBytes, saveUploadBytes } from '$lib/server/system/files';
import { saveSplits } from '$lib/server/splits';
import { FINGERPRINT_VERSION } from '$lib/server/import/fingerprint';
import { setTransactionTags } from '$lib/server/tags';
import { hashPassword } from '$lib/server/auth';
import { isSetUp, setSetting } from '$lib/server/settings';

const DEMO_PASSWORD = 'demo-demo-demo';

/**
 * Every word and figure a generated demo PDF is allowed to print (decision
 * D10).
 *
 * The rule is one sentence: a demo page may quote the household this file
 * invents and nothing else — not an environment variable, not a setting, not a
 * row belonging to whoever happens to be running the instance. Holding the
 * strings here rather than at each call site is what makes that reviewable at a
 * glance, and `tests/integration/demo-seed` asserts it from the other side by
 * reading the finished pages back.
 */
const JANA = 'Jana Nováková';
const PETR = 'Petr Novák';
const DEMO_EMPLOYER = 'Zaměstnavatel s.r.o.';
const DEMO_TENANT = 'Martin Dvořák';
const DEMO_INSURER = 'Pojišťovna Vltava a.s.';
const DEMO_POLICY_NUMBER = 'PV-2019-004417';
const DEMO_ID_NUMBER = 'ID 99 812 344';
const DEMO_PASSPORT_NUMBER = 'CZ 41 220 907';
const DEMO_BROKER = 'XTB';
const DEMO_CAR = 'Family hatchback';
const DEMO_DOG = 'Fík';
/**
 * Printed on the receipts so search-by-identifier has something to find. A
 * Czech receipt is looked up by its variable symbol far more often than by the
 * shop's name, and that is the search the demo could not previously show.
 */
const DEMO_VARIABLE_SYMBOLS = ['10078410', '20450913', '30991244'];

/** A4 in PDF points, and the frame every generated page is laid out in. */
const PAGE_WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 56;
const LINE_HEIGHT = 18;

/** An amount as a demo page prints it: figure then code, never a symbol. */
const amount = (minor: bigint, currency: string): string =>
	`${formatMinor(minor, currency, { exact: true })} ${currency}`;

/**
 * What a standard PDF font can actually print.
 *
 * The built-in Helvetica is WinAnsi-encoded — Latin-1 — and pdf-lib THROWS on a
 * character it cannot encode, so "Česká spořitelna" would fail the entire seed
 * on the ř. Embedding a Unicode face instead means shipping a font file and a
 * fontkit dependency for pages nobody prints, so the accents are folded off
 * here. Nothing is lost to search: `contact_fold` folds the query the same way,
 * so looking for "Nováková" still finds a page that says "Novakova".
 */
function pdfSafe(text: string): string {
	return (
		text
			// The two characters `formatMinor` emits that Latin-1 has no room for:
			// a true minus sign and a narrow no-break space. Dropping them blindly
			// would take the minus off a negative amount.
			.replace(/[−–—]/g, '-')
			.replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			// Anything still outside printable Latin-1 is dropped rather than
			// allowed to throw halfway through a seed.
			.replace(/[^ -~¡-ÿ]/g, '')
	);
}

/**
 * One page of plain text as a real PDF — a title and a column of lines.
 *
 * Text drawn with a standard font, so the file carries a genuine TEXT LAYER:
 * the extraction queue reads these without OCR, which is what makes
 * search-by-contents work in demo mode on a machine with no language data
 * installed. Each page comes out around 1–2 KB, so twenty of them cost less
 * than one of the interior photos the demo already ships.
 */
async function makeDemoPdf(title: string, lines: string[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle(pdfSafe(title));
	doc.setCreator('Continuum');
	doc.setProducer('Continuum demo seed');
	const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	const [heading, body] = await Promise.all([
		doc.embedFont(StandardFonts.HelveticaBold),
		doc.embedFont(StandardFonts.Helvetica)
	]);

	let y = PAGE_HEIGHT - PAGE_MARGIN;
	page.drawText(pdfSafe(title), { x: PAGE_MARGIN, y, size: 15, font: heading });
	y -= LINE_HEIGHT * 2;
	for (const line of lines) {
		page.drawText(pdfSafe(line), { x: PAGE_MARGIN, y, size: 10.5, font: body });
		y -= LINE_HEIGHT;
	}
	return new Uint8Array(await doc.save());
}

/**
 * A generated page, put on the data volume and filed as a document.
 *
 * Every piece of demo paper except the payslips goes through here (those go
 * through `filePayslipDocument`, which is the salary tracker's own writer), so
 * every demo document gets the three things a real upload gets: bytes under a
 * stored name, a `content_hash` over exactly those bytes, and an extraction job
 * queued AFTER the document's own transaction has committed. `createDocument`
 * does the last two in that order; nothing here writes a `document` row by
 * hand.
 */
async function fileDemoPdf(input: {
	name: string;
	shelfKey: string;
	type: EnumValue<'document.type'>;
	lines: string[];
	/** Whatever the paper is about, by id — the far end of a link is an entity. */
	targetIds?: string[];
	tagNames?: string[];
	note?: string;
	sensitivity?: EnumValue<'document.sensitivity'>;
	expiresOn?: string;
	expiryVerb?: EnumValue<'document.expiry_verb'>;
	periodOn?: string;
	/** What the face says, for the wallet to draw. Hand-entered in a real install. */
	identity?: IdentityFields;
}): Promise<string> {
	const bytes = await makeDemoPdf(input.name, input.lines);
	const storedName = await saveUploadBytes(bytes, 'demo.pdf');
	const id = uuidv7();
	await createDocument({
		id,
		name: input.name,
		shelfId: await shelfIdByKey(input.shelfKey),
		type: input.type,
		note: input.note ?? null,
		sensitivity: input.sensitivity ?? 'normal',
		storedName,
		ext: 'PDF',
		addedOn: new Date().toISOString().slice(0, 10),
		expiresOn: input.expiresOn ?? null,
		expiryVerb: input.expiryVerb ?? 'expires',
		targetIds: input.targetIds ?? [],
		tagNames: input.tagNames ?? [],
		contentHash: hashBytes(bytes),
		periodOn: input.periodOn ?? null
	});
	if (input.identity) await upsertIdentity(id, input.identity);
	return id;
}

function monthShift(base: string, offset: number): string {
	const [y, m] = base.split('-').map(Number);
	const total = y * 12 + (m - 1) + offset;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Demo interior photos ship in `static/demo/` (so they land in the client build
 * and need no Dockerfile change) and are copied into the upload directory under
 * a stored UUID name — exactly the shape a real upload takes, so the gallery
 * serves them through /files/<name> and knows nothing about where they began.
 * Returns null when the asset is missing rather than failing the whole seed.
 */
async function seedDemoPhoto(file: string): Promise<string | null> {
	const dir = env.UPLOAD_DIR || 'data';
	for (const source of [join('static', 'demo', file), join('build', 'client', 'demo', file)]) {
		try {
			const bytes = await readFile(source);
			await mkdir(dir, { recursive: true });
			const name = `${uuidv7()}.jpg`;
			await writeFile(join(dir, name), bytes);
			return name;
		} catch {
			// not this location — try the next
		}
	}
	return null;
}

export async function seedDemo(): Promise<void> {
	// The promise at the top of this file, enforced where it is made rather than
	// only at the one call site that happens to check. `hooks.server.ts` asks
	// `isSetUp()` before it calls this, but the seed WRITES FILES now as well as
	// rows, so a second run would leave two dozen orphan PDFs on the data volume
	// beside a duplicate household. Refusing here is what makes re-seeding a
	// no-op instead of a mess.
	if (await isSetUp()) return;

	await setSetting('householdName', 'Novák household (demo)');
	await setSetting('baseCurrency', 'CZK');

	// An opening fixing for every currency this household holds anything in.
	//
	// A real install backfills these from the Czech National Bank, but the demo
	// is often looked at on a machine with no route out, and the earliest thing
	// it seeds is a 2024 tax statement — years before any rate the app manages
	// to fetch. So every screen carried an orange banner saying the exchange
	// rate was approximate, which is true, and which says nothing about the
	// software to someone seeing it for the first time.
	//
	// One row each is enough: a rate carries forward from its first fixing, and
	// missingRateCodes only complains about a currency used BEFORE it has one.
	// Later CNB fixings land on top of these and take over from their own date.
	await db
		.insert(currencyRate)
		.values([
			{ code: 'EUR', day: '2024-01-01', rate: '24.725' },
			{ code: 'PLN', day: '2024-01-01', rate: '5.680' }
		])
		.onConflictDoNothing();

	const jana = uuidv7();
	const petr = uuidv7();
	const passwordHash = await hashPassword(DEMO_PASSWORD);
	// A board each, rather than the null that means "has never chosen one". A
	// real install shows that person the first-run picker, which is right for
	// somebody arriving at their own data and wrong here: the demo exists to be
	// looked at, and the first screen anybody sees — or screenshots — would be
	// an empty grid asking a question instead of the Overview it is showing off.
	await db.insert(person).values([
		{
			id: jana,
			name: JANA,
			initials: initialsFor(JANA),
			role: 'admin',
			birthYear: 1990,
			passwordHash,
			overviewLayout: SUGGESTED_LAYOUT
		},
		{
			id: petr,
			name: PETR,
			initials: initialsFor(PETR),
			role: 'member',
			birthYear: 1988,
			passwordHash,
			overviewLayout: SUGGESTED_LAYOUT
		}
	]);

	const fio = uuidv7();
	const revolut = uuidv7();
	// The brokerage account the seeded portfolio sits in and the broker report
	// below is filed against. Its balance is set directly here, not derived from
	// the "XTB deposit" lines added to the current account further down — those
	// are ordinary categorised outgoings with no transfer linking them across, so
	// this account does not make that money arrive anywhere; it exists so the
	// portfolio and the report have an account to be about. Net worth
	// deliberately leaves a brokerage's cash balance out of its own cash total —
	// the portfolio value already counts it.
	const broker = uuidv7();
	await db.insert(account).values([
		{
			id: fio,
			name: 'Fio běžný',
			emoji: '🏦',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK',
			ownerPersonId: jana,
			balanceMinor: 24350000n,
			balanceOn: new Date().toISOString().slice(0, 10)
		},
		{
			id: revolut,
			name: 'Revolut',
			emoji: '💳',
			bank: 'revolut',
			kind: 'current',
			currency: 'EUR',
			ownerPersonId: petr,
			balanceMinor: 310000n,
			balanceOn: new Date().toISOString().slice(0, 10)
		},
		{
			id: broker,
			name: 'XTB portfolio',
			emoji: '📈',
			// `other` rather than a key of its own: `bank` is the picker's list,
			// and a broker is not one of the banks a fresh install seeds.
			bank: 'other',
			kind: 'brokerage',
			currency: 'CZK',
			ownerPersonId: jana,
			balanceMinor: 125000n,
			balanceOn: new Date().toISOString().slice(0, 10)
		}
	]);

	// Six months of categorised, review-free cash flow.
	const thisMonth = new Date().toISOString().slice(0, 7);
	const rows: (typeof transaction.$inferInsert)[] = [];
	// Returns the row it pushed, so the seed can point a payslip or a receipt at
	// one particular payment rather than looking it up again by its description.
	const add = (
		month: string,
		day: string,
		amountMinor: bigint,
		categoryId: string,
		counterparty: string
	) => {
		const row: typeof transaction.$inferInsert = {
			id: uuidv7(),
			accountId: fio,
			bookedOn: `${month}-${day}`,
			amountMinor,
			currency: 'CZK',
			counterparty,
			dedupFingerprint: `demo-${rows.length}`,
			fingerprintVersion: FINGERPRINT_VERSION,
			categoryId,
			reviewState: 'filed'
		};
		rows.push(row);
		return row;
	};
	/** The salary credit of each month, for the payslips to be merged with. */
	const salaryCredits = new Map<string, typeof transaction.$inferInsert>();
	/**
	 * The newest mortgage instalment, for the loan payment recorded against it
	 * further down. Reassigned every month and the loop runs oldest first, so it
	 * ends holding the current month's debit.
	 */
	let mortgageDebit: typeof transaction.$inferInsert | null = null;
	for (let i = 5; i >= 0; i--) {
		const m = monthShift(thisMonth, -i);
		salaryCredits.set(m, add(m, '01', 6200000n, 'salary', DEMO_EMPLOYER));
		add(m, '02', 1650000n, 'rent-income', 'Nájemce · Karlín');
		mortgageDebit = add(m, '05', -5445600n, 'mortgage-main', 'Česká spořitelna · hypotéka');
		add(m, '06', -485000n, 'svj-insurance', 'SVJ Vinohradská');
		add(m, '08', -312000n, 'groceries', 'Albert');
		add(m, '15', -288000n, 'groceries', 'Lidl');
		add(m, '22', -274000n, 'groceries', 'Kaufland');
		add(m, '10', -240000n, 'energy', 'ČEZ Prodej');
		add(m, '11', -64900n, 'phone', 'O2 Czech Republic');
		add(m, '12', -182000n, 'fuel-tolls', 'Shell');
		add(m, '18', -245000n, 'eating-out', 'Restaurace U Nováků');
		add(m, '20', -119000n, 'everything-else', 'Alza.cz');
		add(m, '25', -1000000n, 'brokerage', 'XTB deposit');
	}
	await db.insert(transaction).values(rows);

	// One Alza purchase divided between a gadget and materials for a project,
	// and a tag over the project's spending — so demo mode shows both features
	// rather than an empty tags screen.
	const alza = rows.find((r) => r.counterparty === 'Alza.cz');
	if (alza) {
		await saveSplits(alza.id, [
			{ amountMinor: 79000n, categoryId: 'everything-else', note: 'Kettle' },
			{ amountMinor: 40000n, categoryId: 'everything-else', note: 'Shelving' }
		]);
		await setTransactionTags(alza.id, ['Renovation 2026']);
	}
	const cez = rows.filter((r) => r.counterparty === 'ČEZ Prodej').slice(0, 2);
	for (const row of cez) await setTransactionTags(row.id, ['Renovation 2026']);

	// A hand-written rule that the old single-matcher categoriser could not have
	// expressed: a counterparty *and* an amount floor. It starts from no evidence,
	// so the rules screen shows it earning trust rather than assuming it. Demo
	// transactions carry their categories directly, so this is the only rule a
	// demo instance begins with.
	await db.insert(rule).values({
		id: uuidv7(),
		name: 'Big Alza purchases',
		provenance: 'manual',
		conditions: [
			{ field: 'counterparty', op: 'contains', value: 'alza' },
			{ field: 'amount', op: 'between', min: '100000', max: null, currency: 'CZK' }
		],
		categoryId: 'everything-else'
	});

	// The gallery is one of the few screens that looks broken when empty.
	const flatPhotos = (
		await Promise.all(
			['flat-living.jpg', 'flat-kitchen.jpg', 'flat-bedroom.jpg'].map(seedDemoPhoto)
		)
	).filter((name): name is string => name !== null);

	// Rooms are painted cell by cell in the editor; seeding them is easier as
	// rectangles that share edges.
	const planRect = (x: number, y: number, w: number, h: number) =>
		Array.from({ length: w * h }, (_, k) => [x + (k % w), y + Math.floor(k / w)]) as [
			number,
			number
		][];

	// Two flats, one mortgage over both at explicit shares.
	const flatA = uuidv7();
	const flatB = uuidv7();
	await db.insert(property).values([
		{
			id: flatA,
			// Explicit, and earlier than Karlín: properties are listed by
			// created_at with the id as tiebreak, so inserting both in one
			// statement left the order to a random UUID — the property screen
			// opened on whichever flat won, and the demo screenshots changed
			// flat between runs. This flat was bought first (2019 vs 2022).
			createdAt: new Date(Date.now() - 60_000),
			name: 'Flat Vinohrady',
			sizeLabel: '3+kk · 78 m²',
			kind: 'lived',
			currency: 'CZK',
			valueMinor: 890000000n,
			valuedOn: new Date().toISOString().slice(0, 10),
			moneyInMinor: 310000000n,
			boughtYear: 2019,
			images: {
				photos: flatPhotos,
				// A real 3+kk at the 10 cm grid: rooms tile one 108 x 72 cell
				// rectangle with no gaps, so every wall is shared and the areas
				// add up to the 78 m² on the label rather than contradicting it.
				drawing: {
					cellCm: 10,
					rooms: [
						{ name: 'Living room & kitchen', cells: planRect(6, 1, 50, 44) },
						{ name: 'Bedroom', cells: planRect(56, 1, 30, 44) },
						{ name: "Child's room", cells: planRect(86, 1, 28, 44) },
						{ name: 'Hall', cells: planRect(6, 45, 32, 28) },
						{ name: 'Bathroom', cells: planRect(38, 45, 26, 28) },
						{ name: 'WC', cells: planRect(64, 45, 14, 28) },
						{ name: 'Storage', cells: planRect(78, 45, 14, 28) },
						{ name: 'Balcony', cells: planRect(92, 45, 22, 28) }
					]
				}
			}
		},
		{
			id: flatB,
			name: 'Flat Karlín',
			sizeLabel: '2+kk · 54 m²',
			kind: 'rented',
			currency: 'CZK',
			valueMinor: 610000000n,
			valuedOn: new Date().toISOString().slice(0, 10),
			moneyInMinor: 180000000n,
			boughtYear: 2022,
			images: {
				photos: [],
				// 2+kk, 90 x 60 cells = exactly the 54 m² on the label.
				drawing: {
					cellCm: 10,
					rooms: [
						{ name: 'Living room & kitchen', cells: planRect(15, 7, 52, 36) },
						{ name: 'Bedroom', cells: planRect(67, 7, 38, 36) },
						{ name: 'Hall', cells: planRect(15, 43, 32, 24) },
						{ name: 'Bathroom', cells: planRect(47, 43, 26, 24) },
						{ name: 'Storage', cells: planRect(73, 43, 14, 24) },
						{ name: 'Balcony', cells: planRect(87, 43, 18, 24) }
					]
				}
			}
		}
	]);
	const mortgage = uuidv7();
	// The terms, named rather than written out twice. The payment event below
	// works this month's interest out from exactly these figures, and a rate or a
	// balance that agreed with the loan only by coincidence would seed a demo
	// whose cash-flow chart contradicts its own loan screen.
	const mortgageOwedMinor = 927000000n;
	const mortgageRatePct = 4.44;
	const mortgageDayCount: EnumValue<'loan.day_count'> = 'act/360';
	const mortgagePaymentDay = 18;
	await db.insert(loan).values({
		id: mortgage,
		name: 'Mortgage ČS',
		lender: 'Česká spořitelna',
		kind: 'mortgage',
		currency: 'CZK',
		principalMinor: 990000000n,
		owedMinor: mortgageOwedMinor,
		owedOn: new Date().toISOString().slice(0, 10),
		startsOn: '2026-02-11',
		regime: 'fixed_period',
		dayCount: mortgageDayCount,
		accrualStyle: 'calendar',
		paymentDay: mortgagePaymentDay,
		interestDeductible: true
	});
	await db.insert(loanProperty).values([
		{ id: uuidv7(), loanId: mortgage, propertyId: flatA, sharePct: '62.5' },
		{ id: uuidv7(), loanId: mortgage, propertyId: flatB, sharePct: '37.5' }
	]);
	await db.insert(loanFixationPeriod).values({
		id: uuidv7(),
		loanId: mortgage,
		startsOn: '2026-02-11',
		// Relative, and inside the horizon the briefing watches (30 months), so a
		// demo household has the one thing every mortgage-holder actually has to
		// think about ahead of time. A fixation running to a fixed 2031 was five
		// years out from every angle: nothing to decide, nothing to show, and the
		// first panel on the Overview read "nothing needs a decision right now".
		endsOn: monthShift(thisMonth, 24) + '-11',
		annualRatePct: String(mortgageRatePct),
		paymentMinor: 5445600n
	});

	// This month's instalment, recorded as a payment on the loan and linked to the
	// debit that carried it. Without that link the cash-flow chart has nothing to
	// divide, and the demo showed a mortgage as one flat cost rather than as
	// interest gone and principal moved into a flat. The interest is stated the
	// way a statement states it — worked out on the balance at the seeded rate
	// under the loan's own convention, not a figure picked to look right.
	if (mortgageDebit) {
		await db.insert(loanEvent).values({
			id: uuidv7(),
			loanId: mortgage,
			happenedOn: mortgageDebit.bookedOn,
			kind: 'payment',
			// A magnitude, and the seeded rows carry no bank fee to net off.
			amountMinor: -mortgageDebit.amountMinor,
			interestMinor: interestForMonth(
				mortgageOwedMinor,
				mortgageRatePct,
				thisMonth,
				mortgageDayCount,
				mortgagePaymentDay
			),
			transactionId: mortgageDebit.id
		});
	}

	const tenancyB = uuidv7();
	// Close enough that the lease and its renewal notice are live decisions. At
	// ten months out both sat outside every window the briefing watches, so the
	// demo's tenancy was invisible on the screen that exists to surface exactly
	// this. Named once because the lease DOCUMENT below carries the same date —
	// D7 recognises the duplicate by comparing the two, so the moment they drift
	// the demo reminds twice for one lease ending.
	const tenancyStartsOn = '2025-06-01';
	const tenancyEndsOn = monthShift(thisMonth, 3) + '-01';
	await db.insert(tenancy).values({
		id: tenancyB,
		propertyId: flatB,
		tenantName: DEMO_TENANT,
		rentMinor: 1650000n,
		depositMinor: 3300000n,
		startsOn: tenancyStartsOn,
		endsOn: tenancyEndsOn,
		renewalNoticeOn: monthShift(thisMonth, 1) + '-01'
	});

	// The tenant, and one company the household deals with. Both carry diacritics
	// on purpose: the demo is where someone first tries the search, and folding
	// "dvorak" onto "Dvořák" is the thing worth discovering.
	const tenantContactId = uuidv7();
	await db.insert(contact).values([
		{
			id: tenantContactId,
			name: DEMO_TENANT,
			phone: '+420 777 000 111',
			email: 'martin.dvorak@example.cz',
			notes: 'Tenant, Flat B.'
		},
		{
			id: uuidv7(),
			name: 'Jana Řehořová',
			organisation: 'Česká spořitelna',
			jobTitle: 'Mortgage adviser',
			phone: '+420 800 207 207'
		}
	]);
	await db.insert(contactLink).values({ contactId: tenantContactId, targetId: tenancyB });
	await db.insert(propertyBill).values([
		{ id: uuidv7(), propertyId: flatA, label: 'SVJ fee & repair fund', amountMinor: 485000n },
		{ id: uuidv7(), propertyId: flatA, label: 'Electricity advance', amountMinor: 240000n },
		{ id: uuidv7(), propertyId: flatB, label: 'SVJ fee', amountMinor: 310000n }
	]);

	// Three years of monthly reports rather than a single point: a 10 000 Kč
	// standing order against a market that dips as well as climbs, so the value
	// chart has a shape and the gain is measured against money actually paid in
	// instead of against zero.
	const demoPortfolioAsOf = new Date();
	const depositMinor = 1000000n;
	const snapshots: (typeof portfolioSnapshot.$inferInsert)[] = [];
	const deposits: (typeof brokerOperation.$inferInsert)[] = [];
	let portfolioMinor = 0n;
	for (let m = 35; m >= 0; m--) {
		const at = new Date(
			Date.UTC(demoPortfolioAsOf.getUTCFullYear(), demoPortfolioAsOf.getUTCMonth() - m, 1)
		);
		const drift = 1.0075 + 0.032 * Math.sin(m * 1.7) + 0.018 * Math.sin(m * 0.55);
		portfolioMinor = BigInt(Math.round(Number(portfolioMinor + depositMinor) * drift));
		snapshots.push({
			day: at.toISOString().slice(0, 10),
			valueMinor: portfolioMinor,
			currency: 'CZK'
		});
		deposits.push({
			id: `demo-deposit-${m}`,
			type: 'Deposit',
			happenedAt: at,
			amountMinor: depositMinor,
			currency: 'CZK',
			comment: 'Standing order'
		});
	}
	await db.insert(portfolioSnapshot).values(snapshots);
	await db.insert(brokerOperation).values(deposits);
	await db.insert(brokerImportState).values({
		id: 'global',
		latestGeneratedAt: demoPortfolioAsOf,
		currency: 'CZK'
	});

	// Holdings have to add up to the latest snapshot exactly, or the portfolio
	// total and the allocation donut disagree; the largest position absorbs the
	// rounding remainder.
	const allocation: {
		ticker: string;
		name: string;
		category: string;
		share: number;
		priceCzk: number;
		netProfitPct: string;
	}[] = [
		{
			ticker: 'VWCE.DE',
			name: 'Vanguard FTSE All-World UCITS ETF',
			category: 'ETF',
			share: 0.42,
			priceCzk: 3180,
			netProfitPct: '14.80'
		},
		{
			ticker: 'CSPX.UK',
			name: 'iShares Core S&P 500 UCITS ETF',
			category: 'ETF',
			share: 0.21,
			priceCzk: 14250,
			netProfitPct: '21.30'
		},
		{
			ticker: 'CEZ.CZ',
			name: 'ČEZ a.s.',
			category: 'STOCK',
			share: 0.11,
			priceCzk: 985,
			netProfitPct: '-4.20'
		},
		{
			ticker: '4GLD.DE',
			name: 'Xetra-Gold ETC',
			category: 'ETF',
			share: 0.09,
			priceCzk: 1620,
			netProfitPct: '9.40'
		},
		{
			ticker: 'KOMB.CZ',
			name: 'Komerční banka',
			category: 'STOCK',
			share: 0.09,
			priceCzk: 742,
			netProfitPct: '6.70'
		},
		{
			ticker: 'MSFT.US',
			name: 'Microsoft Corp',
			category: 'STOCK',
			share: 0.08,
			priceCzk: 9450,
			netProfitPct: '-2.60'
		}
	];
	const valued = allocation.map((a, i) => ({
		...a,
		valueMinor: i === 0 ? 0n : BigInt(Math.round(Number(portfolioMinor) * a.share))
	}));
	valued[0].valueMinor =
		portfolioMinor - valued.slice(1).reduce((sum, v) => sum + v.valueMinor, 0n);
	await db.insert(holding).values(
		valued.map((v) => ({
			id: uuidv7(),
			ticker: v.ticker,
			name: v.name,
			category: v.category,
			units: (Number(v.valueMinor) / 100 / v.priceCzk).toFixed(6),
			valueMinor: v.valueMinor,
			currency: 'CZK',
			netProfitPct: v.netProfitPct,
			valuedAt: demoPortfolioAsOf
		}))
	);

	// ---- Paper (decision D10) ----
	//
	// Everything below is a REAL file: a small PDF generated here from the
	// constants at the top of this module, saved to the data volume, hashed, and
	// queued for extraction like any upload. Until v0.7.1 all of this was
	// metadata only, so the one instance built to show the viewer, search by
	// contents, receipts, restricted paper and archived subjects showed none of
	// them.
	const thisYear = Number(thisMonth.slice(0, 4));

	// Twelve payslips, through the salary tracker's own writer rather than a
	// hand-written insert: the shelf, the name format, the first-of-month
	// `period_on` and the content hash are its business, not this file's.
	for (let i = 11; i >= 0; i--) {
		const m = monthShift(thisMonth, -i - 1);
		const year = Number(m.slice(0, 4));
		// The figure the demo has always used is GROSS. Until v0.4.6 it lived on
		// the document and was read as gross while the reader picked net, which
		// is the defect that release fixed — so the demo states both.
		const gross = 5800000n + BigInt(year - 2024) * 400000n;
		// A December thirteenth-salary, so the base-versus-bonus split has
		// something to draw and the year-on-year comparison has a one-off in it
		// to be immune to.
		const bonus = m.endsWith('-12') ? gross / 2n : null;
		const grossWithBonus = gross + (bonus ?? 0n);
		// Czech withholding runs to roughly 29% of gross across tax and both
		// insurances. Approximate on purpose: this is a demo, not a calculator.
		const net = grossWithBonus - (grossWithBonus * 29n) / 100n;

		// The bank credit FIRST, for every month the demo has one. A payslip
		// merges into the month's unclaimed row, so recording the credit before
		// the slip is what leaves one row holding both — and D6's visible link
		// between the slip and the payment only forms on a row that holds both
		// ids. A slip recorded first keeps the month as two rows, by ruling.
		const credit = salaryCredits.get(m);
		if (credit) {
			await recordSalary({
				personId: jana,
				periodMonth: m,
				currency: 'CZK',
				netMinor: credit.amountMinor,
				source: 'statement',
				transactionId: credit.id
			});
		}

		const bytes = await makeDemoPdf(`Payslip ${m} · ${JANA}`, [
			`Employer: ${DEMO_EMPLOYER}`,
			`Employee: ${JANA}`,
			`Period: ${m}`,
			'',
			`Gross pay: ${amount(gross, 'CZK')}`,
			...(bonus ? [`Thirteenth salary: ${amount(bonus, 'CZK')}`] : []),
			`Total gross: ${amount(grossWithBonus, 'CZK')}`,
			`Tax and insurance: ${amount(grossWithBonus - net, 'CZK')}`,
			`Net pay: ${amount(net, 'CZK')}`,
			'',
			'Fictional payslip, generated by the Continuum demo seed.'
		]);
		const documentId = await filePayslipDocument({
			personId: jana,
			subject: JANA,
			periodMonth: m,
			storedName: await saveUploadBytes(bytes, 'payslip.pdf'),
			contentHash: hashBytes(bytes)
		});
		// The slip states gross, and the demo's approximate withholding gives the
		// net beside it — which is what the salary screen has always shown. The
		// credit above keeps its own place on the row, so the month reads as one
		// statement evidenced by both the paper and the payment.
		await recordSalary({
			personId: jana,
			periodMonth: m,
			currency: 'CZK',
			grossMinor: grossWithBonus,
			netMinor: net,
			bonusMinor: bonus,
			source: 'payslip',
			documentId
		});
	}

	// The lease, filed against the TENANCY — not the flat, which outlives any one
	// lease on it. Filing it there is also what makes D7 apply: the document's
	// date IS `tenancyEndsOn`, so the briefing and the calendar show the lease
	// ending once, from the tenancy, rather than once from each track.
	await fileDemoPdf({
		name: 'Renting contract · Karlín',
		shelfKey: 'tenancy',
		type: 'contract',
		targetIds: [tenancyB],
		expiresOn: tenancyEndsOn,
		// A lease that runs out is re-signed, not simply void: `renews` is the
		// verb, and the hue says whether the date has passed.
		expiryVerb: 'renews',
		lines: [
			'Flat Karlín · 2+kk · 54 m²',
			`Tenant: ${DEMO_TENANT}`,
			`Landlord: ${JANA} and ${PETR}`,
			'',
			`Term: ${tenancyStartsOn} to ${tenancyEndsOn}`,
			`Rent: ${amount(1650000n, 'CZK')} per month`,
			`Deposit: ${amount(3300000n, 'CZK')}`,
			`Renewal notice due: ${monthShift(thisMonth, 1) + '-01'}`,
			'',
			'Fictional lease, generated by the Continuum demo seed.'
		]
	});

	// One statement per current account, for the month just gone. The demo
	// writes its transactions directly rather than running an import, so there
	// is no `import_file` row for these to be keyed to — that column is written
	// by ingest, and inventing an import here would be inventing evidence the
	// household never produced.
	const statementMonth = monthShift(thisMonth, -1);
	const fioLines = rows
		.filter((r) => r.accountId === fio && r.bookedOn.startsWith(statementMonth))
		.map((r) => `${r.bookedOn}   ${r.counterparty}   ${amount(r.amountMinor, 'CZK')}`);
	await fileDemoPdf({
		name: `Fio běžný · ${statementMonth}`,
		shelfKey: 'statements',
		type: 'bank_statement',
		targetIds: [fio],
		tagNames: [statementMonth.slice(0, 4)],
		lines: [
			`Account: Fio běžný (CZK)`,
			`Period: ${statementMonth}`,
			'',
			...fioLines,
			'',
			`Closing balance: ${amount(24350000n, 'CZK')}`
		]
	});
	await fileDemoPdf({
		name: `Revolut · ${statementMonth}`,
		shelfKey: 'statements',
		type: 'bank_statement',
		targetIds: [revolut],
		tagNames: [statementMonth.slice(0, 4)],
		lines: [
			'Account: Revolut (EUR)',
			`Period: ${statementMonth}`,
			'',
			'No movements in this period.',
			'',
			`Closing balance: ${amount(310000n, 'EUR')}`
		]
	});

	// The broker's yearly report, on the brokerage account. Dated to the last
	// snapshot of last year, because that is the report a household attaches to
	// a tax return — which is also what its second tag says.
	const reportDay = `${thisYear - 1}-12-01`;
	const reportIndex = snapshots.findIndex((s) => s.day === reportDay);
	const asOf = reportIndex >= 0 ? snapshots[reportIndex] : snapshots[snapshots.length - 1];
	const paidInByThen =
		depositMinor * BigInt((reportIndex >= 0 ? reportIndex : snapshots.length - 1) + 1);
	await fileDemoPdf({
		name: `${DEMO_BROKER} report ${asOf.day}`,
		shelfKey: 'statements',
		type: 'broker_report',
		targetIds: [broker],
		tagNames: [DEMO_BROKER.toLowerCase(), `${thisYear - 1} return`],
		lines: [
			`Broker: ${DEMO_BROKER}`,
			'Account: XTB portfolio (CZK)',
			`Report date: ${asOf.day}`,
			'',
			`Portfolio value: ${amount(asOf.valueMinor, 'CZK')}`,
			`Paid in to date: ${amount(paidInByThen, 'CZK')}`,
			'',
			'Positions',
			...allocation.map((a) => `${a.ticker}   ${a.name}   ${(a.share * 100).toFixed(1)}%`),
			'',
			'Fictional report, generated by the Continuum demo seed.'
		]
	});

	// Three receipts on three real payments. Two wait in the Inbox and one is
	// already filed, so the review flow has something to show on both sides of
	// the fence. Each prints a variable symbol, which is what a Czech receipt is
	// actually looked up by.
	const latestTo = (counterparty: string) =>
		rows.filter((r) => r.counterparty === counterparty).at(-1);
	const receipts = [
		// The Alza purchase is also the split and tagged one, so the same payment
		// now carries every connector the ledger has.
		{ row: alza, shelfKey: 'household', tags: ['Renovation 2026'] },
		{ row: latestTo('Albert'), shelfKey: 'inbox', tags: [] },
		{ row: latestTo('Shell'), shelfKey: 'inbox', tags: [] }
	].filter(
		(r): r is { row: typeof transaction.$inferInsert; shelfKey: string; tags: string[] } =>
			r.row !== undefined
	);
	for (const [index, receipt] of receipts.entries()) {
		const symbol = DEMO_VARIABLE_SYMBOLS[index];
		await fileDemoPdf({
			name: `Receipt · ${receipt.row.counterparty} · ${receipt.row.bookedOn}`,
			shelfKey: receipt.shelfKey,
			type: 'receipt',
			targetIds: [receipt.row.id],
			tagNames: receipt.tags,
			lines: [
				`Merchant: ${receipt.row.counterparty}`,
				`Date: ${receipt.row.bookedOn}`,
				`Total: ${amount(-receipt.row.amountMinor, 'CZK')}`,
				`VS ${symbol}`,
				'',
				'Fictional receipt, generated by the Continuum demo seed.'
			]
		});
	}

	// The insurance on the lived-in flat, renewing inside the window the
	// briefing paints amber, so the Overview has one date that is genuinely
	// close rather than only ones that are comfortably far off.
	const policyRenewsOn = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
	await fileDemoPdf({
		name: 'Home insurance · Flat Vinohrady',
		shelfKey: 'property',
		type: 'insurance_policy',
		targetIds: [flatA],
		expiresOn: policyRenewsOn,
		expiryVerb: 'renews',
		lines: [
			`Insurer: ${DEMO_INSURER}`,
			`Policy: ${DEMO_POLICY_NUMBER}`,
			`Insured: ${JANA}`,
			'Property: Flat Vinohrady · 3+kk · 78 m²',
			'',
			`Sum insured: ${amount(890000000n, 'CZK')}`,
			`Annual premium: ${amount(742000n, 'CZK')}`,
			`Renews: ${policyRenewsOn}`,
			'',
			'Fictional policy, generated by the Continuum demo seed.'
		]
	});

	// The one restricted document, so demo mode can show what "restricted" means:
	// an admin sees it, a member does not see it AT ALL — no row, no count, no
	// search hint, no calendar entry, no file.
	await fileDemoPdf({
		name: `Identity card · ${JANA}`,
		shelfKey: 'identity',
		type: 'id_document',
		sensitivity: 'restricted',
		targetIds: [jana],
		identity: {
			kind: 'id_card',
			country: 'CZ',
			number: DEMO_ID_NUMBER,
			issuedOn: `${thisYear - 6}-03-14`,
			issuer: 'Magistrát hlavního města Prahy'
		},
		// Far outside every window the briefing and calendar watch: this document
		// exists to demonstrate the read rule, not to add a reminder.
		expiresOn: `${thisYear + 4}-03-14`,
		lines: [
			`Holder: ${JANA}`,
			`Number: ${DEMO_ID_NUMBER}`,
			`Issued: ${thisYear - 6}-03-14`,
			`Expires: ${thisYear + 4}-03-14`,
			'',
			'Fictional identity record, generated by the Continuum demo seed.'
		]
	});

	// An ordinary passport beside the restricted card: the wallet is worth
	// looking at only when it holds more than one card, and this is the one that
	// a member sees too. Its expiry is far outside every window the briefing
	// watches, so it adds a card and not a reminder.
	await fileDemoPdf({
		name: `Passport · ${PETR}`,
		shelfKey: 'identity',
		type: 'id_document',
		targetIds: [petr],
		expiresOn: `${thisYear + 7}-08-04`,
		identity: {
			kind: 'passport',
			country: 'CZ',
			number: DEMO_PASSPORT_NUMBER,
			issuedOn: `${thisYear - 3}-08-04`,
			issuer: 'Ministerstvo vnitra ČR'
		},
		lines: [
			`Holder: ${PETR}`,
			`Number: ${DEMO_PASSPORT_NUMBER}`,
			`Issued: ${thisYear - 3}-08-04`,
			`Expires: ${thisYear + 7}-08-04`,
			'',
			'Fictional travel document, generated by the Continuum demo seed.'
		]
	});

	// Two subjects beside the household's own. The car was sold last year, so its
	// paper is archived: it stays in the archive and drops out of every default
	// list, and its long-passed warranty reads as history rather than as an
	// expiry somebody forgot.
	const carSubject = await addSubject('Car', '🚗');
	await fileDemoPdf({
		name: `Warranty · ${DEMO_CAR}`,
		shelfKey: 'vehicles',
		type: 'warranty',
		targetIds: [carSubject],
		expiresOn: `${thisYear - 1}-05-31`,
		lines: [
			`Vehicle: ${DEMO_CAR}`,
			'Registration: 1AB 4471',
			`Warranty from: ${thisYear - 6}-06-01`,
			`Warranty to: ${thisYear - 1}-05-31`,
			'',
			'Fictional warranty, generated by the Continuum demo seed.'
		]
	});
	// Archived AFTER its paper is filed, and dated to the day the car was sold —
	// `active_to` is what lets the warranty above read as history.
	await archiveSubject(carSubject, `${thisYear - 1}-09-30`);

	// The dog is current, and its booster falls inside the year — a second
	// reminder from a subject rather than from a flat or a loan, which is the
	// case the rail's subjects exist for.
	const dogSubject = await addSubject('Dog', '🐕');
	const boosterDue = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
	const vaccinatedOn = new Date(Date.now() - 265 * 86400000).toISOString().slice(0, 10);
	await fileDemoPdf({
		name: `Vaccination certificate · ${DEMO_DOG}`,
		shelfKey: 'health',
		type: 'certificate',
		targetIds: [dogSubject],
		expiresOn: boosterDue,
		lines: [
			`Animal: ${DEMO_DOG}`,
			'Species: dog',
			'Vaccination: rabies',
			`Given: ${vaccinatedOn}`,
			`Booster due: ${boosterDue}`,
			'',
			'Fictional certificate, generated by the Continuum demo seed.'
		]
	});

	// Tax statements: two Czech years for Jana (the payslips diverge from the
	// declared figure on purpose — bonuses exist), one Polish year for Petr so
	// the charts show the two-country case and a rate that is comparable
	// across currencies that are not.
	const janaCz2024 = uuidv7();
	// Five Czech years for Jana and four Polish ones for Petr: enough points for
	// the effective-rate line to be a trend rather than a dot, with a visible
	// step where the rate changes rather than a straight climb.
	const janaCz: [number, bigint, bigint][] = [
		[2021, 96400000n, 12500000n],
		[2022, 104900000n, 13900000n],
		[2023, 117200000n, 16000000n],
		[2024, 129000000n, 18100000n],
		[2025, 138500000n, 20800000n]
	];
	const petrPl: [number, bigint, bigint][] = [
		[2022, 16800000n, 1900000n],
		[2023, 18300000n, 2100000n],
		[2024, 19900000n, 2350000n],
		[2025, 21600000n, 2600000n]
	];
	await db.insert(taxStatement).values([
		...janaCz.map(([year, grossIncomeMinor, taxPaidMinor]) => ({
			id: year === 2024 ? janaCz2024 : uuidv7(),
			personId: jana,
			year,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor,
			taxPaidMinor
		})),
		...petrPl.map(([year, grossIncomeMinor, taxPaidMinor]) => ({
			id: uuidv7(),
			personId: petr,
			year,
			country: 'PL',
			currency: 'PLN',
			grossIncomeMinor,
			taxPaidMinor
		}))
	]);
	await db.insert(taxStatementLine).values({
		id: uuidv7(),
		statementId: janaCz2024,
		label: 'Social insurance',
		amountMinor: 9100000n,
		sort: 0
	});
}
