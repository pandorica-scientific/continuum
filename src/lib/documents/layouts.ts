// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How a shelf's own layout arranges the documents the list would have shown.
 *
 * Every decision here is a pure function over the SAME payload the list gets,
 * for the same reason `documents-view` exists: there is no browser suite in
 * this repository, so anything worth holding has to be reachable without a
 * page. A layout component is markup over these.
 *
 * `sectionsByPerson`, and `countryGroups` under it, are the only arrangement
 * built so far — the wallet's.
 * Health's timeline and Household's kit are specified and will add their own
 * beside it rather than growing this one into a switch.
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
 * A document appears ONCE, under the first person it names. A joint document
 * shown under both halves of a couple is a wallet that says a household owns
 * four passports when it owns two, and the count beside the name is what makes
 * that wrong out loud.
 *
 * "First" is the load's own order — registry kind, then name — which is not the
 * order `groupDocuments` reads `entities` in, so the two can pick different
 * people for a document naming two. Both are stable and both show it once;
 * deriving one from the other would move the list's sub-line to suit the
 * wallet, which is a worse trade than this footnote.
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
 * The second axis of the wallet, under the person. Somebody holding paper from
 * two states holds two sets of it — a Polish licence is renewed in Poland and a
 * Czech one in the Czech Republic — and a single run of cards makes that a
 * thing you work out from the flags rather than something the screen says.
 *
 * Ordered by CODE rather than by name: the code is what the card face shows and
 * what the caption reads, so ordering by the localised name would sort the
 * groups by a word that appears nowhere on the screen. Documents naming no
 * country come last, for the reason `NOBODY` does — an unfinished filing is
 * worth showing, and worth showing after the finished ones.
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
