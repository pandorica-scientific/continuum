import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvLines, splitCsvLine } from '$lib/server/import/csv';
import { parseFio } from '$lib/server/import/adapters/fio';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

describe('csvLines', () => {
	it('splits on unquoted newlines and normalises CRLF', () => {
		expect(csvLines('a;b\r\nc;d\rE;f\ng;h')).toEqual(['a;b', 'c;d', 'E;f', 'g;h']);
	});

	it('keeps a newline inside a quoted field in the same record', () => {
		const lines = csvLines('"a";"note\nsecond line";"c"\n"d";"e";"f"');
		expect(lines).toHaveLength(2);
		expect(splitCsvLine(lines[0], ';')).toEqual(['a', 'note\nsecond line', 'c']);
		expect(splitCsvLine(lines[1], ';')).toEqual(['d', 'e', 'f']);
	});

	it('an escaped quote does not leave the splitter stuck inside a field', () => {
		// "" toggles twice, so the newline after it is still a record boundary.
		const lines = csvLines('"say ""hi""";"x"\n"next";"y"');
		expect(lines).toHaveLength(2);
		expect(splitCsvLine(lines[0], ';')).toEqual(['say "hi"', 'x']);
		expect(splitCsvLine(lines[1], ';')).toEqual(['next', 'y']);
	});

	it('preserves a trailing empty record, as a plain split would', () => {
		expect(csvLines('a\nb\n')).toEqual(['a', 'b', '']);
	});

	it('a stray quote mid-field does not swallow the rest of the file', () => {
		// An inch mark in a card description is ordinary text, not syntax.
		// Toggling on any quote turned this four-record file into two and
		// silently dropped every movement after the stray quote.
		const doc =
			'date;desc;amount\n' +
			'2026-01-01;NAKUP 27" MONITOR;-100\n' +
			'2026-01-02;ALBERT;-50\n' +
			'2026-01-03;RENT;-20000\n';
		const lines = csvLines(doc).filter((l) => l.trim());
		expect(lines).toHaveLength(4);
		expect(splitCsvLine(lines[1], ';')).toEqual(['2026-01-01', 'NAKUP 27" MONITOR', '-100']);
		expect(splitCsvLine(lines[3], ';')).toEqual(['2026-01-03', 'RENT', '-20000']);
	});

	it('an odd number of quotes in one field still ends the record', () => {
		expect(csvLines('a;b"c;d\ne;f;g').filter((l) => l.trim())).toHaveLength(2);
		expect(csvLines('12";34\n56;78').filter((l) => l.trim())).toHaveLength(2);
	});

	it('a quote opening a field is still honoured after every delimiter', () => {
		for (const delim of [';', ',', '\t']) {
			const doc = `a${delim}"note\nwrapped"${delim}c\nd${delim}e${delim}f`;
			const lines = csvLines(doc);
			expect(lines).toHaveLength(2);
			expect(splitCsvLine(lines[0], delim)).toEqual(['a', 'note\nwrapped', 'c']);
		}
	});
});

describe('a wrapped payment note does not drop the transaction', () => {
	const raw = readFileSync(fixture('fio.csv'), 'utf-8');

	it('parses the same rows with and without a newline inside a quoted field', () => {
		const baseline = parseFio(raw);
		// "Zpráva pro příjemce" is free text the payer types; Fio quotes it, and
		// a wrapped one arrives with a real line break inside the quotes. Split
		// on every newline, both halves failed the column-count guard and the
		// row vanished with no error — while the rows after it still
		// fingerprinted cleanly, so nothing downstream noticed the gap.
		expect(raw).toContain('"Peněž. pomoc"');
		const wrapped = parseFio(raw.replace('"Peněž. pomoc"', '"Peněž.\npomoc"'));

		expect(wrapped.rows).toHaveLength(baseline.rows.length);
		expect(wrapped.rows.map((r) => r.amountMinor)).toEqual(baseline.rows.map((r) => r.amountMinor));
		expect(wrapped.closingBalanceMinor).toBe(baseline.closingBalanceMinor);
	});
});
