// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The hand migration from 0.6.2 to the documents-v2 schema.
 *
 *   node scripts/upgrade-documents-v2.mjs        reads DATABASE_URL
 *
 * Continuum keeps ONE baseline: `drizzle/` describes the schema as it is, not
 * how it got here, and a running instance is upgraded by hand. This file is
 * that hand — the same statements a fresh install gets from the baseline, in
 * the order an instance with data can take them.
 *
 * Run it BEFORE the 0.7.0 image serves traffic. The old code cannot read the
 * new shape and the new code cannot read the old one.
 *
 * Everything is one transaction and everything is idempotent: a second run
 * finds the columns present, the shelves seeded and nothing left unfiled, and
 * changes nothing. That is asserted in `tests/integration/upgrade-documents-v2`,
 * which runs these very statements rather than a copy of them.
 */

/** The ten shelves a fresh install seeds. Key and sort order are the contract. */
const SHELVES = [
	['inbox', 'Inbox', '📬', 0, true],
	['identity', 'Identity', '🪪', 10, false],
	['family', 'Family', '👶', 20, false],
	['health', 'Health', '🩺', 30, false],
	['property', 'Property', '🏠', 40, false],
	['tenancy', 'Tenancy', '🔑', 50, false],
	['vehicles', 'Vehicles', '🚗', 60, false],
	['finance', 'Finance', '🏦', 70, false],
	['household', 'Household', '🔧', 80, false],
	['statements', 'Statements', '🧾', 90, true]
];

/**
 * Old shelf value → the shelf it becomes and the type it gains.
 *
 * `payslips`, `tax` and `loans` stop being places and become kinds of paper:
 * the salary tracker reads `type='payslip'` now, so a household renaming or
 * merging the finance shelf cannot unhook it. `insurance` is absent because it
 * cannot be answered by a table — see below.
 */
const SHELF_MAP = [
	['payslips', 'finance', 'payslip'],
	['tax', 'finance', 'tax_document'],
	['identity', 'identity', 'id_document'],
	['family', 'family', 'other'],
	['health', 'health', 'medical_record'],
	['property', 'property', 'other'],
	['tenancy', 'tenancy', 'contract'],
	['loans', 'finance', 'contract'],
	['statements', 'statements', 'bank_statement']
];

/**
 * A subject that reads as a vehicle, for the insurance split.
 *
 * There is no vehicle entity kind, so the only signal available is what the
 * household called the subject. The list is deliberately small and the miss is
 * deliberately safe: anything it does not match goes to the inbox with a tag,
 * where a person decides in one click. Guessing wrong silently is the outcome
 * worth avoiding, not guessing less often.
 */
const VEHICLE_WORDS = ['car', 'auto', 'vehicle', 'motorbike', 'motorcycle', 'bike', 'van'];

/**
 * @param {import('postgres').Sql} sql a client for the database to upgrade
 * @returns {Promise<void>}
 */
export async function upgradeDocumentsV2(sql) {
	await sql.begin(async (/** @type {import('postgres').TransactionSql} */ tx) => {
		// ---- 1. The shelf table and its ten rows ----
		await tx`
			create table if not exists shelf (
				id uuid primary key,
				key text not null unique,
				label text not null,
				emoji text not null default '🗂️',
				sort_order integer not null default 0,
				system boolean not null default false,
				created_at timestamp with time zone not null default now()
			)`;
		for (const [key, label, emoji, sortOrder, system] of SHELVES) {
			await tx`
				insert into shelf (id, key, label, emoji, sort_order, system)
				values (gen_random_uuid(), ${key}, ${label}, ${emoji}, ${sortOrder}, ${system})
				on conflict (key) do nothing`;
		}

		// ---- 2. The new document columns, nullable until every row has one ----
		await tx`alter table document add column if not exists shelf_id uuid`;
		await tx`alter table document add column if not exists type text not null default 'other'`;
		await tx`alter table document add column if not exists note text`;
		await tx`
			alter table document add column if not exists sensitivity text not null default 'normal'`;

		// ---- 3-5. Map the old shelf, once, while the column still exists ----
		const [oldColumn] = await tx`
			select 1 from information_schema.columns
			where table_schema = 'public' and table_name = 'document' and column_name = 'shelf'`;
		if (oldColumn) {
			for (const [old, key, type] of SHELF_MAP) {
				await tx`
					update document set shelf_id = (select id from shelf where key = ${key}), type = ${type}
					where shelf = ${old} and shelf_id is null`;
			}

			// The insurance rule: a policy is filed by what it insures. A link to a
			// property files it under property; a subject that reads as a vehicle
			// under vehicles; a person under health. Everything else lands in the
			// inbox carrying `insurance`, because a wrong shelf nobody reviews is
			// worse than an unfiled one somebody does.
			await tx`
				update document d set type = 'insurance_policy' where d.shelf = 'insurance'`;
			await tx`
				update document d set shelf_id = (select id from shelf where key = 'property')
				where d.shelf = 'insurance' and d.shelf_id is null and exists (
					select 1 from document_link dl join property p on p.id = dl.target_id
					where dl.document_id = d.id)`;
			await tx`
				update document d set shelf_id = (select id from shelf where key = 'vehicles')
				where d.shelf = 'insurance' and d.shelf_id is null and exists (
					select 1 from document_link dl join subject s on s.id = dl.target_id
					where dl.document_id = d.id
					  and lower(s.name) ~ ${`(${VEHICLE_WORDS.join('|')})`})`;
			await tx`
				update document d set shelf_id = (select id from shelf where key = 'health')
				where d.shelf = 'insurance' and d.shelf_id is null and exists (
					select 1 from document_link dl join person p on p.id = dl.target_id
					where dl.document_id = d.id)`;

			const unplaceable = await tx`
				select id from document where shelf = 'insurance' and shelf_id is null`;
			if (unplaceable.length > 0) {
				await tx`
					insert into tag (id, name, normalised_name)
					values (gen_random_uuid(), 'insurance', 'insurance')
					on conflict (normalised_name) do nothing`;
				await tx`
					insert into tag_link (tag_id, target_id)
					select (select id from tag where normalised_name = 'insurance'), d.id
					from document d where d.shelf = 'insurance' and d.shelf_id is null
					on conflict do nothing`;
				await tx`
					update document set shelf_id = (select id from shelf where key = 'inbox')
					where shelf = 'insurance' and shelf_id is null`;
			}

			// A shelf value no release ever wrote, or one this map has forgotten:
			// the inbox is where a person can see it, not a silent default.
			await tx`
				update document set shelf_id = (select id from shelf where key = 'inbox')
				where shelf_id is null`;
		}

		// ---- 6. Now every row has a shelf, so the column can promise one ----
		await tx`alter table document alter column shelf_id set not null`;
		const [fk] = await tx`
			select 1 from pg_constraint where conname = 'document_shelf_id_shelf_id_fk'`;
		if (!fk) {
			// RESTRICT, not CASCADE: deleting a shelf must never delete the paper.
			await tx`
				alter table document add constraint document_shelf_id_shelf_id_fk
				foreign key (shelf_id) references shelf(id) on delete restrict`;
		}
		await tx`create index if not exists document_shelf_id_idx on document (shelf_id)`;
		await tx`create index if not exists document_type_idx on document (type)`;

		// ---- 7. Subject lifecycle ----
		await tx`alter table subject add column if not exists archived_at timestamp with time zone`;
		await tx`alter table subject add column if not exists active_from date`;
		await tx`alter table subject add column if not exists active_to date`;
		const [period] = await tx`
			select 1 from pg_constraint where conname = 'subject_active_period_check'`;
		if (!period) {
			await tx`
				alter table subject add constraint subject_active_period_check
				check (active_from is null or active_to is null or active_from <= active_to)`;
		}

		// ---- 8. Extracted text, and the indexes the search reads ----
		await tx`
			create table if not exists document_text (
				document_id uuid primary key references document(id) on delete cascade,
				engine text not null,
				engine_version text not null,
				languages text not null,
				mean_confidence real,
				extracted_at timestamp with time zone not null default now(),
				complete boolean not null default true,
				pages_extracted integer
			)`;
		await tx`
			create table if not exists document_text_chunk (
				document_id uuid not null references document_text(document_id) on delete cascade,
				ordinal integer not null,
				page_no integer,
				source text not null,
				text text not null,
				constraint document_text_chunk_document_id_ordinal_pk primary key (document_id, ordinal)
			)`;
		await tx`create index if not exists dtc_document_idx on document_text_chunk (document_id)`;
		await tx`create extension if not exists pg_trgm`;
		// Folded with the SAME expression the query uses, or the planner ignores
		// the index and nothing says so.
		await tx`
			create index if not exists dtc_fts_idx on document_text_chunk
			using gin (to_tsvector('simple', public.contact_fold(text)))`;
		await tx`
			create index if not exists dtc_trgm_idx on document_text_chunk
			using gin (public.contact_fold(text) gin_trgm_ops)`;
		await tx`
			create index if not exists document_name_trgm_idx on document
			using gin (public.contact_fold(name) gin_trgm_ops)`;

		// ---- 9. The old shelf column, and the CHECK that constrained it ----
		await tx`alter table document drop constraint if exists document_shelf_check`;
		await tx`drop index if exists document_shelf_idx`;
		await tx`alter table document drop column if exists shelf`;

		// ---- 10. The CHECKs the new columns carry ----
		const checks = [
			[
				'document_type_check',
				`alter table document add constraint document_type_check check (type in (
					'contract', 'invoice', 'receipt', 'payslip', 'bank_statement', 'insurance_policy',
					'claim', 'id_document', 'certificate', 'medical_record', 'tax_document',
					'technical_plan', 'correspondence', 'warranty', 'manual', 'other'))`
			],
			[
				'document_sensitivity_check',
				`alter table document add constraint document_sensitivity_check
					check (sensitivity in ('normal', 'restricted'))`
			],
			[
				'document_text_chunk_source_check',
				`alter table document_text_chunk add constraint document_text_chunk_source_check
					check (source in ('text_layer', 'ocr', 'plain'))`
			],
			[
				'job_kind_check',
				// Dropped and re-added: the old one predates `extract_text`, and a
				// queue that cannot hold an extraction job silently never runs one.
				`alter table job add constraint job_kind_check
					check (kind in ('import', 'calendar_sync', 'extract_text'))`
			]
		];
		for (const [name, statement] of checks) {
			if (name === 'job_kind_check')
				await tx`alter table job drop constraint if exists job_kind_check`;
			const [present] = await tx`select 1 from pg_constraint where conname = ${name}`;
			if (!present) await tx.unsafe(statement);
		}

		// ---- 11. Queue what is already filed for reading ----
		//
		// After the CHECKs, not before them: `job_kind_check` does not accept
		// `extract_text` until step 10 widens it, and a queue insert above that
		// line is refused by the constraint the same statement is about to fix.
		//
		// Without this an upgraded instance has a search that works and an
		// archive with nothing in it to find: every document filed before 0.7.0
		// has a file and no text. One job per document, claimed one at a time by
		// the same single CPU slot statement imports use, so a backlog of six
		// hundred scans is read over the following hours rather than all at once.
		await tx`
			insert into job (id, kind, subject_id)
			select gen_random_uuid()::text, 'extract_text', d.id
			from document d
			where d.stored_name is not null
			  and lower(d.ext) in ('pdf','jpg','jpeg','png','webp','heic','heif','txt','csv','md')
			  and not exists (select 1 from document_text t where t.document_id = d.id)
			  and not exists (
			      select 1 from job j
			      where j.kind = 'extract_text' and j.subject_id = d.id
			        and j.state in ('queued', 'running'))`;
	});
}

// Only when run directly. Importing this file — the test does — must not open a
// connection or read the environment.
if (import.meta.url === `file://${process.argv[1]}`) {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}
	const { default: postgres } = await import('postgres');
	const sql = postgres(url, { max: 1 });
	try {
		await upgradeDocumentsV2(sql);
		console.log('documents-v2: upgrade complete.');
	} finally {
		await sql.end();
	}
}
