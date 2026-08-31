// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
import type { GroupKey } from '$lib/documents-view';

/**
 * How a shelf draws its contents.
 *
 * Four of these are earned rather than decorative: paper that has a physical
 * shape a person already holds in mind — a wallet of cards, a folder of
 * certificates, a medical history, the papers that came with the boiler — is
 * recognised faster as that shape than as a row. A mortgage agreement has no
 * such shape, which is why Finance is `list` and stays `list`.
 *
 * `wallet` is drawn today; `gallery`, `timeline` and `kit` are specified and
 * not yet built, so the shelves that will use them are `list` until they are.
 * Naming them here rather than when they arrive is deliberate: the table below
 * is the plan, and a plan that lives in a commit message is not one.
 */
export type ShelfLayout = 'wallet' | 'gallery' | 'timeline' | 'kit' | 'list';

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
	/** Offered first by the type filter and proposed during inbox review. */
	expects: readonly EnumValue<'document.type'>[];
	/**
	 * What a layout groups by — a person, a subject, or either.
	 *
	 * Filled in even for a shelf still drawing the list, because it is part of
	 * what the shelf IS: health records belong to whoever or whatever they are
	 * about, whether or not a timeline is drawing them yet.
	 */
	about: 'person' | 'subject' | 'person-or-subject' | null;
	/** How the LIST groups this shelf when nobody has said otherwise. */
	group: GroupKey;
	/** One line under "Nothing on X yet", naming the paper that belongs here. */
	emptyHint: string;
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
		emptyHint: 'Nothing is waiting to be filed.'
	},
	identity: {
		key: 'identity',
		layout: 'wallet',
		expects: ['id_document', 'certificate'],
		about: 'person',
		group: 'entity',
		emptyHint: 'Passports, identity cards and driving licences live here.'
	},
	family: {
		key: 'family',
		layout: 'list',
		expects: ['certificate', 'contract', 'correspondence'],
		about: 'person',
		group: 'entity',
		emptyHint: 'Birth and marriage certificates, and the paper that follows them.'
	},
	health: {
		key: 'health',
		layout: 'list',
		expects: ['medical_record', 'certificate', 'insurance_policy', 'invoice'],
		about: 'person-or-subject',
		group: 'entity',
		emptyHint: 'Test results, vaccination records and health insurance.'
	},
	property: {
		key: 'property',
		layout: 'list',
		expects: ['insurance_policy', 'technical_plan', 'contract', 'invoice'],
		about: null,
		group: 'entity',
		emptyHint: 'Bills, home insurance and the plans that came with the flat.'
	},
	tenancy: {
		key: 'tenancy',
		layout: 'list',
		expects: ['contract', 'invoice', 'correspondence'],
		about: null,
		group: 'entity',
		emptyHint: 'Leases and what passes between a tenant and a landlord.'
	},
	vehicles: {
		key: 'vehicles',
		layout: 'list',
		expects: ['warranty', 'insurance_policy', 'invoice', 'manual'],
		about: 'subject',
		group: 'entity',
		emptyHint: 'Registrations, service history, insurance and warranties.'
	},
	finance: {
		key: 'finance',
		layout: 'list',
		expects: ['payslip', 'tax_document', 'invoice', 'contract'],
		about: null,
		// By year: a shelf of payslips and tax papers is read by which year it
		// concerns far more often than by whose name is on it.
		group: 'year',
		emptyHint: 'Payslips, tax papers and the invoices behind them.'
	},
	household: {
		key: 'household',
		layout: 'list',
		expects: ['warranty', 'manual', 'invoice', 'receipt', 'contract'],
		about: 'subject',
		group: 'entity',
		emptyHint: 'The papers that came with the boiler, the washing machine, the roof.'
	},
	statements: {
		key: 'statements',
		layout: 'list',
		expects: ['bank_statement', 'broker_report'],
		about: null,
		group: 'entity',
		emptyHint: 'Accepted bank statements and broker reports file themselves here.'
	}
};

/** What each layout is called where a person picks it. */
export const LAYOUT_LABELS: Record<ShelfLayout, string> = {
	wallet: 'Wallet',
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
