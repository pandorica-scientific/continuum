// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cadenceWord } from '$lib/statements/cadence';

describe("the word for an account's import rhythm", () => {
	it('reads the median gap between imports', () => {
		expect(cadenceWord(['2026-01-05', '2026-02-06', '2026-03-04', '2026-04-07'])).toBe('monthly');
		expect(cadenceWord(['2025-01-10', '2025-04-12', '2025-07-09', '2025-10-11'])).toBe('quarterly');
		expect(cadenceWord(['2024-03-01', '2025-03-03', '2026-03-02'])).toBe('yearly');
	});
	it('names nothing before three imports', () => {
		expect(cadenceWord(['2026-01-05', '2026-02-06'])).toBeNull();
		expect(cadenceWord([])).toBeNull();
	});
});
