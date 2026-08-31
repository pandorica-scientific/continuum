// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * File a backlog of scanned paperwork.
 *
 *   node scripts/import-documents.mjs <directory> [--mapping mapping.json] [--dry-run]
 *
 * Walks a directory, copies each file into the upload volume, and files it
 * against the shelf and type a MAPPING TABLE says the path implies. The table
 * is a small JSON file the household edits — "anything under `pojisteni/` is an
 * insurance policy on the Property shelf" — because only the person who made
 * the folders knows what they meant.
 *
 * Two rules the shape of this thing depends on:
 *
 * 1. A path nobody mapped goes to the INBOX. Guessing is what produces an
 *    archive that looks filed and is not, and the inbox is the one place a
 *    person will actually look at what arrived.
 * 2. Subject and entity assignment stays a UI bulk action. A directory name
 *    cannot tell whose passport this is, and a wrong link is worse than none.
 *
 * `contentHash` dedups against what is already filed, so running it twice over
 * a growing directory imports only what is new.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/** Extensions worth filing. Anything else in the directory is left alone. */
const KEEP = new Set([
	'.pdf',
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.heic',
	'.txt',
	'.csv',
	'.md',
	'.xlsx'
]);

/**
 * @typedef {{ segment: string, shelf: string, type?: string, tag?: string }} MappingRule
 */

/** The default table: a starting point the household edits, not a guess. */
export const DEFAULT_MAPPING = [
	{ segment: 'smlouvy', shelf: 'household', type: 'contract' },
	{ segment: 'contracts', shelf: 'household', type: 'contract' },
	{ segment: 'faktury', shelf: 'finance', type: 'invoice' },
	{ segment: 'invoices', shelf: 'finance', type: 'invoice' },
	{ segment: 'pojisteni', shelf: 'property', type: 'insurance_policy', tag: 'insurance' },
	{ segment: 'insurance', shelf: 'property', type: 'insurance_policy', tag: 'insurance' },
	{ segment: 'vypisy', shelf: 'statements', type: 'bank_statement' },
	{ segment: 'statements', shelf: 'statements', type: 'bank_statement' },
	{ segment: 'zdravi', shelf: 'health', type: 'medical_record' },
	{ segment: 'health', shelf: 'health', type: 'medical_record' },
	{ segment: 'auto', shelf: 'vehicles' },
	{ segment: 'vehicles', shelf: 'vehicles' },
	{ segment: 'dane', shelf: 'finance', type: 'tax_document' },
	{ segment: 'tax', shelf: 'finance', type: 'tax_document' }
];

/**
 * Which rule a path matches, if any.
 *
 * Deepest segment wins: `documents/auto/pojisteni/2019.pdf` is insurance about
 * a car rather than "something in the car folder", and the more specific answer
 * is the one a person would give.
 *
 * @param {string} relativePath
 * @param {MappingRule[]} mapping
 * @returns {MappingRule | null}
 */
export function ruleFor(relativePath, mapping) {
	const segments = relativePath
		.split(sep)
		.slice(0, -1)
		.map((s) => s.toLowerCase());
	for (let i = segments.length - 1; i >= 0; i--) {
		const rule = mapping.find((r) => r.segment.toLowerCase() === segments[i]);
		if (rule) return rule;
	}
	return null;
}

/**
 * Every file worth filing, relative to the root.
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
export async function walk(root, prefix = '') {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	const found = [];
	for (const entry of entries) {
		const relative = join(prefix, entry.name);
		if (entry.isDirectory()) found.push(...(await walk(root, relative)));
		else if (KEEP.has(extname(entry.name).toLowerCase())) found.push(relative);
	}
	return found.sort();
}

/** @param {Uint8Array} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Import a directory into an already-connected database.
 *
 * Exported so the integration suite drives the same code an operator runs,
 * rather than a copy of it.
 *
 * @param {object} options
 * @param {string} options.directory
 * @param {MappingRule[]} options.mapping
 * @param {import('postgres').Sql} options.sql
 * @param {string} options.uploadDir
 * @param {boolean} [options.dryRun]
 */
export async function importDirectory({ directory, mapping, sql, uploadDir, dryRun = false }) {
	const root = resolve(directory);
	const files = await walk(root);
	const shelves = await sql`select id, key from shelf`;
	const shelfByKey = new Map(shelves.map((s) => [s.key, s.id]));
	const inbox = shelfByKey.get('inbox');
	if (!inbox) throw new Error('This database has no inbox shelf — is it upgraded?');

	let filed = 0;
	let skipped = 0;
	let toInbox = 0;

	for (const relative of files) {
		const bytes = new Uint8Array(await readFile(join(root, relative)));
		const contentHash = hash(bytes);

		const [existing] =
			await sql`select id from document where content_hash = ${contentHash} limit 1`;
		if (existing) {
			skipped++;
			continue;
		}

		const rule = ruleFor(relative, mapping);
		const shelfId = (rule && shelfByKey.get(rule.shelf)) || inbox;
		if (!rule || !shelfByKey.get(rule.shelf)) toInbox++;
		const ext = extname(relative).replace('.', '').toLowerCase() || 'pdf';
		const name = (relative.split(sep).pop() ?? relative).replace(/\.[^.]+$/, '');

		if (dryRun) {
			console.log(`${relative} → ${rule?.shelf ?? 'inbox'}${rule?.type ? ` (${rule.type})` : ''}`);
			filed++;
			continue;
		}

		// The stored name is generated the way the app generates one, so the
		// file route and the extraction engine treat it exactly the same.
		const storedName = `${crypto.randomUUID()}.${ext}`;
		await mkdir(uploadDir, { recursive: true });
		await writeFile(join(uploadDir, storedName), bytes);

		const [row] = await sql`
			insert into document (id, name, shelf_id, type, ext, added_on, stored_name, content_hash)
			values (gen_random_uuid(), ${name}, ${shelfId}, ${rule?.type ?? 'other'}, ${ext.toUpperCase()},
			        current_date, ${storedName}, ${contentHash})
			returning id`;

		if (rule?.tag) {
			await sql`insert into tag (id, name, normalised_name)
				values (gen_random_uuid(), ${rule.tag}, ${rule.tag.toLowerCase()})
				on conflict (normalised_name) do nothing`;
			await sql`insert into tag_link (tag_id, target_id)
				select id, ${row.id} from tag where normalised_name = ${rule.tag.toLowerCase()}
				on conflict do nothing`;
		}

		// Queued, not run: extraction shares one CPU slot with statement imports,
		// and a backlog of six hundred scans is exactly what that slot protects
		// the web server from.
		await sql`insert into job (id, kind, subject_id) values (gen_random_uuid()::text, 'extract_text', ${row.id})`;
		filed++;
	}

	return { files: files.length, filed, skipped, toInbox };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [directory] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	if (!directory) {
		console.error(
			'Usage: node scripts/import-documents.mjs <directory> [--mapping f.json] [--dry-run]'
		);
		process.exit(1);
	}
	const mappingArg = process.argv.indexOf('--mapping');
	const mapping =
		mappingArg > -1
			? JSON.parse(await readFile(resolve(process.argv[mappingArg + 1]), 'utf8'))
			: DEFAULT_MAPPING;

	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}
	const { default: postgres } = await import('postgres');
	const sql = postgres(url, { max: 1 });
	try {
		const summary = await importDirectory({
			directory,
			mapping,
			sql,
			uploadDir: process.env.UPLOAD_DIR || 'data',
			dryRun: process.argv.includes('--dry-run')
		});
		console.log(
			`${summary.files} files · ${summary.filed} filed · ${summary.skipped} already here · ${summary.toInbox} to the inbox`
		);
	} finally {
		await sql.end();
	}
}
