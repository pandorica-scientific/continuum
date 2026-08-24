// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A restorable data dump in plain SQL, produced over the normal database
// connection — no pg_dump binary required, so backups work in every install
// (the schema itself is recreated by the app's own migrations on first boot).
//
// The file truncates all application tables and reloads them with COPY
// blocks, so restoring is: boot a fresh (migrated) instance, then
//   psql -v ON_ERROR_STOP=1 -f the-backup.sql
// against its database.

import postgres from 'postgres';
import { env } from '$env/dynamic/private';

/**
 * Order tables parents-first from foreign-key edges [child, parent] so a
 * restore never inserts a row before its reference exists. Cycles are broken
 * arbitrarily — the emitted SQL also disables FK triggers for the session
 * (when the restoring role is allowed to), so order is a belt on braces.
 */
export function orderTables(tables: string[], fkEdges: [string, string][]): string[] {
	const remaining = new Set(tables);
	const ordered: string[] = [];
	while (remaining.size > 0) {
		let progressed = false;
		for (const table of [...remaining]) {
			const blocked = fkEdges.some(
				([child, parent]) =>
					child === table && parent !== table && remaining.has(parent) && !ordered.includes(parent)
			);
			if (!blocked) {
				ordered.push(table);
				remaining.delete(table);
				progressed = true;
			}
		}
		if (!progressed) {
			// cycle: emit the rest in stable order
			ordered.push(...[...remaining].sort());
			break;
		}
	}
	return ordered;
}

export async function dumpDatabase(): Promise<string> {
	if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	const sql = postgres(env.DATABASE_URL, { max: 1 });
	try {
		const tableRows = await sql`
			select tablename from pg_tables where schemaname = 'public' order by tablename`;
		const tables = tableRows.map((r) => r.tablename as string);

		const fkRows = await sql`
			select c.relname as child, p.relname as parent
			from pg_constraint fk
			join pg_class c on c.oid = fk.conrelid
			join pg_class p on p.oid = fk.confrelid
			where fk.contype = 'f' and c.relnamespace = 'public'::regnamespace`;
		const edges = fkRows.map((r) => [r.child as string, r.parent as string] as [string, string]);

		const ordered = orderTables(tables, edges);

		const parts: string[] = [
			`-- Continuum data backup · ${new Date().toISOString()}`,
			`-- Restore into a freshly booted (already migrated) instance, e.g.:`,
			`--   docker compose exec -T db psql -U continuum -d continuum -v ON_ERROR_STOP=1 < this-file.sql`,
			`begin;`,
			// Skip FK checks during the load when the role is allowed to; the
			// COPY order below already satisfies FKs for the common case.
			`do $$ begin execute 'set session_replication_role = replica'; exception when others then null; end $$;`,
			`truncate ${ordered.map((t) => `"${t}"`).join(', ')} cascade;`
		];

		for (const table of ordered) {
			// Generated columns are omitted by COPY … TO STDOUT but present in
			// information_schema, so naming one makes every header a column wider
			// than the rows beneath it — which is what made every dump taken
			// before v0.4.3 unrestorable. Eleven tables carry a generated
			// `entity_kind`, so this was not a corner case.
			const cols = await sql`
				select column_name from information_schema.columns
				where table_schema = 'public' and table_name = ${table}
				  and is_generated = 'NEVER'
				order by ordinal_position`;
			const colList = cols.map((c) => `"${c.column_name}"`).join(', ');

			const chunks: Buffer[] = [];
			const readable = await sql`copy ${sql(table)} to stdout`.readable();
			for await (const chunk of readable) chunks.push(chunk as Buffer);
			const data = Buffer.concat(chunks).toString('utf8');

			parts.push(`copy "${table}" (${colList}) from stdin;`);
			parts.push(data.endsWith('\n') || data === '' ? data + '\\.' : data + '\n\\.');
		}

		parts.push('commit;');
		return parts.join('\n') + '\n';
	} finally {
		await sql.end();
	}
}
