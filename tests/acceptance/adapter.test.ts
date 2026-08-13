// Acceptance: the real XTB report routes through the broker-adapter seam.
// Self-skipping when the private samples folder is absent (CI, other machines).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectBroker } from '$lib/server/invest/adapter';
import '$lib/server/invest/xtb';

const DIR = 'bank_data_examples_do_not_share';

describe.skipIf(!existsSync(DIR))('broker adapter acceptance', () => {
	it('detects and parses the real XTB report', () => {
		const name = readdirSync(DIR).find((f) => /\.xlsx$/i.test(f));
		expect(name).toBeTruthy();
		const data = new Uint8Array(readFileSync(`${DIR}/${name}`));
		const adapter = detectBroker(name!, data);
		expect(adapter?.id).toBe('xtb');
		const report = adapter!.parse(data);
		expect(report.operations.length).toBeGreaterThan(0);
		expect(report.accountCurrency).toBe('EUR');
	});
});
