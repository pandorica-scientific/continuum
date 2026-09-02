import { rowId } from '../row-id';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * Three link tables where there were thirteen.
 *
 * Ten of the thirteen were pure fan-out from three connectors — `tag` reached
 * five tables, `document` four, `contact` four — so a new module cost three link
 * tables before it held a column of its own. Pointing them all at `entity`
 * collapses that to one table per connector, and both ends still keep a real
 * foreign key and a working cascade.
 *
 * Three rather than one `entity_link` with a `relation` column, because each
 * connector will want columns of its own within a year — a note on why a contact
 * is attached, a sort order for filed documents — and a shared table has nowhere
 * to put them.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('link-tables', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

const tag = (id: string, name: string) =>
	harness.sql`insert into tag (id, name, normalised_name) values (${id}, ${name}, ${name})`;
const property = (id: string) =>
	harness.sql`insert into property (id, name, kind) values (${id}, 'Flat', 'lived')`;
const document = (id: string) =>
	harness.sql`insert into document (id, name, shelf_id, type, added_on)
		values (${id}, 'Lease', (select id from shelf where key = 'property'), 'contract', '2026-01-01')`;
const person = (id: string) =>
	harness.sql`insert into person (id, name, initials) values (${id}, 'Jana', 'J')`;

describe('one tag table for every kind of record', () => {
	it('links a tag to records of different kinds through the same table', async () => {
		await tag(rowId('g-1'), 'renovation');
		await property(rowId('pr-1'));
		await document(rowId('d-1'));
		await harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-1')}, ${rowId('pr-1')}), (${rowId('g-1')}, ${rowId('d-1')})`;

		const rows = await harness.sql<{ kind: string }[]>`
			select e.kind from tag_link l join entity e on e.id = l.target_id
			where l.tag_id = ${rowId('g-1')} order by e.kind`;
		expect(rows.map((r) => r.kind)).toEqual(['document', 'property']);
	});

	it('refuses a target that is not a record at all', async () => {
		await tag(rowId('g-2'), 'holiday');
		await expect(
			harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-2')}, ${rowId('no-such-thing')})`
		).rejects.toThrow(/foreign key|violates/i);
	});

	it('drops the link when the target goes', async () => {
		await tag(rowId('g-3'), 'car');
		await property(rowId('pr-2'));
		await harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-3')}, ${rowId('pr-2')})`;
		await harness.sql`delete from property where id = ${rowId('pr-2')}`;
		expect(await harness.sql`select 1 from tag_link where tag_id = ${rowId('g-3')}`).toHaveLength(
			0
		);
	});

	it('drops the link when the tag goes', async () => {
		await tag(rowId('g-4'), 'garden');
		await property(rowId('pr-3'));
		await harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-4')}, ${rowId('pr-3')})`;
		await harness.sql`delete from tag where id = ${rowId('g-4')}`;
		expect(await harness.sql`select 1 from tag_link where tag_id = ${rowId('g-4')}`).toHaveLength(
			0
		);
	});

	it('cannot hold the same pair twice', async () => {
		await tag(rowId('g-5'), 'twice');
		await property(rowId('pr-4'));
		await harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-5')}, ${rowId('pr-4')})`;
		await expect(
			harness.sql`insert into tag_link (tag_id, target_id) values (${rowId('g-5')}, ${rowId('pr-4')})`
		).rejects.toThrow(/duplicate key|violates/i);
	});
});

describe('documents and contacts link the same way', () => {
	it('files one document against records of several kinds', async () => {
		await document(rowId('d-2'));
		await person(rowId('p-1'));
		await property(rowId('pr-5'));
		await harness.sql`insert into document_link (document_id, target_id)
			values (${rowId('d-2')}, ${rowId('p-1')}), (${rowId('d-2')}, ${rowId('pr-5')})`;
		const rows = await harness.sql<{ kind: string }[]>`
			select e.kind from document_link l join entity e on e.id = l.target_id
			where l.document_id = ${rowId('d-2')} order by e.kind`;
		expect(rows.map((r) => r.kind)).toEqual(['person', 'property']);
	});

	it('attaches a contact to a property and an account', async () => {
		await harness.sql`insert into contact (id, name) values (${rowId('c-1')}, 'Plumber')`;
		await property(rowId('pr-6'));
		await harness.sql`insert into account (id, name, bank, currency)
			values (${rowId('a-1')}, 'Current', 'other', 'CZK')`;
		await harness.sql`insert into contact_link (contact_id, target_id)
			values (${rowId('c-1')}, ${rowId('pr-6')}), (${rowId('c-1')}, ${rowId('a-1')})`;
		const rows = await harness.sql<{ kind: string }[]>`
			select e.kind from contact_link l join entity e on e.id = l.target_id
			where l.contact_id = ${rowId('c-1')} order by e.kind`;
		expect(rows.map((r) => r.kind)).toEqual(['account', 'property']);
	});
});

describe('the tables they replace', () => {
	it('are gone', async () => {
		const rows = await harness.sql<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public' and tablename in (
				'document_person', 'document_property', 'document_account', 'document_subject',
				'document_tag', 'property_tag', 'loan_tag', 'transaction_tag',
				'transaction_split_tag', 'contact_tenancy', 'contact_property',
				'contact_loan', 'contact_account')`;
		expect(rows.map((r) => r.tablename)).toEqual([]);
	});

	it('leave the two that are domain relations rather than links', async () => {
		// loan_property carries `share_pct`; rule_tag is a rule's OUTPUT — the tags
		// it applies when it matches — not a tag attached to a rule. Neither is
		// fan-out, so neither collapses.
		const rows = await harness.sql<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public'
			  and tablename in ('loan_property', 'rule_tag') order by tablename`;
		expect(rows.map((r) => r.tablename)).toEqual(['loan_property', 'rule_tag']);
	});
});
