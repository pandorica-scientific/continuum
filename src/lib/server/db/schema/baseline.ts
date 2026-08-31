// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The half of the schema drizzle-kit cannot write, assembled in order.
 *
 * drizzle-kit models tables, columns, indexes and foreign keys, and nothing
 * else. Triggers, generated columns, CHECK constraints, expression indexes, the
 * `net_worth_component` view and the seed rows a foreign key needs to be
 * satisfiable are all invisible to it — so `db:generate` cannot notice any of
 * them going missing, and a database built with `drizzle-kit push` would have
 * the tables without the integrity they depend on.
 *
 * They used to live only as hand-written SQL appended to `0000_baseline.sql`,
 * which made the schema two sources of truth that nothing reconciled: adding an
 * entity kind meant three coordinated edits in two languages, and only one of
 * the three was held by a test. Now each block sits beside the tables it
 * constrains, `scripts/compose-baseline.mjs` collects them into the migration,
 * and `tests/unit/baseline-composition.test.ts` fails if the committed file and
 * these modules ever disagree. `drizzle/0000_baseline.sql` is a build artefact;
 * nothing edits it by hand.
 *
 * The two lists that used to be repeated in SQL — the enum CHECK constraints and
 * the entity kinds — are now GENERATED from `$lib/enums`, which is what makes
 * "one source of truth" a fact rather than an intention.
 */
import { ENUMS, ENUM_COLUMNS, checkName } from '../../../enums';
import { authSql } from './auth';
import { accountsSeedSql, transactionEffectiveOnSql, transferPairSql } from './accounts';
import { contactFoldSql, contactsSql } from './contacts';
import { documentsCheckSql, documentsIndexSql, documentsSeedSql } from './documents';
import { entitySql } from './entity';
import { investmentsSql } from './investments';
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
 * themselves.
 *
 * Twenty-one columns once held their permitted values only in a comment beside
 * the declaration, and the comments had already drifted: `transaction.review_state`
 * documented three states while the code wrote four, and `document.shelf`
 * documented eight shelves while the app offered nine. Nothing compared them, so
 * nothing noticed. Then the lists moved to `$lib/enums` and were copied a third
 * time into hand-written SQL, which is the same failure one step further along.
 *
 * Generating them closes it: the list is used to type the Drizzle column, to
 * build what the screens offer, and — here — to write the constraint, from one
 * declaration. `tests/integration/schema-invariants.test.ts` still reads
 * pg_constraint and compares, so a database that drifted from the file is caught
 * as well.
 *
 * PostgreSQL ENUM types were rejected: a value cannot be dropped or reordered
 * without recreating the type and every column using it. A CHECK is one DROP and
 * one ADD, which is what an additive-only schema needs.
 *
 * Nullable columns need no special handling: `col in (...)` is NULL for a NULL
 * input, and a CHECK accepts anything that is not false.
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
 * Adding an asset type is one table plus one UNION branch here. Net-worth code
 * reads the view and sums whatever it finds, so "forgot to include vehicles in
 * net worth" stops being a vigilance problem: the branch is the only edit.
 *
 * `subkind` carries the row's own kind — an account is `current` or `brokerage`,
 * a property `lived` or `rented` — because the caller has rules that turn on it
 * (a brokerage balance is reported by the broker, not counted as cash) and it
 * would otherwise need a second query per table, which is the coupling the view
 * exists to remove.
 *
 * Amounts stay in each row's own currency: this view knows nothing about rates,
 * so summing it across currencies is only meaningful when they agree. The caller
 * converts row by row. It belongs to no single domain, which is why it is here
 * and not beside one of the four tables it reads.
 */
const netWorthSql = `
CREATE VIEW net_worth_component AS
	SELECT id, 'property'::text AS kind, kind::text AS subkind, owner_person_id,
	       currency, value_minor, valued_on
	  FROM property
	UNION ALL
	SELECT id, 'account', kind::text, owner_person_id,
	       currency, balance_minor, balance_on
	  FROM account
	UNION ALL
	SELECT id, 'loan', kind::text, owner_person_id,
	       currency, -owed_minor, owed_on
	  FROM loan
	UNION ALL
	SELECT id, 'holding', category, NULL,
	       currency, value_minor, valued_at::date
	  FROM holding;
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
		sql: join([authSql, investmentsSql, documentsCheckSql])
	},
	{ title: 'The entity supertype', sql: entitySql },
	{ title: 'The net-worth contract', sql: netWorthSql },
	{ title: 'Seed rows', sql: join([moneySeedSql, accountsSeedSql, documentsSeedSql]) }
];
