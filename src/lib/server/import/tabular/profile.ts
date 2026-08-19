/**
 * A remembered layout.
 *
 * A profile records how one bank's export is read, so the second file arrives
 * already understood. It is a fast path and nothing more: a statement still
 * has to prove itself, and a profile that has quietly stopped matching must
 * announce that rather than produce plausible nonsense.
 *
 * The matching key is a SIGNATURE over the header labels, never their
 * positions. Firefly III maps by column index, and that breaks the moment a
 * bank inserts a column — every role silently shifts one to the right and the
 * import looks fine. Matching on what the columns are CALLED means an inserted
 * column produces a mismatch, which is a question we can ask, instead of a
 * misreading we cannot detect.
 */
import { createHash } from 'node:crypto';
import type { DateOrder, DecimalMark } from './determinacy';
import { transactionRows, type Region } from './regions';
import { normalise, type ColumnRole } from './vocabulary';

interface ProfileMapping {
	/** Role per column, by NAME — the header label, not its index. */
	columns: { header: string; role: ColumnRole | null }[];
	dateOrder: DateOrder;
	decimalMark: DecimalMark;
	/** Set when the file names its currency nowhere and the user supplied it. */
	currency?: string;
}

export interface ImportProfile {
	id: string;
	name: string;
	/** Institution this describes, when known. */
	bank?: string;
	/** 'delimited' or 'xlsx'. */
	source: 'delimited' | 'xlsx';
	encoding?: string;
	delimiter?: string;
	/** Header signature this profile answers to. */
	signature: string;
	/** Human-readable header list, for the wizard to show. */
	headers: string[];
	mapping: ProfileMapping;
	/** Bumped when a drifted layout is re-confirmed; old files keep the old one. */
	version: number;
	/** A person confirmed this mapping against a preview. */
	verified: boolean;
	origin: 'builtin' | 'user' | 'imported';
}

/**
 * A stable fingerprint of a table's header row.
 *
 * Normalised so a bank re-casing or re-accenting a label does not invent a new
 * layout, and sorted so a column MOVING is not treated as a new one — only
 * adding, removing or renaming changes the signature, which is exactly the set
 * of changes that can alter meaning.
 */
export function headerSignature(headers: string[]): string {
	const parts = headers
		.map((h) => normalise(h).replace(/^#/, ''))
		.filter(Boolean)
		.sort();
	return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

/**
 * The header labels of a transaction region, in order.
 *
 * Falls back to the first row that is not a movement when nothing was
 * recognised as a header — which is the case a profile exists for. The header
 * detector names a row by the roles its labels carry, so a bank writing them in
 * a language the dictionary does not hold has no detectable header at all; and
 * keying profiles on what the detector found meant those layouts could be
 * mapped by hand and then never recognised again, because the saved signature
 * was computed over an empty list.
 *
 * A profile is keyed on what the columns are CALLED, and the file calls them
 * something whether or not we understand it.
 */
export function headersOf(region: Region): string[] {
	if (region.headerIndex !== undefined) return region.rows[region.headerIndex].map((c) => c.text);
	const body = new Set(transactionRows(region));
	const labels = region.rows.find((row) => !body.has(row));
	return labels ? labels.map((c) => c.text) : [];
}

type ProfileMatch =
	| { kind: 'match'; profile: ImportProfile }
	| {
			kind: 'drifted';
			profile: ImportProfile;
			added: string[];
			removed: string[];
	  }
	| { kind: 'none' };

/**
 * Find the profile for a header row, and say precisely how it differs when one
 * nearly fits.
 *
 * "Nearly" is the useful case: a bank adding a column is the single most common
 * change, and the difference is exactly what the drift dialog pre-fills from.
 */
export function matchProfile(headers: string[], profiles: ImportProfile[]): ProfileMatch {
	const signature = headerSignature(headers);
	const exact = profiles.find((p) => p.signature === signature);
	if (exact) return { kind: 'match', profile: exact };

	const current = new Set(headers.map((h) => normalise(h).replace(/^#/, '')).filter(Boolean));
	let best: { profile: ImportProfile; added: string[]; removed: string[]; overlap: number } | null =
		null;

	for (const profile of profiles) {
		const known = new Set(
			profile.headers.map((h) => normalise(h).replace(/^#/, '')).filter(Boolean)
		);
		const overlap = [...current].filter((h) => known.has(h)).length;
		// Most of the layout must still be recognisable, or this is a different
		// bank rather than the same bank changed.
		if (overlap < Math.max(3, Math.min(current.size, known.size) * 0.6)) continue;
		if (!best || overlap > best.overlap) {
			best = {
				profile,
				added: [...current].filter((h) => !known.has(h)),
				removed: [...known].filter((h) => !current.has(h)),
				overlap
			};
		}
	}

	if (best) {
		return { kind: 'drifted', profile: best.profile, added: best.added, removed: best.removed };
	}
	return { kind: 'none' };
}

/**
 * Apply a profile to a header row, yielding a role per column INDEX.
 *
 * Resolution is by label, so a bank reordering its columns still maps
 * correctly, and a column the profile does not name is left unmapped rather
 * than guessed at.
 */
export function rolesFromProfile(
	profile: ImportProfile,
	headers: string[]
): (ColumnRole | undefined)[] {
	const byName = new Map(
		profile.mapping.columns.map((c) => [normalise(c.header).replace(/^#/, ''), c.role])
	);
	return headers.map((header) => {
		const role = byName.get(normalise(header).replace(/^#/, ''));
		return role ?? undefined;
	});
}

/** Build a profile from a reading a person has confirmed. */
export function profileFromReading(input: {
	id: string;
	name: string;
	bank?: string;
	source: 'delimited' | 'xlsx';
	encoding?: string;
	delimiter?: string;
	headers: string[];
	roles: (ColumnRole | undefined)[];
	dateOrder: DateOrder;
	decimalMark: DecimalMark;
	currency?: string;
	origin?: ImportProfile['origin'];
	verified?: boolean;
}): ImportProfile {
	return {
		id: input.id,
		name: input.name,
		bank: input.bank,
		source: input.source,
		encoding: input.encoding,
		delimiter: input.delimiter,
		signature: headerSignature(input.headers),
		headers: input.headers,
		mapping: {
			columns: input.headers.map((header, i) => ({ header, role: input.roles[i] ?? null })),
			dateOrder: input.dateOrder,
			decimalMark: input.decimalMark,
			currency: input.currency
		},
		version: 1,
		verified: input.verified ?? true,
		origin: input.origin ?? 'user'
	};
}
