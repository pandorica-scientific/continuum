// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Finding a document by anything a person is likely to remember about it.
 *
 * A candidate UNION over four tiers rather than a denormalized search column.
 * The alternative — one materialised text column per document, kept current by
 * triggers on every table a document can be linked to — is a fan-out that rots:
 * a tag rename or a flat renamed has to reach every row that mentions it, and
 * the day one of those triggers is missed the search is wrong in a way nothing
 * reports. The UNION pays a few joins per query instead, which is the cheaper
 * mistake by a wide margin at household scale.
 *
 * BOTH SIDES ARE FOLDED THROUGH `public.contact_fold`, and every predicate is
 * written the way the index expression is written. A query that folds even
 * slightly differently gets a sequential scan over every chunk in the archive
 * and nothing says so — the contacts search learned this once already.
 *
 * Tiers: A name or tag · B linked entity, type or shelf label · C note ·
 * D contents. A document appears exactly ONCE, under its best tier, with
 * recency breaking ties.
 */
import { sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import type { Actor } from './visibility';

export type Tier = 'A' | 'B' | 'C' | 'D';

/** Where the match was found, for the row's label. */
export type MatchedIn = 'name' | 'tag' | 'entity' | 'kind' | 'note' | 'contents';

export interface SearchHit {
	documentId: string;
	tier: Tier;
	matchedIn: MatchedIn;
	/** Only a contents hit knows a page, and only when the file has pages. */
	pageNo: number | null;
	snippet: string | null;
}

export interface SearchHonesty {
	/** Documents whose text is still being read. */
	pending: number;
	/** Documents with a file nothing could read — the absence of a row IS this. */
	notSearchable: number;
	/** Matches that exist, but only on archived subjects. */
	archivedOnly: number;
}

export interface SearchOptions {
	includeArchived?: boolean;
	/** Restrict to one shelf, by key. Absent means everything visible. */
	shelfKey?: string;
	limit?: number;
}

/** How much text either side of a hit the snippet carries. */
const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 180;

/**
 * The two halves of the read rule, as SQL fragments over an aliased `document`.
 *
 * Written against an alias rather than reusing `visibility.ts` directly because
 * this query mentions `document` several times over; the RULE is the same one,
 * and the truth table that proves the archive half lives in
 * `tests/integration/archive-scope`.
 */
function readableSql(actor: Actor | null, includeArchived: boolean) {
	const sensitivity = actor?.role === 'admin' ? sql`true` : sql`d.sensitivity = ${'normal'}`;
	const archive = includeArchived
		? sql`true`
		: sql`not (
				exists (
					select 1 from document_link dl join subject s on s.id = dl.target_id
					where dl.document_id = d.id
				)
				and not exists (
					select 1 from document_link dl join subject s on s.id = dl.target_id
					where dl.document_id = d.id and s.archived_at is null
				)
			)`;
	return sql`${sensitivity} and ${archive}`;
}

/**
 * Every candidate, tagged with the tier it matched at.
 *
 * The substring predicate is written EXACTLY as `dtc_trgm_idx` is defined —
 * `public.contact_fold(text) like '%' || public.contact_fold($q) || '%'`. Any
 * other spelling is a sequential scan. `similarity()` is deliberately absent
 * from the ordering: an identifier like a variable symbol is not a fuzzy match,
 * and sorting by similarity buries the exact hit under near misses.
 */
function candidateSql(q: string, actor: Actor | null, options: SearchOptions) {
	const readable = readableSql(actor, options.includeArchived ?? false);
	const shelfFilter = options.shelfKey ? sql`and sh.key = ${options.shelfKey}` : sql``;
	const like = sql`'%' || public.contact_fold(${q}) || '%'`;

	return sql`
		with visible as (
			select d.id, d.name, d.note, d.type, d.added_on, d.shelf_id
			from document d
			join shelf sh on sh.id = d.shelf_id
			where ${readable} ${shelfFilter}
		),
		candidate as (
			select v.id as document_id, 'A' as tier, 'name' as matched_in,
			       null::int as page_no, null::text as snippet
			from visible v
			where public.contact_fold(v.name) like ${like}

			union all
			select v.id, 'A', 'tag', null::int, null::text
			from visible v
			join tag_link tl on tl.target_id = v.id
			join tag t on t.id = tl.tag_id
			where public.contact_fold(t.name) like ${like}

			union all
			select v.id, 'B', 'entity', null::int, null::text
			from visible v
			join document_link dl on dl.document_id = v.id
			join (
				select id, name from person
				union all select id, name from property
				union all select id, name from subject
				union all select id, name from account
			) labelled on labelled.id = dl.target_id
			where public.contact_fold(labelled.name) like ${like}

			union all
			select v.id, 'B', 'kind', null::int, null::text
			from visible v
			join shelf sh on sh.id = v.shelf_id
			where public.contact_fold(sh.label) like ${like}
			   or public.contact_fold(replace(v.type, '_', ' ')) like ${like}

			union all
			select v.id, 'C', 'note', null::int, null::text
			from visible v
			where v.note is not null and public.contact_fold(v.note) like ${like}

			union all
			select v.id, 'D', 'contents', c.page_no,
			       substring(
			           c.text
			           from greatest(1, strpos(public.contact_fold(c.text), public.contact_fold(${q})) - ${SNIPPET_BEFORE})
			           for ${SNIPPET_LENGTH}
			       )
			from visible v
			join document_text_chunk c on c.document_id = v.id
			where public.contact_fold(c.text) like ${like}
			   or to_tsvector('simple', public.contact_fold(c.text))
			      @@ plainto_tsquery('simple', public.contact_fold(${q}))
		),
		best as (
			select distinct on (document_id)
				document_id, tier, matched_in, page_no, snippet
			from candidate
			order by document_id, tier asc, page_no asc nulls first
		)
		select b.document_id, b.tier, b.matched_in, b.page_no, b.snippet
		from best b
		join document d on d.id = b.document_id
		order by b.tier asc, d.added_on desc, d.id desc
		limit ${options.limit ?? 200}
	`;
}

export async function searchDocuments(
	q: string,
	actor: Actor | null,
	options: SearchOptions = {},
	handle: Queryable = db
): Promise<{ hits: SearchHit[]; honesty: SearchHonesty }> {
	const query = q.trim();
	if (!query) {
		return { hits: [], honesty: await honestyCounts(actor, [], options, handle) };
	}

	const rows = (await handle.execute(candidateSql(query, actor, options))) as unknown as {
		document_id: string;
		tier: Tier;
		matched_in: MatchedIn;
		page_no: number | null;
		snippet: string | null;
	}[];

	const hits: SearchHit[] = [...rows].map((row) => ({
		documentId: row.document_id,
		tier: row.tier,
		matchedIn: row.matched_in,
		pageNo: row.page_no,
		snippet: row.snippet ? row.snippet.replace(/\s+/g, ' ').trim() : null
	}));

	return { hits, honesty: await honestyCounts(actor, hits, { ...options, query }, handle) };
}

/**
 * What the screen is allowed to say about what it could NOT find.
 *
 * Every count is derived rather than stored, and every count passes through the
 * same read rule as the rows: telling a member "3 matches belong only to
 * archived subjects" when two of them are restricted would leak exactly what
 * the invariant exists to hide — a hint is a count, and a count is the leak.
 */
async function honestyCounts(
	actor: Actor | null,
	hits: SearchHit[],
	options: SearchOptions & { query?: string },
	handle: Queryable
): Promise<SearchHonesty> {
	const readable = readableSql(actor, options.includeArchived ?? false);

	const [counts] = (await handle.execute(sql`
		select
			(select count(*)::int from document d
			 where ${readable} and d.stored_name is not null
			   and not exists (select 1 from document_text t where t.document_id = d.id)
			   and not exists (
			       select 1 from job j
			       where j.kind = 'extract_text' and j.subject_id = d.id
			         and j.state in ('queued', 'running'))
			) as not_searchable,
			(select count(*)::int from document d
			 join job j on j.subject_id = d.id
			 where ${readable} and j.kind = 'extract_text' and j.state in ('queued', 'running')
			) as pending
	`)) as unknown as { not_searchable: number; pending: number }[];

	let archivedOnly = 0;
	if (options.query && !options.includeArchived) {
		// The same candidate query with the archive scope open. Anything it finds
		// that the closed scope did not is a match hiding in the archive — which
		// is a thing the screen must offer to show rather than pretend is absent.
		const open = (await handle.execute(
			candidateSql(options.query, actor, { ...options, includeArchived: true })
		)) as unknown as { document_id: string }[];
		const shown = new Set(hits.map((h) => h.documentId));
		archivedOnly = [...open].filter((row) => !shown.has(row.document_id)).length;
	}

	return {
		pending: counts?.pending ?? 0,
		notSearchable: counts?.not_searchable ?? 0,
		archivedOnly
	};
}
