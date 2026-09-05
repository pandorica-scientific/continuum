// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A loan's fixation history as one band, in proportion to its whole life.
 *
 * The rate a mortgage is fixed at is the single fact that decides what it
 * costs, and it changes two or three times over twenty-five years. A list of
 * periods states that; a band SHOWS it — how much of the term is behind you at
 * a rate you have already paid, which rate you are on now, and how much of the
 * loan runs past the last date anybody has agreed a rate for.
 *
 * That last segment is the point of the picture. A household with a mortgage to
 * 2049 fixed only to 2028 is exposed for twenty-one years, and nothing in a
 * table of three rows says so.
 *
 * Pure, and tested: every segment is a share of a span, and getting a share
 * wrong is the kind of bug that looks plausible on screen.
 */
import type { FixationPeriod } from './amortise';

export interface BandSegment {
	/** Share of the whole term, 0–100, as a CSS percentage width. */
	widthPct: number;
	/** What to print inside, where it fits. */
	label: string;
	/** `past` is paid, `current` is the rate today, `unknown` is unfixed. */
	kind: 'past' | 'current' | 'unknown';
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two ISO dates; negative when `b` precedes `a`. */
function days(a: string, b: string): number {
	return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}

/**
 * Split a loan's term into fixation segments.
 *
 * `endsOn` is the loan's own end, not the last period's: the gap between the
 * two IS the unknown segment. A loan with no end date has no band — there is
 * no whole for the parts to be shares of.
 */
export function fixationBand(
	periods: readonly FixationPeriod[],
	loanEndsOn: string | null,
	today: string
): BandSegment[] {
	if (periods.length === 0 || !loanEndsOn) return [];
	const ordered = [...periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
	const start = ordered[0].startsOn;
	const total = days(start, loanEndsOn);
	if (total <= 0) return [];

	const out: BandSegment[] = [];
	for (const [i, period] of ordered.entries()) {
		// An open-ended period runs to the next one, or to the loan's own end.
		const ends = period.endsOn ?? ordered[i + 1]?.startsOn ?? loanEndsOn;
		const span = days(period.startsOn, ends);
		if (span <= 0) continue;
		const current = period.startsOn <= today && today < ends;
		out.push({
			widthPct: (span / total) * 100,
			label: `${period.annualRatePct}%`,
			kind: current ? 'current' : 'past'
		});
	}

	// Whatever is left after the last agreed rate. The whole reason for the band.
	const lastEnd = ordered.at(-1)?.endsOn ?? loanEndsOn;
	const unknown = days(lastEnd, loanEndsOn);
	if (unknown > 0) {
		out.push({
			widthPct: (unknown / total) * 100,
			label: `re-fix from ${lastEnd.slice(0, 7)} · unknown rate`,
			kind: 'unknown'
		});
	}
	return out;
}
