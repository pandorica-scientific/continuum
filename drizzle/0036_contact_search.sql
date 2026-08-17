-- Contact search folds diacritics: "rehor" must find "Řehoř", "lodz" must find
-- "Łódź". Without this an address book for a Czech and Polish household only
-- answers to input nobody can type quickly.
--
-- The fold has to be identical on both sides. A term folded in TypeScript and
-- compared against text folded differently in SQL matches nothing, and it fails
-- silently — as "no results", never as an error. src/lib/contacts/search.ts owns
-- the canonical definition; tests/unit/contacts.test.ts pins this SQL against it.

-- The statement-breakpoint markers below are load-bearing, not formatting.
-- Drizzle splits a migration on them and sends each part separately; without
-- them the whole file arrives as one batch, and CREATE FUNCTION is parsed before
-- CREATE EXTENSION has taken effect. That fails with "text search dictionary
-- unaccent does not exist" — on a fresh database only, which is the one place
-- nobody tests before shipping.

create extension if not exists unaccent;
--> statement-breakpoint

-- WHY A WRAPPER FUNCTION RATHER THAN unaccent() INLINE:
-- unaccent(text) is STABLE, not IMMUTABLE, because it resolves the default
-- dictionary at run time. PostgreSQL refuses a STABLE expression in an index,
-- so indexing unaccent(name) directly fails outright. The two-argument form
-- unaccent(regdictionary, text) IS immutable — naming the dictionary is what
-- makes it so — and wrapping that lets the expression be indexed.
--
-- translate() covers the stroked letters unaccent cannot: Ł and Đ are single
-- code points with no combining accent to remove, so NFD-style stripping leaves
-- them alone. The from/to pairs mirror STROKED in search.ts.
create or replace function contact_fold(value text) returns text
	language sql
	immutable
	strict
	parallel safe
-- TWO NON-OBVIOUS REQUIREMENTS, BOTH LEARNED BY THE MIGRATION FAILING:
--
-- 1. The ::regdictionary cast. A bare 'unaccent' literal arrives as type
--    `unknown`, PostgreSQL cannot choose between the one- and two-argument
--    overloads, and CREATE FUNCTION fails with
--    "function unaccent(unknown, text) does not exist".
--
-- 2. Both names are schema-qualified. PostgreSQL builds an index expression
--    under a restricted search_path that excludes `public` (the hardening from
--    CVE-2018-1058), so an unqualified reference resolves fine when the function
--    is created and then fails when the INDEX is built, with "text search
--    dictionary unaccent does not exist". The function looked correct in
--    isolation; only the index build proved otherwise.
as $$
	select lower(
		public.unaccent('public.unaccent'::regdictionary, translate(value, 'łđøħŧ', 'ldoht'))
	)
$$;
--> statement-breakpoint

-- Name and organisation are the two fields people search by: a person, or
-- everyone at a company. Notes and address are deliberately excluded — folding
-- a free-text blob into the same index makes every contact match almost
-- anything, which reads as the search being broken.
create index contact_search_idx on contact using gin (
	to_tsvector(
		'simple',
		contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, ''))
	)
);
