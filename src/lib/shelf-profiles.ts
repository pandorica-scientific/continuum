// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each shelf a fresh install ships is FOR.
 *
 * Ten shelves are seeded and eight cannot be removed, but until now the only
 * record of what belongs on one was prose in `docs/documents.md`: the code knew
 * Identity could not be deleted and not that it holds passports. This is that
 * knowledge, in the one place a screen, an empty state and the inbox review can
 * all read it from.
 *
 * It does NOT constrain anything. A shelf still takes any document of any type
 * — `type` is orthogonal to `shelf` by design, and a household that files its
 * car insurance under Identity is not doing anything the archive should argue
 * with. `expects` is what the screen OFFERS FIRST, never what it allows.
 *
 * Custom shelves have no profile and never will: this describes the set that
 * ships, and a shelf somebody made is theirs to use as they like.
 */
import type { EnumValue } from '$lib/enums';
import type { GroupKey } from '$lib/documents/view';

/**
 * How a shelf draws its contents.
 *
 * Four of these are earned rather than decorative: paper that has a physical
 * shape a person already holds in mind — a wallet of cards, a folder of
 * certificates, a medical history, the papers that came with the boiler — is
 * recognised faster as that shape than as a row. A mortgage agreement has no
 * such shape, which is why Finance is `list` and stays `list`.
 *
 * `wallet` and `completeness` are drawn today; `gallery`, `timeline` and `kit`
 * are specified and not yet built, so the shelves that will use them are `list`
 * until they are.
 * Naming them here rather than when they arrive is deliberate: the table below
 * is the plan, and a plan that lives in a commit message is not one.
 *
 * They are two types rather than one for the same reason. As a single union,
 * every `switch` on a shelf's layout carried three branches that no shelf could
 * reach and no reader could tell apart from the two that mattered — the plan
 * cost the working code its shape. Split, `ShelfLayout` is exactly what draws,
 * and the plan is still named, still typed, and still here.
 */
export type ShelfLayout = 'wallet' | 'completeness' | 'list';

/** Specified and not yet built. Promoted into `ShelfLayout` when one is drawn. */
export type PlannedShelfLayout = 'gallery' | 'timeline' | 'kit';

/** The keys the baseline seeds. Custom shelves are not in this union. */
export type SystemShelfKey =
	| 'inbox'
	| 'identity'
	| 'family'
	| 'health'
	| 'property'
	| 'tenancy'
	| 'vehicles'
	| 'finance'
	| 'household'
	| 'statements';

export interface ShelfProfile {
	key: SystemShelfKey;
	layout: ShelfLayout;
	/**
	 * Where a shelf's type list STARTS, and nothing more.
	 *
	 * The list itself lives in `shelf_type`, seeded from these and owned by the
	 * household afterwards — editing this array changes what a fresh install
	 * begins with and has no effect on an instance that is already running.
	 * `tests/integration/shelf-types` holds the two to the same values.
	 */
	expects: readonly EnumValue<'document.type'>[];
	/**
	 * What a layout groups by — a person, a subject, or either.
	 *
	 * Filled in even for a shelf still drawing the list, because it is part of
	 * what the shelf IS: health records belong to whoever or whatever they are
	 * about, whether or not a timeline is drawing them yet.
	 *
	 * `account` is the odd one and it is not a person or a thing: a statement
	 * belongs to the account it was issued for, which is why the coverage ribbon
	 * has one row per account and none per person. A shelf that draws a layout
	 * of its own has to name its unit — `tests/unit/shelf-profiles` holds that —
	 * because a layout is a way of grouping and a grouping needs something to
	 * group by.
	 */
	about: 'person' | 'subject' | 'person-or-subject' | 'account' | null;
	/** How the LIST groups this shelf when nobody has said otherwise. */
	group: GroupKey;
	/** One line under "Nothing on X yet", naming the paper that belongs here. */
	emptyHint: string;
	/**
	 * What the shelf is for, in two lines, above its contents.
	 *
	 * Prose and not derived, because this is the one thing about a shelf that
	 * genuinely cannot be computed: why a person would open it. Compare
	 * `arrangementLine`, which is derived precisely BECAUSE it can be wrong — it
	 * is a claim about the screen, and a stored claim goes stale the moment a
	 * layout is built or a grouping is changed.
	 */
	blurb: string;
	/** The question the shelf answers, after `Answers ·` in its footer. */
	answers: string;
}

export const SHELF_PROFILES: Record<SystemShelfKey, ShelfProfile> = {
	inbox: {
		key: 'inbox',
		layout: 'list',
		// Nothing is expected here: the Inbox is where paper lands before anyone
		// has said what it is, so proposing a type would be guessing out loud.
		expects: [],
		about: null,
		// By type rather than by entity: nothing in the Inbox is linked yet, so
		// grouping by what it is about would be one group called nothing.
		group: 'type',
		emptyHint: 'Nothing is waiting to be filed.',
		blurb:
			'Paper that has landed and nobody has filed yet. Not a record — a queue, and the only good state for it is empty.',
		answers: 'what still needs deciding?'
	},
	identity: {
		key: 'identity',
		layout: 'wallet',
		expects: ['id_document', 'certificate'],
		about: 'person',
		group: 'entity',
		emptyHint: 'Passports, identity cards and driving licences live here.',
		blurb:
			'Proof of who each person is. Almost everything here expires, and the person missing one is the finding.',
		answers: 'does everybody hold a valid document?'
	},
	family: {
		key: 'family',
		layout: 'list',
		expects: ['certificate', 'contract', 'correspondence'],
		about: 'person',
		group: 'entity',
		emptyHint: 'Birth and marriage certificates, and the paper that follows them.',
		blurb:
			'Marriage, birth, guardianship. Nothing here expires and nothing is archived — you hold these for life.',
		answers: 'where is the certificate for this relationship?'
	},
	health: {
		key: 'health',
		layout: 'list',
		expects: ['medical_record', 'certificate', 'insurance_policy', 'invoice'],
		about: 'person-or-subject',
		group: 'entity',
		emptyHint: 'Test results, vaccination records and health insurance.',
		blurb:
			'Medical records per person, in the order they happened: the previous result is the context for the current one.',
		answers: 'what happened to this person, and when?'
	},
	property: {
		key: 'property',
		layout: 'list',
		expects: ['insurance_policy', 'technical_plan', 'contract', 'invoice'],
		about: null,
		group: 'entity',
		emptyHint: 'Bills, home insurance and the plans that came with the flat.',
		blurb:
			'Everything tied to an address. These are obligations more than records — an inspection falls due whether you look or not.',
		answers: 'what does this property require of us?'
	},
	tenancy: {
		key: 'tenancy',
		layout: 'list',
		expects: ['contract', 'invoice', 'correspondence'],
		about: null,
		group: 'entity',
		emptyHint: 'Leases and what passes between a tenant and a landlord.',
		blurb:
			'What passes between a tenant and a landlord: the lease, what it obliges, and every letter that changed it.',
		answers: 'what did we agree with them?'
	},
	vehicles: {
		key: 'vehicles',
		layout: 'list',
		expects: ['warranty', 'insurance_policy', 'invoice', 'manual'],
		about: 'subject',
		group: 'entity',
		emptyHint: 'Registrations, service history, insurance and warranties.',
		blurb:
			'What a vehicle needs to stay on the road. Registration, insurance and inspection each expire on their own schedule.',
		answers: 'is this vehicle covered and legal?'
	},
	finance: {
		key: 'finance',
		layout: 'list',
		expects: ['payslip', 'tax_document', 'invoice', 'contract'],
		about: null,
		// By year: a shelf of payslips and tax papers is read by which year it
		// concerns far more often than by whose name is on it.
		group: 'year',
		emptyHint: 'Payslips, tax papers and the invoices behind them.',
		blurb:
			'Payslips, tax returns and the papers behind them. Read by year, because a year is the unit both a tax office and a lender ask in.',
		answers: 'what did we earn, and what do we owe?'
	},
	household: {
		key: 'household',
		layout: 'list',
		expects: ['warranty', 'manual', 'invoice', 'receipt', 'contract'],
		about: 'subject',
		group: 'entity',
		emptyHint: 'The papers that came with the boiler, the washing machine, the roof.',
		blurb:
			"Things you own that break. Receipt, warranty and manual are one object's paperwork, and filing them apart costs an afternoon.",
		answers: 'is this still under warranty?'
	},
	statements: {
		key: 'statements',
		// The second shelf to draw something other than a list, and the one with
		// the clearest reason: its failure mode is a month that never arrived,
		// and a list of ninety-six statements looks identical whether or not
		// April is among them. A ribbon draws the absence.
		layout: 'completeness',
		expects: ['bank_statement', 'broker_report'],
		about: 'account',
		group: 'entity',
		emptyHint: 'Accepted bank statements and broker reports file themselves here.',
		blurb:
			'Periodic paper, read only in bulk. Nothing expires; the one failure is a month that never arrived, which a list cannot show.',
		answers: 'is any month missing?'
	}
};

/**
 * What each layout is called where a person picks it.
 *
 * Covers the planned ones too: the label is part of the specification, and it
 * is the piece most likely to be argued over rather than invented.
 */
export const LAYOUT_LABELS: Record<ShelfLayout | PlannedShelfLayout, string> = {
	wallet: 'Wallet',
	completeness: 'Completeness',
	gallery: 'Gallery',
	timeline: 'Timeline',
	kit: 'Kit',
	list: 'List'
};

/** Narrows a shelf key to one the registry knows; `shelfProfile` is the way in. */
function isSystemShelfKey(key: string): key is SystemShelfKey {
	return Object.prototype.hasOwnProperty.call(SHELF_PROFILES, key);
}

/** The profile for a shelf, or null for `all` and for a shelf a household made. */
export function shelfProfile(key: string): ShelfProfile | null {
	return isSystemShelfKey(key) ? SHELF_PROFILES[key] : null;
}

/**
 * The types a shelf expects, first, then everything else by how many documents
 * it would leave.
 *
 * The filter still offers every type on the shelf: this decides the ORDER, so
 * that opening Identity's type filter starts with Identity document rather than
 * with whatever happens to be most numerous.
 */
export function orderTypeOptions<T extends { code: string; count: number }>(
	types: T[],
	expects: readonly string[]
): T[] {
	const rank = new Map(expects.map((code, i) => [code, i]));
	return [...types].sort((a, b) => {
		const ra = rank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
		const rb = rank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
		return ra - rb || b.count - a.count || a.code.localeCompare(b.code);
	});
}
