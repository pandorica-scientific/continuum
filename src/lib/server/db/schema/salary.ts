// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Salary, from a payslip or from the bank.
 *
 * Until now salary history was assembled entirely from documents on the
 * Payslips shelf, so a salary already sitting in the ledger — categorised as
 * such by whoever imported the statement — was invisible to it, and there was
 * nowhere to persist a correction to a figure the bank supplied.
 */

import {
	bigint,
	boolean,
	date,
	index,
	pgTable,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { account } from './accounts';
import { person } from './auth';
import { currency } from './money';
import { document } from './documents';
import { transaction } from './accounts';

export const salaryEntry = pgTable(
	'salary_entry',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/**
		 * YYYY-MM. One entry per person per month PER PAYSLIP.
		 *
		 * It was one entry per person per month full stop, which is right for one
		 * job and wrong for two: a second employer's slip for the same month
		 * replaced the first rather than joining it, so a month worked twice
		 * reported half its pay. See the indexes below for what now keeps two
		 * statements of the same month apart.
		 */
		periodMonth: text('period_month').notNull(),
		/**
		 * Gross and net are two FIELDS, not two rows.
		 *
		 * A payslip states gross; a bank credit is net. They are not competing
		 * readings of one number, so a month carries both and neither has to win.
		 */
		grossMinor: bigint('gross_minor', { mode: 'bigint' }),
		netMinor: bigint('net_minor', { mode: 'bigint' }),
		/**
		 * The part of gross the payslip itemised as a bonus.
		 *
		 * Gross-side only: a slip itemises what makes up gross, while a bank
		 * credit is one net transfer with no components, so there is no net
		 * bonus to record. Null means the slip did not itemise one, which is a
		 * different statement from a slip saying there was none.
		 */
		bonusMinor: bigint('bonus_minor', { mode: 'bigint' }),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		/** payslip | statement | manual — where the entry came from first. */
		source: text('source').notNull().default('manual'),
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' }),
		transactionId: uuid('transaction_id').references(() => transaction.id, {
			onDelete: 'set null'
		}),
		/** The figure was corrected by hand, so re-reading must not overwrite it. */
		amountOverridden: boolean('amount_overridden').notNull().default(false)
	},
	(table) => [
		/**
		 * A month may be evidenced more than once, and the evidence is what tells
		 * the statements apart.
		 *
		 * One row per payslip DOCUMENT, so two jobs in a month are two rows and
		 * neither overwrites the other — while re-uploading the same slip still
		 * finds its own row and corrects it.
		 */
		uniqueIndex('salary_entry_person_month_doc_key')
			.on(table.personId, table.periodMonth, table.documentId)
			.where(sql`document_id is not null`),
		/**
		 * And exactly one row per month that came from no payslip at all — the
		 * bank credit, or a figure typed by hand. That is the old invariant, kept.
		 * The merge this makes possible is order-dependent, not symmetric: a slip
		 * that arrives after the credit finds this very row and claims it,
		 * filling gross in beside the net that is already there; a credit that
		 * arrives after the slip has no such row to find — a transaction carries
		 * no evidence of which employer paid it — so it opens one of its own here
		 * instead, and the month keeps two rows until something that knows better
		 * corrects it.
		 */
		uniqueIndex('salary_entry_person_month_key')
			.on(table.personId, table.periodMonth)
			.where(sql`document_id is null`),
		index('salary_entry_person_month_idx').on(table.personId, table.periodMonth),
		index('salary_entry_currency_idx').on(table.currency),
		index('salary_entry_document_idx').on(table.documentId),
		index('salary_entry_transaction_idx').on(table.transactionId)
	]
);

/**
 * Whose salary a payment into a JOINT account is.
 *
 * Deliberately not the `rule` table. That engine's payload is `category_id`: it
 * maps a transaction to a category, and adding a person to it would let the
 * categoriser start assigning people. The two fail differently — a
 * miscategorised coffee is a nuisance, a salary attributed to the wrong person
 * corrupts two retirement projections.
 */
export const salaryAttribution = pgTable(
	'salary_attribution',
	{
		id: uuid('id').primaryKey(),
		/** The normalised counterparty — in practice the employer's name. */
		matchKey: text('match_key').notNull(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/** Narrow it to one account, or leave null to mean any. */
		accountId: uuid('account_id').references(() => account.id, { onDelete: 'cascade' }),
		createdOn: date('created_on').notNull().defaultNow()
	},
	(table) => [
		index('salary_attribution_key_idx').on(table.matchKey),
		index('salary_attribution_person_idx').on(table.personId),
		index('salary_attribution_account_idx').on(table.accountId)
	]
);
