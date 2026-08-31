// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Minimal CSV splitter that understands quoted fields with embedded
 * delimiters, escaped quotes ("") and CRLF. Enough for bank exports; avoids a
 * dependency whose edge-case behaviour we would have to verify anyway.
 *
 * A quote only opens a field when it is the field's first character, as in
 * RFC 4180. Treating one anywhere as an opener made `NAKUP 27" MONITOR` eat
 * the delimiter after it and merge the amount into the description — the row
 * then failed its adapter's column-count guard and the transaction vanished.
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
			// Including a quote that is not at the field's start: an inch mark or
			// a size in a merchant name is text, not syntax.
			current += ch;
		}
	}
	cells.push(current);
	return cells;
}

/**
 * Split a document into CSV records. Quote-aware, because the field splitter
 * above is: a newline inside a quoted field (a wrapped payment note in Fio's
 * "Zpráva pro příjemce", an mBank "Tytuł", a Revolut "Description") belongs to
 * the field, not between records.
 *
 * Splitting on every newline cut such a row into halves that each failed their
 * adapter's column-count guard, so the transaction vanished with no error —
 * and in the formats carrying a running balance the later rows still
 * fingerprinted cleanly, so nothing downstream noticed the gap either.
 *
 * Only a quote at the start of a field opens one, as in RFC 4180 and as
 * `splitCsvLine` above already reads it. Toggling on any quote anywhere meant a
 * single stray one — `NAKUP 27" MONITOR` in a card description, an inch mark, a
 * measurement — swallowed every remaining line of the file into one malformed
 * record. Those rows then failed the column guard and vanished, the import
 * still counted as a partial success, and the content hash it recorded made the
 * corrected re-upload look like a duplicate.
 */
export function csvLines(text: string): string[] {
	const normalised = text.replace(/\r\n?/g, '\n');
	const lines: string[] = [];
	let current = '';
	let inQuotes = false;
	// True at the very start of a field: after a record break, and (since the
	// delimiter differs per bank) after any character that is not part of a
	// value we are already reading.
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
			// A quote anywhere else is literal text: an inch mark, not syntax.
			current += ch;
			atFieldStart = false;
		} else if (ch === '\n' && !inQuotes) {
			lines.push(current);
			current = '';
			atFieldStart = true;
		} else {
			current += ch;
			// A field can only begin after a delimiter, and every delimiter this
			// project sees is a single punctuation character.
			atFieldStart = ch === ';' || ch === ',' || ch === '\t';
		}
	}
	lines.push(current);
	return lines;
}
