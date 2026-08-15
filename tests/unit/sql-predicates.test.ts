import { and, eq, or, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { transferPair } from '$lib/server/db/schema';

// Drizzle's and() wraps the whole list in one pair of parentheses and never its
// operands, so a raw sql fragment carrying a top-level `or` silently escapes
// the filters beside it. This renders the real predicate through drizzle's own
// dialect rather than reasoning about it.
const dialect = new PgDialect();
const render = (q: unknown) => dialect.sqlToQuery(q as never).sql;

describe('transfer-pair lookup by leg', () => {
	it('a raw or-fragment inside and() loses the state filter on the second leg', () => {
		const raw = and(
			eq(transferPair.state, 'proposed'),
			sql`${transferPair.outTransactionId} = ${'X'} or ${transferPair.inTransactionId} = ${'X'}`
		);
		// (state AND out) OR in — posting any in-leg id matches its pair whatever
		// its state, so confirming one row could resurrect a rejected transfer
		// and null the category the user had filed it under afterwards.
		expect(render(raw)).toBe(
			'("transfer_pair"."state" = $1 and "transfer_pair"."out_transaction_id" = $2 or "transfer_pair"."in_transaction_id" = $3)'
		);
	});

	it('or() parenthesises its own operands, so the state filter covers both legs', () => {
		const fixed = and(
			eq(transferPair.state, 'proposed'),
			or(eq(transferPair.outTransactionId, 'X'), eq(transferPair.inTransactionId, 'X'))
		);
		expect(render(fixed)).toBe(
			'("transfer_pair"."state" = $1 and ("transfer_pair"."out_transaction_id" = $2 or "transfer_pair"."in_transaction_id" = $3))'
		);
	});
});
