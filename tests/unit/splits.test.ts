import { describe, expect, it } from 'vitest';
import { validateSplits } from '$lib/server/splits';

const line = (amountMinor: bigint, categoryId: string | null = 'groceries') => ({
	amountMinor,
	categoryId
});

describe('validateSplits', () => {
	it('accepts lines that sum exactly to the transaction amount', () => {
		expect(validateSplits(-4550n, [line(-3000n), line(-1550n)])).toEqual({ ok: true });
	});

	it('rejects lines that do not sum to the transaction amount', () => {
		const result = validateSplits(-4550n, [line(-3000n), line(-1000n)]);
		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects a single line, which is not a split', () => {
		expect(validateSplits(-4550n, [line(-4550n)]).ok).toBe(false);
	});

	it('rejects a line whose sign differs from the transaction', () => {
		expect(validateSplits(-4550n, [line(-5000n), line(450n)]).ok).toBe(false);
	});

	it('rejects a zero-amount line', () => {
		expect(validateSplits(-4550n, [line(-4550n), line(0n)]).ok).toBe(false);
	});

	it('accepts an empty list, which means "remove the splits"', () => {
		expect(validateSplits(-4550n, [])).toEqual({ ok: true });
	});

	it('accepts a money-in transaction split into positive lines', () => {
		expect(validateSplits(32892n, [line(20000n), line(12892n)])).toEqual({ ok: true });
	});
});
