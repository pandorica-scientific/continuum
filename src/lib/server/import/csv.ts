// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Minimal CSV splitter that understands quoted fields with embedded
 * delimiters, escaped quotes ("") and CRLF.
 *
 * A quote only opens a field when it is the field's first character, as in
 * RFC 4180 — otherwise `NAKUP 27" MONITOR` eats the following delimiter and
 * merges the amount into the description.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"' && current === '') {
			inQuotes = true;
		} else if (ch === delimiter) {
			cells.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	cells.push(current);
	return cells;
}

/**
 * Split a document into CSV records. Quote-aware like `splitCsvLine` above: a
 * newline inside a quoted field (a wrapped payment note, an mBank "Tytuł", a
 * Revolut "Description") belongs to the field, not between records.
 *
 * Only a quote at the start of a field opens one, per RFC 4180 — toggling on
 * any quote anywhere lets a single stray one (`NAKUP 27" MONITOR`) swallow
 * every remaining line into one malformed record.
 */
export function csvLines(text: string): string[] {
	const normalised = text.replace(/\r\n?/g, '\n');
	const lines: string[] = [];
	let current = '';
	let inQuotes = false;
	// True at the very start of a field: after a record break or a delimiter.
	let atFieldStart = true;
	for (let i = 0; i < normalised.length; i++) {
		const ch = normalised[i];
		if (ch === '"') {
			if (inQuotes) {
				if (normalised[i + 1] === '"') {
					// An RFC 4180 escaped quote is data, not the end of the field.
					current += '""';
					i++;
					continue;
				}
				inQuotes = false;
			} else if (atFieldStart) {
				inQuotes = true;
			}
			current += ch;
			atFieldStart = false;
		} else if (ch === '\n' && !inQuotes) {
			lines.push(current);
			current = '';
			atFieldStart = true;
		} else {
			current += ch;
			atFieldStart = ch === ';' || ch === ',' || ch === '\t';
		}
	}
	lines.push(current);
	return lines;
}
