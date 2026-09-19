// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The half of the schema drizzle-kit cannot write, assembled in order.
 *
 * drizzle-kit models tables, columns, indexes and foreign keys, and nothing
 * else — triggers, generated columns, CHECK constraints, expression indexes,
 * the `net_worth_component` view and seed rows are all invisible to it.
 *
 * Each block sits beside the tables it constrains; `scripts/compose-baseline.mjs`
 * collects them into `drizzle/0000_baseline.sql`, a build artefact nothing
 * edits by hand, and `tests/unit/baseline-composition.test.ts` fails if the
 * two ever disagree.
 */
import { ENUMS, ENUM_COLUMNS, checkName } from '../../../enums';
import { authSql } from './auth';
import { accountsSeedSql, transactionEffectiveOnSql, transferPairSql } from './accounts';
import { contactFoldSql, contactsSql } from './contacts';
import { documentsCheckSql, documentsIndexSql, documentsSeedSql } from './documents';
import { entitySql } from './entity';
import { organisationsCheckSql } from './organisations';
import { taxCheckSql } from './tax';
import { investmentsSql } from './investments';
import { lifeCheckSql, lifeIndexSql, lifeSeedSql } from './life';
import { moneySeedSql } from './money';

/**
 * gen_random_uuid() and digest() for ids and fingerprints; diacritic folding for
 * contact and document search; trigram matching for identifiers a text-search
 * configuration does not treat as words.
 *
 * The statement-breakpoint markers around these are load-bearing, not
 * formatting. Drizzle splits a migration on them and sends each part
 * separately; without them the whole file arrives as one batch and CREATE
 * FUNCTION is parsed before CREATE EXTENSION has taken effect. That fails with
 * "text search dictionary unaccent does not exist" — on a fresh database only,
 * which is the one place nobody tests before shipping.
 */
const extensionsSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`;

/**
 * A CHECK for every closed set of column values, written from the lists
 * themselves — the same list types the Drizzle column, builds what the
 * screens offer, and writes the constraint, so nothing can drift.
 *
 * PostgreSQL ENUM types were rejected: a value cannot be dropped or reordered
 * without recreating the type and every column using it. A CHECK is one DROP
 * and one ADD, which is what an additive-only schema needs.
 *
 * Nullable columns need no special handling: `col in (...)` is NULL for a
 * NULL input, and a CHECK accepts anything that is not false.
 */
function enumChecksSql(): string {
	const statements = ENUM_COLUMNS.map(({ table, column, enum: key }) => {
		const values = (ENUMS[key] as readonly string[]).map((value) => `'${value}'`).join(', ');
		return `ALTER TABLE ${table} ADD CONSTRAINT ${checkName(table, column)}\n\tCHECK (${column} in (${values}));`;
	});
	return `\n${statements.join('\n--> statement-breakpoint\n')}\n`;
}

/**
 * Every valued thing, in one place, with the liabilities-are-negative rule
 * applied exactly once rather than in each caller that has to remember it.
 *
 * Adding an asset type is one table plus one UNION branch here.
 *
 * `subkind` carries the row's own kind — an account is `current` or
 * `brokerage`, a property `lived` or `rented` — because callers have rules
 * that turn on it (e.g. a brokerage balance isn't counted as cash).
 *
 * Amounts stay in each row's own currency: the view knows nothing about
 * rates, so the caller converts row by row.
 */
const netWorthSql = `
CREATE VIEW net_worth_component AS
	SELECT id, 'property'::text AS kind, kind::text AS subkind, owner_person_id,
	       currency, value_minor, valued_on
	  FROM property
	UNION ALL
	-- A closed account is not money you have. Its transactions stay in the
	-- ledger and in cash-flow history; only the balance leaves.
	SELECT id, 'account', kind::text, owner_person_id,
	       currency, balance_minor, balance_on
	  FROM account
	 WHERE archived_at IS NULL
	UNION ALL
	SELECT id, 'loan', kind::text, owner_person_id,
	       currency, -owed_minor, owed_on
	  FROM loan
	UNION ALL
	SELECT id, 'holding', category, NULL,
	       currency, value_minor, valued_at::date
	  FROM holding
	UNION ALL
	-- Still held: delivered (or scheduled) less sold, less moved to a broker
	-- whose report already counts them under 'holding'.
	SELECT t.id, 'equity', 'rsu', g.person_id,
	       p.currency,
	       round((coalesce(t.delivered_units, t.units) - t.sold_units - t.moved_units) * p.close_minor)::bigint,
	       p.day
	  FROM equity_tranche t
	  JOIN equity_grant g ON g.id = t.grant_id
	  JOIN LATERAL (
	    SELECT close_minor, currency, day FROM security_price sp
	     WHERE sp.ticker = g.ticker ORDER BY sp.day DESC LIMIT 1
	  ) p ON true
	 WHERE t.forfeited_on IS NULL
	   AND (t.settled_on IS NOT NULL OR t.vests_on <= current_date)
	   AND (coalesce(t.delivered_units, t.units) - t.sold_units - t.moved_units) > 0;
`;

/**
 * Blocks of one section, separated the way Drizzle's migrator needs.
 *
 * It splits a migration on `--> statement-breakpoint` and sends each part
 * separately. Two statements arriving in one batch is not merely untidy: a
 * CREATE FUNCTION parsed in the same batch as the CREATE EXTENSION it depends on
 * fails, and only on a fresh database.
 */
const join = (blocks: string[]): string =>
	`\n${blocks.map((block) => block.trim()).join('\n--> statement-breakpoint\n')}\n`;

/** One section of the appendix: a heading for the reader, and its statements. */
export interface BaselineSection {
	title: string;
	sql: string;
}

/**
 * Ordered, because the order is the correctness.
 *
 * Extensions before the functions that call them; functions before the indexes
 * and triggers built on them; every constraint before the seed rows that have to
 * satisfy it; the entity supertype after its CHECK, since the loop adds foreign
 * keys into a table the CHECK constrains.
 */
export const BASELINE_SECTIONS: BaselineSection[] = [
	{ title: 'Extensions', sql: extensionsSql },
	{ title: 'Folding diacritics for search', sql: contactFoldSql },
	{ title: 'Contact search', sql: contactsSql },
	{ title: 'Document search', sql: documentsIndexSql },
	{ title: 'The date a movement is read on', sql: transactionEffectiveOnSql },
	{ title: 'Transfer pair legs', sql: transferPairSql },
	{ title: 'Enum CHECK constraints', sql: enumChecksSql() },
	{
		title: 'Singletons and shapes',
		sql: join([
			authSql,
			investmentsSql,
			documentsCheckSql,
			organisationsCheckSql,
			lifeCheckSql,
			taxCheckSql
		])
	},
	{ title: 'One visit per trip destination', sql: lifeIndexSql },
	{ title: 'The entity supertype', sql: entitySql },
	{ title: 'The net-worth contract', sql: netWorthSql },
	{
		title: 'Seed rows',
		sql: join([moneySeedSql, accountsSeedSql, documentsSeedSql, lifeSeedSql])
	}
];
