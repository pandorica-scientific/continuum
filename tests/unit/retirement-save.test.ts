import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { actions } from '../../src/routes/(app)/retirement/+page.server';

function saveRequest(overrides: Record<string, string> = {}): Request {
	const form = new FormData();
	for (const [key, value] of Object.entries({
		// The generator the page itself uses. A hand-written literal here is
		// what let a pattern that rejects every real id pass the suite.
		writerId: uuidv7(),
		baseVersion: '0',
		revision: '1',
		spend: '60000',
		swr: '3.5',
		realReturn: '4',
		contributionGrowth: '2',
		propertyGrowth: '2',
		plan: 'keep',
		pensionOne: '18000',
		pensionTwo: '18000',
		ageOne: '68',
		ageTwo: '68',
		...overrides
	})) {
		form.set(key, value);
	}
	return new Request('http://localhost/retirement?/save', { method: 'POST', body: form });
}

describe('retirement save validation', () => {
	it('rejects a missing or nonnumeric assumption instead of silently restoring a default', async () => {
		const result = await actions.save({ request: saveRequest({ realReturn: '' }) } as never);

		expect(result).toMatchObject({ status: 400, data: { message: expect.any(String) } });
	});

	it('rejects out-of-range and fractional-age snapshots before touching storage', async () => {
		const outOfRange = await actions.save({
			request: saveRequest({ contributionGrowth: '100' })
		} as never);
		const fractionalAge = await actions.save({ request: saveRequest({ ageOne: '67.5' }) } as never);

		expect(outOfRange).toMatchObject({ status: 400 });
		expect(fractionalAge).toMatchObject({ status: 400 });
	});

	// The page autosaves, so a refusal has no submit moment to explain itself.
	// One generic line meant an out-of-range age left in the form silently
	// refused every later edit to spending or growth as well.
	it('names the assumption that was refused', async () => {
		const youngAge = await actions.save({ request: saveRequest({ ageOne: '45' }) } as never);
		const growth = await actions.save({
			request: saveRequest({ propertyGrowth: '99' })
		} as never);
		const blank = await actions.save({ request: saveRequest({ spend: '' }) } as never);

		expect(youngAge).toMatchObject({
			status: 400,
			data: { message: expect.stringContaining('Retirement age') }
		});
		expect(growth).toMatchObject({
			status: 400,
			data: { message: expect.stringContaining('Property growth') }
		});
		expect(blank).toMatchObject({
			status: 400,
			data: { message: expect.stringContaining('Monthly spending') }
		});
	});
});
