// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { defaultFilename } from '$lib/scan/core/naming';

describe('defaultFilename', () => {
	it('dates the file, from a timestamp rather than a clock', () => {
		expect(defaultFilename(Date.UTC(2026, 7, 26, 9, 30))).toBe('Scan 2026-08-26');
	});
});
