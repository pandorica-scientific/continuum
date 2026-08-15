/**
 * Minimal CSV splitter that understands quoted fields with embedded
 * delimiters, escaped quotes ("") and CRLF. Enough for bank exports; avoids a
 * dependency whose edge-case behaviour we would have to verify anyway.
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
		} else if (ch === '"') {
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
 * Split a document into CSV records. Quote-aware, because the field splitter
 * above is: a newline inside a quoted field (a wrapped payment note in Fio's
 * "Zpráva pro příjemce", an mBank "Tytuł", a Revolut "Description") belongs to
 * the field, not between records.
 *
 * Splitting on every newline cut such a row into halves that each failed their
 * adapter's column-count guard, so the transaction vanished with no error —
 * and in the formats carrying a running balance the later rows still
 * fingerprinted cleanly, so nothing downstream noticed the gap either.
 */
export function csvLines(text: string): string[] {
	const normalised = text.replace(/\r\n?/g, '\n');
	const lines: string[] = [];
	let current = '';
	let inQuotes = false;
	for (const ch of normalised) {
		if (ch === '"') {
			// An escaped quote ("") toggles twice and lands back where it
			// started, which is exactly the state we need it to be in.
			inQuotes = !inQuotes;
			current += ch;
		} else if (ch === '\n' && !inQuotes) {
			lines.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	lines.push(current);
	return lines;
}
