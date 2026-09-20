// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Tax years tab: one card per year and country, with who has filed.
 *
 * Its own module rather than a branch inside `dossier-load`, because it asks a
 * different question and answers it differently. A dossier card's membership is
 * `document.lane_id` — an explicit row, confirmed by a person — and a card that
 * is DRAWN rather than stored has no lane for that column to point at.
 *
 * What puts a document on a card here is what the document SAYS: its type, the
 * year it covers, the country it is from, and who it names. That is also what
 * makes dropping one onto a cell a single write rather than a lane assignment.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { foldCountry } from '$lib/countries';
import { derivedNameFor } from '$lib/tax';
import { db, inTransaction, type Queryable } from '$lib/server/db';
import {
	document,
	documentLink,
	documentType,
	engagement,
	organisation,
	person,
	tag,
	tagLink,
	taxFilingOverride,
	taxStatement
} from '$lib/server/db/schema';
import {
	isSupportingPaper,
	taxRowState,
	taxYearCards,
	taxYearGrid,
	taxYearsByPerson,
	type PersonBreakdown,
	type TaxRowState,
	type TaxYearGrid
} from '$lib/documents/tax-years';

export interface TaxYearDocument {
	id: string;
	name: string;
	ext: string;
	/** What this household calls the type, not the key. */
	typeLabel: string;
	addedOn: string;
	periodOn: string | null;
}

export interface TaxYearPersonRow {
	personId: string;
	personName: string;
	state: TaxRowState;
	/** The filings that put this row in `filed`. More than one is legal. */
	documents: TaxYearDocument[];
}

export interface TaxYearCardPayload {
	year: number;
	country: string;
	rows: TaxYearPersonRow[];
	/** Everything else filed for that year and country: earnings reports, broker reports. */
	supporting: TaxYearDocument[];
	gaps: number;
}

export interface TaxYearsPayload {
	cards: TaxYearCardPayload[];
	/** Newest first: the one time axis both views share. */
	years: number[];
	/** The household view: everybody folded into one cell per year and country. */
	grid: TaxYearGrid;
	/** The per-person view: a card each, a lane per country. */
	byPerson: PersonBreakdown[];
	/** The countries already in play, so the Add form opens on a likely one. */
	knownCountries: string[];
	people: { id: string; name: string }[];
	/**
	 * Employers and offices somebody has a role period with, but no country yet.
	 * Each is a period the derivation cannot place, so the tab says so rather
	 * than quietly drawing fewer cards than the household is owed.
	 */
	unplacedOrganisations: { id: string; name: string }[];
}

export async function loadTaxYears(
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<TaxYearsPayload> {
	const thisYear = Number(today.slice(0, 4));

	const [people, engagements, statements, overrides, dated, links, engagedOrganisations, tags] =
		await Promise.all([
			handle.select({ id: person.id, name: person.name }).from(person).orderBy(person.name),
			// The country travels with the role period, from the organisation it is
			// with: a Czech employer's year is a Czech return's year.
			handle
				.select({
					personId: engagement.personId,
					country: organisation.country,
					startsOn: engagement.startsOn,
					endsOn: engagement.endsOn
				})
				.from(engagement)
				.innerJoin(organisation, eq(organisation.id, engagement.organisationId)),
			handle
				.select({
					personId: taxStatement.personId,
					year: taxStatement.year,
					country: taxStatement.country
				})
				.from(taxStatement),
			handle
				.select({
					year: taxFilingOverride.year,
					country: taxFilingOverride.country,
					personId: taxFilingOverride.personId,
					expected: taxFilingOverride.expected
				})
				.from(taxFilingOverride),
			// Every document that names a country and a period: the filings and the
			// paper behind them, in one pass rather than two.
			handle
				.select({
					id: document.id,
					name: document.name,
					ext: document.ext,
					type: document.type,
					typeLabel: documentType.label,
					addedOn: document.addedOn,
					periodOn: document.periodOn,
					country: document.country
				})
				.from(document)
				.innerJoin(documentType, eq(documentType.key, document.type))
				.where(and(isNotNull(document.country), isNotNull(document.periodOn))),
			handle
				.select({ documentId: documentLink.documentId, personId: documentLink.targetId })
				.from(documentLink)
				.innerJoin(person, eq(person.id, documentLink.targetId)),
			handle
				.selectDistinct({
					id: organisation.id,
					name: organisation.name,
					country: organisation.country
				})
				.from(organisation)
				.innerJoin(engagement, eq(engagement.organisationId, organisation.id)),
			// What each tax document IS, as the Tax screen recorded it: a statement,
			// an employer's report, a broker's report. The kind lives on a tag, so
			// the tags are what tell a return from the paper behind it.
			handle
				.select({ documentId: tagLink.targetId, name: tag.name })
				.from(tagLink)
				.innerJoin(tag, eq(tag.id, tagLink.tagId))
		]);

	const tagsOf = new Map<string, string[]>();
	for (const row of tags)
		tagsOf.set(row.documentId, [...(tagsOf.get(row.documentId) ?? []), row.name]);

	const peopleOf = new Map<string, string[]>();
	for (const link of links)
		peopleOf.set(link.documentId, [...(peopleOf.get(link.documentId) ?? []), link.personId]);

	// A filing on record makes its card exist whether or not anybody was
	// employed there that year — the Polish broker report is the case.
	type Filing = { personId: string | null; year: number; country: string };
	const filings: Filing[] = [
		...statements.map((s) => ({ personId: s.personId, year: s.year, country: s.country })),
		...dated
			.filter((d) => d.type === 'tax_document')
			.flatMap((d): Filing[] => {
				const year = Number((d.periodOn as string).slice(0, 4));
				const named = peopleOf.get(d.id) ?? [];
				return named.length > 0
					? named.map((personId) => ({ personId, year, country: d.country as string }))
					: [{ personId: null, year, country: d.country as string }];
			})
	];

	const cards = taxYearCards({ engagements, filings, overrides, people, thisYear });

	const shown = (row: (typeof dated)[number]): TaxYearDocument => ({
		id: row.id,
		name: row.name,
		ext: row.ext,
		typeLabel: row.typeLabel,
		addedOn: row.addedOn,
		periodOn: row.periodOn
	});

	const drawn: TaxYearCardPayload[] = cards.map((card) => {
		const onCard = dated.filter(
			(d) => d.country === card.country && Number((d.periodOn as string).slice(0, 4)) === card.year
		);
		// A return is a tax document that names somebody and is not, by its own
		// tag, a report behind one. An earnings report used to count here, and
		// closed a gap that was still open; a mortgage-interest certificate that
		// names nobody is the paper behind a return, not the return.
		const filed = onCard.filter(
			(d) =>
				d.type === 'tax_document' &&
				(peopleOf.get(d.id) ?? []).length > 0 &&
				!isSupportingPaper(tagsOf.get(d.id) ?? [])
		);
		const rows = card.rows.map((row) => {
			// A joint return names both people, so it fills both rows. One piece
			// of paper, two true statements — which is why membership is the link
			// and not a column on the document.
			const mine = filed.filter((d) => (peopleOf.get(d.id) ?? []).includes(row.personId));
			return {
				...row,
				state: taxRowState(mine.length, card.year, thisYear),
				documents: mine.map(shown)
			};
		});
		return {
			year: card.year,
			country: card.country,
			rows,
			supporting: onCard.filter((d) => !filed.includes(d)).map(shown),
			gaps: rows.filter((r) => r.state === 'gap').length
		};
	});

	const grid = taxYearGrid(drawn);
	return {
		people,
		knownCountries: [...new Set(cards.map((c) => c.country))].sort(),
		unplacedOrganisations: engagedOrganisations
			.filter((o) => o.country === null)
			.map((o) => ({ id: o.id, name: o.name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		cards: drawn,
		years: grid.years,
		grid,
		byPerson: taxYearsByPerson(drawn, grid.years)
	};
}

/**
 * The name this document should carry once it has moved, or null to leave it.
 *
 * Only a name this code DERIVED may be re-derived. A household that typed its
 * own name for a document meant it, and renaming that would be this function
 * inventing a fact about paper it was only asked to move. So the old name is
 * rebuilt from the year and country the document is LEAVING, and the rename
 * happens only where the stored name matches it exactly.
 *
 * Without this, dragging a Polish IFT-1R onto the PL card moved its country to
 * PL and left it called "2025 CZ tax statement" — a title naming the wrong
 * country, which is worse than no title at all.
 */
async function renameForMove(
	documentId: string,
	year: number,
	country: string,
	tx: Queryable
): Promise<string | null> {
	const [current] = await tx
		.select({ name: document.name, country: document.country, periodOn: document.periodOn })
		.from(document)
		.where(eq(document.id, documentId));
	if (!current?.country || !current.periodOn) return null;

	const tagNames = (
		await tx
			.select({ name: tag.name })
			.from(tagLink)
			.innerJoin(tag, eq(tag.id, tagLink.tagId))
			.where(eq(tagLink.targetId, documentId))
	).map((row) => row.name);

	const oldYear = Number(current.periodOn.slice(0, 4));
	const separator = ' · ';
	const at = current.name.indexOf(separator);
	const suffix = at === -1 ? undefined : current.name.slice(at + separator.length);

	if (current.name === derivedNameFor(tagNames, oldYear, current.country)) {
		return derivedNameFor(tagNames, year, country);
	}
	if (suffix && current.name === derivedNameFor(tagNames, oldYear, current.country, suffix)) {
		return derivedNameFor(tagNames, year, country, suffix);
	}
	return null;
}

/**
 * Put a document on a tax year card, in one write.
 *
 * Membership here is what the document SAYS, so assigning it is setting those
 * fields. Dropping onto Supporting paper leaves the type alone, because an
 * employer's earnings report is not a return and calling it one would close a
 * gap that is still open.
 */
export async function assignToTaxYear(
	input: {
		documentId: string;
		year: number;
		country: string;
		personIds?: string[];
		/**
		 * Make it the paper BEHIND a return rather than one: drop every person it
		 * names. A mortgage-interest certificate filed as somebody's return closed
		 * a gap that was still open, and nothing could take it back.
		 */
		supporting?: boolean;
	},
	handle: Queryable = db
): Promise<void> {
	// Dropped on the household's cell, a return names everyone who owes that
	// year — which is what a joint return is. Dropped on one person's cell it
	// names them alone. Nobody named: supporting paper, and the type stays.
	const personIds = [...new Set(input.personIds ?? [])];
	await inTransaction(handle, async (tx) => {
		// Read BEFORE the update: the rename is decided from the year and country
		// the document is leaving, which this write is about to overwrite.
		const renamed = await renameForMove(
			input.documentId,
			input.year,
			input.country.toUpperCase(),
			tx
		);
		await tx
			.update(document)
			.set({
				...(personIds.length > 0 ? { type: 'tax_document' as const } : {}),
				...(renamed ? { name: renamed } : {}),
				// Both ends: `period_on` alone means the single month it names, so a
				// return dated 2025-01-01 would read as January 2025.
				periodOn: `${input.year}-01-01`,
				periodEndOn: `${input.year}-12-31`,
				country: input.country.toUpperCase()
			})
			.where(eq(document.id, input.documentId));

		if (input.supporting) {
			// Only the people. A link to the statement it was uploaded with, or to
			// an employer, is a different fact and stays.
			await tx
				.delete(documentLink)
				.where(
					and(
						eq(documentLink.documentId, input.documentId),
						inArray(documentLink.targetId, tx.select({ id: person.id }).from(person))
					)
				);
		}
		if (personIds.length > 0) {
			await tx
				.insert(documentLink)
				.values(personIds.map((targetId) => ({ documentId: input.documentId, targetId })))
				.onConflictDoNothing();
		}
	});
}

/**
 * Say whether a filing is expected, overruling the derivation.
 *
 * An upsert on `(year, country, person_id)` rather than an insert: saying the
 * same thing twice is a person pressing a button twice, not an error, and the
 * unique index is `NULLS NOT DISTINCT` precisely so the card-level row is found
 * when `person_id` is null.
 *
 * The country is folded here rather than trusted. The CHECK would catch a bad
 * one, but a constraint violation reaches a person as a 500 rather than as a
 * sentence about what went wrong.
 */
export async function setTaxFilingExpected(
	input: { year: number; country: string; personId?: string; expected: boolean },
	handle: Queryable = db
): Promise<void> {
	const country = foldCountry(input.country);
	if (!country) throw new Error(`Not a country code: ${input.country}`);

	await handle
		.insert(taxFilingOverride)
		.values({
			id: uuidv7(),
			year: input.year,
			country,
			personId: input.personId ?? null,
			expected: input.expected
		})
		.onConflictDoUpdate({
			target: [taxFilingOverride.year, taxFilingOverride.country, taxFilingOverride.personId],
			set: { expected: input.expected }
		});
}
