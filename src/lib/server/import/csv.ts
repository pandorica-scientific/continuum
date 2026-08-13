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

export function csvLines(text: string): string[] {
	return text.replace(/\r\n?/g, '\n').split('\n');
}
