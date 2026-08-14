import { describe, expect, it } from 'vitest';
import { confidence } from '$lib/rules/confidence';
import { DEFAULT_AUTO_THRESHOLD, DEFAULT_RULE_PRIOR } from '$lib/rules/match';

describe('confidence', () => {
	it('is zero with no evidence at all', () => {
		expect(confidence(0, 0)).toBe(0);
	});

	it('stays well below certainty after a single acceptance', () => {
		const c = confidence(1, 0);
		expect(c).toBeGreaterThan(0);
		expect(c).toBeLessThan(0.5);
	});

	it('rises as acceptances accumulate', () => {
		expect(confidence(10, 0)).toBeGreaterThan(confidence(3, 0));
		expect(confidence(50, 0)).toBeGreaterThan(confidence(10, 0));
	});

	it('never reaches one', () => {
		expect(confidence(1000, 0)).toBeLessThan(1);
	});

	it('falls when corrections arrive', () => {
		expect(confidence(10, 5)).toBeLessThan(confidence(10, 0));
		expect(confidence(1, 9)).toBeLessThan(confidence(5, 5));
	});

	it('is zero when every use was corrected', () => {
		expect(confidence(0, 8)).toBe(0);
	});

	// The prior and the threshold are load-bearing together. Without this pin,
	// tuning either could silently stop every seeded rule from filing, and no
	// other test would notice.
	it('trusts a rule at the starter prior, and demotes it after one correction', () => {
		expect(confidence(DEFAULT_RULE_PRIOR, 0)).toBeGreaterThan(DEFAULT_AUTO_THRESHOLD);
		expect(confidence(DEFAULT_RULE_PRIOR, 1)).toBeLessThan(DEFAULT_AUTO_THRESHOLD);
	});
});
