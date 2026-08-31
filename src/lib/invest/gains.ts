// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What was realised this year, and an estimate of the tax on it.
 *
 * Pure arithmetic over closed positions. It knows nothing about jurisdictions:
 * the rate is configured, and the holding-period exemption is a switch that is
 * off unless a household turns it on. Continuum is used from the Czech Republic,
 * where disposals of securities held over three years are exempt — but that is a
 * fact about one country, not about investing, and baking it in would quietly
 * produce wrong figures for everybody else.
 *
 * It is an ESTIMATE and says so on screen. It does not know about losses carried
 * forward from earlier years, other income, allowances, or anything held outside
 * this instance.
 */

/** A position that has been closed, as the broker reported it. */
export interface ClosedPosition {
	purchaseValueMinor: bigint | null;
	saleValueMinor: bigint | null;
	openedAt: Date;
	closedAt: Date | null;
}

export interface GainsPolicy {
	/** Percent, as configured. 15 means 15%. */
	ratePct: number;
	/** Whether a long enough holding is exempt at all. */
	exemptLongHeld: boolean;
	/** How long "long enough" is. Only read when the exemption is on. */
	exemptAfterYears: number;
}

export interface RealisedGains {
	/** Every gain and loss realised in the year, netted. */
	realisedMinor: bigint;
	/** The part excluded by the holding-period exemption. */
	exemptMinor: bigint;
	/** What the rate is applied to: realised less exempt, never below zero. */
	taxableMinor: bigint;
	/** rate × taxable, rounded to the minor unit. */
	estimatedTaxMinor: bigint;
	/** How many disposals the figures are built from. */
	disposals: number;
	/** How many of those were exempt. */
	exemptDisposals: number;
}

/** Whole years between two instants, by calendar date rather than by 365 days. */
export function yearsHeld(openedAt: Date, closedAt: Date): number {
	let years = closedAt.getUTCFullYear() - openedAt.getUTCFullYear();
	const beforeAnniversary =
		closedAt.getUTCMonth() < openedAt.getUTCMonth() ||
		(closedAt.getUTCMonth() === openedAt.getUTCMonth() &&
			closedAt.getUTCDate() < openedAt.getUTCDate());
	if (beforeAnniversary) years -= 1;
	return years;
}

export function realisedGains(
	positions: ClosedPosition[],
	year: number,
	policy: GainsPolicy
): RealisedGains {
	let realised = 0n;
	let exempt = 0n;
	let disposals = 0;
	let exemptDisposals = 0;

	for (const position of positions) {
		const { closedAt, openedAt, purchaseValueMinor, saleValueMinor } = position;
		// Still open, or a report that did not say what it sold for: neither is a
		// realised gain, and guessing one would put a number on the screen that
		// nothing supports.
		if (!closedAt || purchaseValueMinor === null || saleValueMinor === null) continue;
		if (closedAt.getUTCFullYear() !== year) continue;

		const gain = saleValueMinor - purchaseValueMinor;
		realised += gain;
		disposals += 1;

		if (policy.exemptLongHeld && yearsHeld(openedAt, closedAt) >= policy.exemptAfterYears) {
			exempt += gain;
			exemptDisposals += 1;
		}
	}

	// Never below zero: a loss is not a negative tax bill. What a loss actually
	// does — offsetting other gains, or carrying forward — is a question about
	// somebody's whole return, which this cannot see.
	const taxable = realised - exempt > 0n ? realised - exempt : 0n;

	// Rounded half up on the minor unit, in integer arithmetic: the rate is a
	// percentage with up to two decimals, so scale by 10 000 rather than
	// multiplying a bigint by a float.
	const rateScaled = BigInt(Math.round(policy.ratePct * 100));
	const estimatedTax = (taxable * rateScaled + 5000n) / 10000n;

	return {
		realisedMinor: realised,
		exemptMinor: exempt,
		taxableMinor: taxable,
		estimatedTaxMinor: estimatedTax,
		disposals,
		exemptDisposals
	};
}

/** Untaxed, no holding-period exemption, until a household says otherwise. */
export const DEFAULT_GAINS_POLICY: GainsPolicy = {
	ratePct: 0,
	exemptLongHeld: false,
	exemptAfterYears: 3
};

/** What the form posted, before it is known to be a policy. */
export interface GainsPolicyForm {
	ratePct: string | null;
	exemptLongHeld: boolean;
	exemptAfterYears: string | null;
}

/**
 * The posted form read as a policy, or the reason it is not one.
 *
 * A blank threshold is not a mistake to reject: the field is disabled while the
 * exemption is off, and a disabled field is not posted at all. Rejecting the
 * absence threw away the rate somebody had just typed beside it.
 */
export function parseGainsPolicy(
	form: GainsPolicyForm,
	current: GainsPolicy = DEFAULT_GAINS_POLICY
): { policy: GainsPolicy } | { message: string } {
	const ratePct = Number(
		String(form.ratePct ?? '')
			.replace(',', '.')
			.trim() || '0'
	);
	if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
		return { message: 'The rate must be a percentage between 0 and 100.' };
	}
	const yearsRaw = String(form.exemptAfterYears ?? '').trim();
	const years = yearsRaw === '' ? current.exemptAfterYears : Number(yearsRaw);
	if (yearsRaw !== '' && (!Number.isInteger(years) || years < 1 || years > 50)) {
		return { message: 'The exemption threshold must be a whole number of years.' };
	}
	return {
		policy: { ratePct, exemptLongHeld: form.exemptLongHeld, exemptAfterYears: years }
	};
}
