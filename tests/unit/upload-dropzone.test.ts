// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

describe('the upload dropzone as a control', () => {
	const css = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');

	it('does not run the callback twice for one drop', () => {
		// `adopt` fires the change event that runs `receive`; calling `receive`
		// from the drop handler as well would upload the same file twice.
		const dropHandler = css.slice(css.indexOf('ondrop='), css.indexOf('ondrop=') + 600);
		expect(dropHandler).not.toMatch(/receive\(/);
	});
});
