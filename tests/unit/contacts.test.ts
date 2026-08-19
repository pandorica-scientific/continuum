import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normaliseSearch, SQL_FOLD_FROM, SQL_FOLD_TO } from '$lib/contacts/search';
import { isAllowedAvatar, previousPhotoToRemove } from '$lib/server/contacts';

describe('contact search normalisation', () => {
	// The reason this exists. A household with Czech and Polish contacts cannot be
	// asked to type the háček to find someone: an address book that only answers
	// to "Řehoř" and never to "rehor" is broken on arrival.
	it('folds Czech diacritics', () => {
		expect(normaliseSearch('Řehoř')).toBe('rehor');
		expect(normaliseSearch('Škoda')).toBe('skoda');
		expect(normaliseSearch('Nováková')).toBe('novakova');
	});

	it('folds Polish diacritics', () => {
		expect(normaliseSearch('Żabka')).toBe('zabka');
		expect(normaliseSearch('Świętochowski')).toBe('swietochowski');
	});

	// Ł has no combining decomposition, so NFD alone leaves it untouched. It needs
	// an explicit mapping or "lodz" never finds "Łódź".
	it('folds stroked letters that NFD cannot decompose', () => {
		expect(normaliseSearch('Łódź')).toBe('lodz');
		expect(normaliseSearch('Đorđe')).toBe('dorde');
	});

	it('is idempotent on already-folded input', () => {
		expect(normaliseSearch('rehor')).toBe('rehor');
		expect(normaliseSearch(normaliseSearch('Řehoř'))).toBe('rehor');
	});

	it('trims and lowercases', () => {
		expect(normaliseSearch('  Kaufland ')).toBe('kaufland');
		expect(normaliseSearch('ČESKÁ SPOŘITELNA')).toBe('ceska sporitelna');
	});

	it('leaves an empty or whitespace-only term empty', () => {
		expect(normaliseSearch('')).toBe('');
		expect(normaliseSearch('   ')).toBe('');
	});
});

// The TypeScript fold normalises what the user typed; the SQL fold normalises
// what is stored. They must agree exactly. If they drift, the query stops
// matching and reports NO RESULTS — never an error — so nothing surfaces until
// someone notices a contact they know exists cannot be found.
describe('the SQL fold matches the TypeScript fold', () => {
	const migration = readFileSync('drizzle/0000_baseline.sql', 'utf8');

	it('translates the same stroked letters the TypeScript map does', () => {
		const call = migration.match(/translate\(value,\s*'([^']*)',\s*'([^']*)'\)/);
		expect(call, 'translate(...) not found in the baseline').toBeTruthy();
		expect(call![1]).toBe(SQL_FOLD_FROM);
		expect(call![2]).toBe(SQL_FOLD_TO);
	});

	it('keeps the from and to lists the same length', () => {
		// translate() pairs by position: a shorter `to` silently DELETES the
		// unmatched characters rather than substituting them.
		expect(SQL_FOLD_FROM.length).toBe(SQL_FOLD_TO.length);
	});

	// Both are load-bearing and both were found by the migration failing. See the
	// comments in the migration for what each one costs when omitted.
	it('schema-qualifies unaccent so the index build can resolve it', () => {
		expect(migration).toContain("public.unaccent('public.unaccent'::regdictionary");
	});

	// The extension, the function and the index have to arrive as three separate
	// statements, in that order. Sent as one batch, CREATE FUNCTION is parsed
	// before CREATE EXTENSION has taken effect and the whole thing fails with
	// "text search dictionary unaccent does not exist" — on a fresh database
	// only, which is the one place nobody tests before shipping.
	it('separates its statements so a fresh database can apply it', () => {
		const statements = migration
			.split('--> statement-breakpoint')
			.filter((part) =>
				part.split('\n').some((line) => line.trim() && !line.trim().startsWith('--'))
			);
		const at = (pattern: RegExp) => statements.findIndex((part) => pattern.test(part));

		const extension = at(/CREATE EXTENSION IF NOT EXISTS unaccent/i);
		const fold = at(/FUNCTION contact_fold/i);
		const index = at(/INDEX contact_search_idx/i);

		expect(extension).toBeGreaterThanOrEqual(0);
		expect(fold).toBeGreaterThan(extension);
		expect(index).toBeGreaterThan(fold);
	});
});

// An avatar is one stored file on the data volume. Nothing else knows it is
// there, so whoever replaces the row is the only thing that can clean it up.
describe('photo lifecycle', () => {
	it('reports the old stored name when a new photo replaces it', () => {
		expect(previousPhotoToRemove('old.jpg', 'new.jpg')).toBe('old.jpg');
	});

	it('reports the old stored name when the photo is cleared', () => {
		expect(previousPhotoToRemove('old.jpg', null)).toBe('old.jpg');
	});

	// The case that matters: an edit that changes only the phone number still
	// carries the same photo through the form. Treating that as a replacement
	// would delete the file the row still points at.
	it('reports nothing when the photo is unchanged', () => {
		expect(previousPhotoToRemove('same.jpg', 'same.jpg')).toBeNull();
	});

	it('reports nothing when there was no previous photo', () => {
		expect(previousPhotoToRemove(null, 'new.jpg')).toBeNull();
		expect(previousPhotoToRemove(null, null)).toBeNull();
	});
});

// files.ts allows .svg because documents legitimately are SVGs. An avatar is
// not: /files/[name] serves uploads by direct navigation as well as inside an
// <img>, and a navigated SVG executes its own script in this origin.
describe('avatar upload types', () => {
	it('accepts the raster formats a photo actually arrives in', () => {
		for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'A.JPG']) {
			expect(isAllowedAvatar(name)).toBe(true);
		}
	});

	it('rejects SVG even though files.ts permits it for documents', () => {
		expect(isAllowedAvatar('avatar.svg')).toBe(false);
	});

	it('rejects a double extension that ends in svg', () => {
		expect(isAllowedAvatar('avatar.png.svg')).toBe(false);
	});

	it('rejects a file with no extension', () => {
		expect(isAllowedAvatar('avatar')).toBe(false);
	});
});
