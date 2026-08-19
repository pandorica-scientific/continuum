/**
 * Confirming a layout a person has mapped by hand.
 *
 * When a statement cannot prove itself, the reader refuses it — and that is the
 * right answer, but on its own it is a dead end: the file is unreadable and
 * nothing the person knows about their own bank can change that. This is the
 * way through. They say which column is the date and which is the amount, the
 * reading is rebuilt from what they said, and it is put through **exactly the
 * same arithmetic as any other reading.**
 *
 * That last part is the whole design. A confirmed mapping is not permission to
 * skip the proof: it answers the question "what are these columns", which is
 * the only question a person is better placed to answer than the file. Whether
 * the movements add up is still decided by the balances, and a mapping that
 * produces rows contradicting them is refused exactly as an inferred one is.
 * `decideImport` enforces this — a verified profile can carry a P1 or a P2, and
 * a P0 is refused however confidently it was mapped.
 *
 * The profile is saved so the second statement from that bank arrives already
 * understood, keyed on the header LABELS rather than their positions, so an
 * inserted column produces a mismatch we can ask about rather than a silent
 * shift of every role by one.
 */
import { uuidv7 } from 'uuidv7';
import type { Db } from '$lib/server/db';
import { profileFromReading } from './tabular/profile';
import type { ColumnRole } from './tabular/vocabulary';
import type { DateOrder, DecimalMark } from './tabular/determinacy';
import { deleteProfile, saveProfile } from './profiles';
import { ingestFile, type IngestResult } from './ingest';

export interface ConfirmedMapping {
	/** What to call this layout when it is recognised again. */
	name: string;
	bank?: string;
	source: 'delimited' | 'xlsx';
	encoding?: string;
	delimiter?: string;
	headers: string[];
	/** One per header, in the same order. */
	roles: (ColumnRole | undefined)[];
	dateOrder: DateOrder;
	decimalMark: DecimalMark;
	/** Supplied when the file names its currency nowhere. */
	currency?: string;
	/**
	 * The profile this replaces, when a remembered layout has changed.
	 *
	 * Superseded rather than duplicated: leaving the old one in place would mean
	 * two profiles for one bank, and `matchProfile` takes the first exact
	 * signature hit — so which of them answered would depend on the order they
	 * came back from the database.
	 */
	supersedes?: string;
}

/**
 * Remember a mapping, then read the file with it.
 *
 * Saved before the import runs, deliberately. If the reading still fails the
 * arithmetic, the mapping is not the thing at fault — the person answered the
 * question they were asked — and making them answer it again to try a corrected
 * file would be punishing them for the reader's uncertainty.
 */
export async function confirmMapping(
	mapping: ConfirmedMapping,
	file: { filename: string; bytes: Uint8Array; accountId?: string },
	handle: Db
): Promise<IngestResult> {
	const profile = profileFromReading({
		id: uuidv7(),
		name: mapping.name,
		bank: mapping.bank,
		source: mapping.source,
		encoding: mapping.encoding,
		delimiter: mapping.delimiter,
		headers: mapping.headers,
		roles: mapping.roles,
		dateOrder: mapping.dateOrder,
		decimalMark: mapping.decimalMark,
		currency: mapping.currency,
		origin: 'user',
		// Confirmed by the person who has the statement in front of them. It makes
		// the weaker proof classes filable; it does not make P0 filable.
		verified: true
	});
	await saveProfile(profile, handle);
	// The old layout has been answered for; two profiles for one bank would make
	// which one applies depend on the order the database returned them.
	if (mapping.supersedes) await deleteProfile(mapping.supersedes, handle);

	return await ingestFile(file.filename, file.bytes, file.accountId, handle);
}
