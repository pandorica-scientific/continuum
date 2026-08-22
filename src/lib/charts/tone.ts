// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The colour token for a signed figure.
 *
 * Zero is green: nothing kept is not a loss, and flipping to red at exactly
 * break-even would report a rounding artefact as bad news.
 */
export function signTone(value: number): '--green' | '--red' {
	return value < 0 ? '--red' : '--green';
}
