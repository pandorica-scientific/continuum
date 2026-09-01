// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a shelf's banner says, decided outside the markup.
 *
 * The BLURB is prose on the profile, because why a person opens a shelf cannot
 * be computed. The three FIGURES are counted by the server and only chosen
 * here, so which three a shelf shows is decided in one place.
 *
 * What a banner does NOT say is how the shelf is arranged. The mockups gave
 * every shelf a sentence for it — "By person, then by event", "Chronological
 * per person" — and on screen it earned nothing: the toolbar's own controls
 * already state the grouping, two feet away and editable, so the line restated
 * them in prose that then had to be kept true. A banner is for what a person
 * cannot see. The arrangement is the one thing they can.
 */
import { shelfProfile } from '$lib/shelf-profiles';

/**
 * One figure in the banner. `tone` is what makes it a task rather than a fact.
 *
 * Four, on the same channel logic the expiry pill uses: `alert` is red for
 * something already wrong, `warn` amber for something coming, `note` purple for
 * a figure worth seeing with no obligation behind it, and `plain` for a count.
 * Warranty cover left is the reason `note` exists — it is a good state, and
 * painting it amber would ring an alarm about something entirely fine.
 */
export interface BannerStat {
	value: string;
	label: string;
	tone: 'plain' | 'note' | 'warn' | 'alert';
}

/**
 * Everything any shelf's trio might need, counted once by the server.
 *
 * One flat shape rather than a union per shelf: the query module fills what its
 * shelf uses and leaves the rest at zero, and this file stays the only place
 * deciding which three a shelf shows. A union would have split that decision
 * across both.
 */
export interface BannerFacts {
	people: number;
	subjects: number;
	documents: number;
	records: number;
	expired: number;
	inReminderWindow: number;
	addresses: number;
	recurring: number;
	institutions: number;
	paymentsDue: number;
	inWarranty: number;
	lastEntry: string | null;
	nextDate: string | null;
	/** Whether ANY document on the shelf carries an expiry. Drives the third slot. */
	anyDated: boolean;
	accounts: number;
	gaps: number;
}

const plain = (value: string | number, label: string): BannerStat => ({
	value: String(value),
	label,
	tone: 'plain'
});

/**
 * A count that only takes its hue when there is something to take it about.
 *
 * Zero expired documents and zero gaps are the states this archive is FOR, and
 * painting them red says the opposite of what is true — a person scanning a row
 * of banners reads the colour before the number, so a red nought is an alarm
 * about nothing. The count keeps the hue the moment it is real.
 */
const counted =
	(tone: 'note' | 'warn' | 'alert') =>
	(value: number, label: string): BannerStat => ({
		value: String(value),
		label,
		tone: value > 0 ? tone : 'plain'
	});
const countedNote = counted('note');
const countedWarn = counted('warn');
const countedAlert = counted('alert');
/**
 * A DATE that is worth noticing, or a dash that is not.
 *
 * Same argument as `counted` below, in the shape a date needs: "no inspection
 * due" is the good state, and an amber dash reads as a warning about the
 * absence of a warning.
 */
const dated = (value: string | null, label: string): BannerStat =>
	value ? { value, label, tone: 'warn' } : { value: '—', label, tone: 'plain' };

/**
 * The third figure, for every shelf that has not claimed the slot.
 *
 * One rule and not seven special cases: the soonest date still ahead, or — when
 * the shelf holds nothing dated at all — a dash and the reason. Family's mocked
 * "no date logic applies" is this firing, which is exactly why it is not
 * written into Family: a Vehicles shelf holding nothing dated says the same.
 */
function nextDateStat(facts: BannerFacts): BannerStat {
	if (!facts.anyDated) return plain('—', 'no date logic applies');
	return facts.nextDate ? plain(facts.nextDate, 'next date') : plain('—', 'nothing ahead');
}

/**
 * The three figures a shelf shows, in order.
 *
 * A shelf with no profile — Tenancy, Vehicles, one the household made — gets the
 * default trio rather than an empty banner: every shelf can answer how much it
 * holds, what it concerns and what is next.
 */
export function bannerStats(
	shelfKey: string,
	facts: BannerFacts
): [BannerStat, BannerStat, BannerStat] {
	switch (shelfProfile(shelfKey)?.key) {
		case 'identity':
			return [
				plain(facts.people, 'people'),
				countedAlert(facts.expired, 'expired, 30-day window running'),
				countedWarn(facts.inReminderWindow, 'inside reminder window')
			];
		case 'health':
			return [
				plain(facts.people, 'people'),
				plain(facts.records, 'records'),
				plain(facts.lastEntry ?? '—', 'last entry')
			];
		case 'property':
			return [
				plain(facts.addresses, 'addresses'),
				plain(facts.recurring, 'recurring inspections'),
				dated(facts.nextDate, 'next one due')
			];
		case 'finance':
			// People rather than institutions. The shelf is Income & Tax: a payslip
			// and a tax return belong to a PERSON, and counting banks was a figure
			// left over from when this shelf was called Finance and meant the
			// mortgage.
			return [
				plain(facts.people, 'people'),
				plain(facts.documents, 'documents'),
				countedAlert(facts.paymentsDue, 'payments due')
			];
		case 'household':
			return [
				plain(facts.subjects, 'items'),
				countedNote(facts.inWarranty, 'still in warranty'),
				plain(facts.nextDate ?? '—', 'next lapse')
			];
		case 'statements':
			return [
				plain(facts.accounts, 'accounts'),
				plain(facts.records, 'statements'),
				countedAlert(facts.gaps, 'gaps')
			];
		case 'family':
			return [plain(facts.people, 'people'), plain(facts.records, 'records'), nextDateStat(facts)];
		default: {
			// What the shelf CONCERNS, in whichever unit it actually has. Tenancy
			// is about people and Vehicles about subjects; a zero labelled with the
			// unit the shelf does not use says nothing twice.
			const concerns =
				facts.subjects > 0 || facts.people === 0
					? plain(facts.subjects, 'subjects')
					: plain(facts.people, 'people');
			return [plain(facts.documents, 'documents'), concerns, nextDateStat(facts)];
		}
	}
}
