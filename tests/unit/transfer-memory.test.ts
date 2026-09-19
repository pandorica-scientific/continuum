// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { recallDestination, type PastDecision } from '$lib/import/transfer-memory';

const decision = (over: Partial<PastDecision>): PastDecision => ({
	accountId: 'cs',
	counterpartyAccount: null,
	toAccountId: 'revolut',
	untracked: false,
	bookedOn: '2026-01-01',
	...over
});

describe('remembering where a one-sided transfer went', () => {
	it('answers nothing when nothing was ever answered', () => {
		expect(recallDestination({ accountId: 'cs' }, [])).toBeNull();
	});

	describe('when the destination account number identifies the payee', () => {
		it('carries the previous answer over, and calls it certain', () => {
			const past = [decision({ counterpartyAccount: '123/0800', toAccountId: 'savings' })];
			expect(recallDestination({ accountId: 'cs', counterpartyAccount: '123/0800' }, past)).toEqual(
				{
					toAccountId: 'savings',
					untracked: false,
					certain: true
				}
			);
		});

		it('matches even from a different source account', () => {
			// The payee is the payee. Which of your accounts the money left from
			// does not change where it landed.
			const past = [
				decision({ accountId: 'fio', counterpartyAccount: '123/0800', toAccountId: 'savings' })
			];
			expect(
				recallDestination({ accountId: 'cs', counterpartyAccount: '123/0800' }, past)
			).toMatchObject({ toAccountId: 'savings', certain: true });
		});

		it('prefers the most-repeated answer over the most recent one', () => {
			// One mistake among many correct answers must not become the default.
			const at = (toAccountId: string, bookedOn: string) =>
				decision({ counterpartyAccount: '123/0800', toAccountId, bookedOn });
			const past = [
				at('savings', '2026-01-01'),
				at('savings', '2026-02-01'),
				at('savings', '2026-03-01'),
				at('revolut', '2026-08-01')
			];
			expect(
				recallDestination({ accountId: 'cs', counterpartyAccount: '123/0800' }, past)?.toAccountId
			).toBe('savings');
		});

		it('breaks a tie on count with the newer answer', () => {
			const at = (toAccountId: string, bookedOn: string) =>
				decision({ counterpartyAccount: '123/0800', toAccountId, bookedOn });
			const past = [at('savings', '2026-01-01'), at('revolut', '2026-08-01')];
			expect(
				recallDestination({ accountId: 'cs', counterpartyAccount: '123/0800' }, past)?.toAccountId
			).toBe('revolut');
		});

		it('remembers "closed or not tracked" HERE, because the number identifies it', () => {
			const past = [
				decision({ counterpartyAccount: '99/0100', toAccountId: null, untracked: true }),
				decision({ counterpartyAccount: '99/0100', toAccountId: null, untracked: true })
			];
			expect(recallDestination({ accountId: 'cs', counterpartyAccount: '99/0100' }, past)).toEqual({
				toAccountId: null,
				untracked: true,
				certain: true
			});
		});

		it('does not confuse an account id with the untracked answer', () => {
			// Both tally under their own prefix, so two untracked answers beat one
			// named account rather than merging with it.
			const at = (over: Partial<PastDecision>) =>
				decision({ counterpartyAccount: '99/0100', ...over });
			const past = [
				at({ toAccountId: null, untracked: true, bookedOn: '2026-01-01' }),
				at({ toAccountId: null, untracked: true, bookedOn: '2026-02-01' }),
				at({ toAccountId: 'revolut', bookedOn: '2026-03-01' })
			];
			expect(
				recallDestination({ accountId: 'cs', counterpartyAccount: '99/0100' }, past)
			).toMatchObject({ untracked: true });
		});

		it('treats a blank destination number as no number, not as a match', () => {
			// Two unrelated rows both printing an empty counterparty account would
			// otherwise "identify" each other.
			const past = [decision({ counterpartyAccount: '  ', toAccountId: 'savings' })];
			expect(recallDestination({ accountId: 'cs', counterpartyAccount: '   ' }, past)).toBeNull();
		});
	});

	describe('when only the source account matches, which is a habit and not a match', () => {
		it('preselects an account this one has always been moved to', () => {
			const past = [
				decision({ toAccountId: 'revolut', bookedOn: '2026-01-01' }),
				decision({ toAccountId: 'revolut', bookedOn: '2026-02-01' })
			];
			expect(
				recallDestination({ accountId: 'cs', counterpartyAccount: 'unseen/0100' }, past)
			).toEqual({ toAccountId: 'revolut', untracked: false, certain: false });
		});

		it('refuses to guess from a single past answer', () => {
			const past = [decision({ toAccountId: 'revolut' })];
			expect(recallDestination({ accountId: 'cs' }, past)).toBeNull();
		});

		it('refuses to guess when the history is split', () => {
			// "Sometimes savings, sometimes Revolut" is not a habit. Preselecting
			// the more frequent half of it puts a wrong account in front of
			// somebody on every row, which is worse than asking.
			const past = [
				decision({ toAccountId: 'savings' }),
				decision({ toAccountId: 'savings' }),
				decision({ toAccountId: 'revolut' })
			];
			expect(recallDestination({ accountId: 'cs' }, past)).toBeNull();
		});

		it('NEVER guesses "closed or not tracked" from habit alone', () => {
			// The one answer nothing can ever corroborate. Every other can be —
			// the real second leg may still arrive — so this one is offered only
			// when the destination number identifies it, never because of what
			// this account tends to do.
			const past = [
				decision({ toAccountId: null, untracked: true }),
				decision({ toAccountId: null, untracked: true }),
				decision({ toAccountId: null, untracked: true })
			];
			expect(recallDestination({ accountId: 'cs' }, past)).toBeNull();
		});

		it('ignores a past row that named no destination at all', () => {
			const past = [
				decision({ toAccountId: null, untracked: false }),
				decision({ toAccountId: null, untracked: false })
			];
			expect(recallDestination({ accountId: 'cs' }, past)).toBeNull();
		});

		it('does not borrow another account’s habit', () => {
			const past = [
				decision({ accountId: 'fio', toAccountId: 'savings' }),
				decision({ accountId: 'fio', toAccountId: 'savings' })
			];
			expect(recallDestination({ accountId: 'cs' }, past)).toBeNull();
		});
	});
});
