// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How a shelf's own layout arranges the documents the list would have shown.
 *
 * Every decision here is a pure function over the SAME payload the list
 * gets, reachable without a browser since this repo has no browser suite. A
 * layout component is markup over these.
 *
 * `sectionsByPerson` and `countryGroups` are the only arrangement built so
 * far — the wallet's. Other views add their own rather than growing this
 * into a switch.
 */
import type { DocRow } from '$lib/documents/view';
import type { EntityKind, EnumValue } from '$lib/enums';

/** One record a document is filed against: the id and kind a layout groups by. */
export interface AboutLink {
	id: string;
	kind: EntityKind;
	name: string;
}

/** A row as a layout needs it: the list's row, plus what a card face draws. */
export interface LayoutRow extends DocRow {
	ext: string;
	tags: string[];
	about: AboutLink[];
	identity: {
		kind: EnumValue<'document_identity.kind'>;
		country: string | null;
		/** The document's own number, as typed; the face shows its last four. */
		number: string | null;
	} | null;
}

export interface LayoutSection<T> {
	/** The link the section is for, or null for the documents with none. */
	link: AboutLink | null;
	label: string;
	items: T[];
}

/**
 * What documents with nobody attached are filed under.
 *
 * Named rather than hidden: a passport nobody has said belongs to anyone is
 * exactly the document a wallet should show, because it is the one somebody
 * forgot to finish filing.
 */
export const NOBODY = 'Nobody';

/**
 * One section per linked person, `Nobody` last.
 *
 * A document appears ONCE, under the first person it names — a joint document
 * shown under both halves of a couple would make the per-person counts lie.
 * "First" here (registry kind, then name) can differ from the order
 * `groupDocuments` picks; both are stable and both show the document once.
 */
export function sectionsByPerson<T extends LayoutRow>(rows: T[]): LayoutSection<T>[] {
	return sectionsBy(rows, (row) => row.about.find((link) => link.kind === 'person') ?? null);
}

/** What documents with no issuing country are grouped under. */
export const NO_COUNTRY = 'No country';

/** One country's worth of a person's wallet. */
export interface CountryGroup<T> {
	/** The ISO code, or null for the documents that name none. */
	code: string | null;
	items: T[];
}

/**
 * A person's cards, split by the country that issued them.
 *
 * The second axis of the wallet, under the person: paper from two states is
 * two sets of it, not one run you have to work out from the flags.
 *
 * Ordered by CODE rather than localised name, since the code is what the
 * card face and caption actually show. No-country documents come last, same
 * reasoning as `NOBODY`.
 */
export function countryGroups<T extends LayoutRow>(items: T[]): CountryGroup<T>[] {
	const groups = new Map<string, CountryGroup<T>>();
	for (const row of items) {
		const code = row.identity?.country ?? null;
		const group = groups.get(code ?? '') ?? { code, items: [] };
		group.items.push(row);
		groups.set(code ?? '', group);
	}
	return [...groups.values()].sort((a, b) => {
		if (!a.code !== !b.code) return a.code ? -1 : 1;
		return (a.code ?? '').localeCompare(b.code ?? '');
	});
}

function sectionsBy<T extends LayoutRow>(
	rows: T[],
	pick: (row: T) => AboutLink | null
): LayoutSection<T>[] {
	const sections = new Map<string, LayoutSection<T>>();
	for (const row of rows) {
		const link = pick(row);
		const key = link?.id ?? '';
		const section = sections.get(key) ?? {
			link,
			label: link?.name ?? NOBODY,
			items: []
		};
		section.items.push(row);
		sections.set(key, section);
	}
	return [...sections.values()].sort((a, b) => {
		// Nobody last, whatever it would sort as among names.
		if (!a.link !== !b.link) return a.link ? -1 : 1;
		return a.label.localeCompare(b.label);
	});
}
