// Column derivation for the documents screen, from entity links rather than
// free-text subjects. Labels are the linked records' *current* names, so a
// rename carries every document with it and a phantom column cannot exist.

export interface LinkedDoc {
	id: string;
	/** Current names of everything this document belongs to, already joined. */
	people: string[];
	properties: string[];
	accounts: string[];
	subjects: string[];
}

interface DocColumn {
	label: string;
	docIds: string[];
}

/**
 * Columns in display order: people, then flats, then investment accounts, then
 * subjects — alphabetical within each group. A document linked to two people
 * appears under both, which is the point of several links.
 */
export function deriveColumns(docs: LinkedDoc[]): DocColumn[] {
	const groups: (keyof Omit<LinkedDoc, 'id'>)[] = ['people', 'properties', 'accounts', 'subjects'];
	const out: DocColumn[] = [];
	for (const group of groups) {
		const byLabel = new Map<string, string[]>();
		for (const doc of docs) {
			for (const label of doc[group]) {
				const ids = byLabel.get(label) ?? [];
				if (!ids.includes(doc.id)) ids.push(doc.id);
				byLabel.set(label, ids);
			}
		}
		for (const label of [...byLabel.keys()].sort((a, b) => a.localeCompare(b))) {
			out.push({ label, docIds: byLabel.get(label)! });
		}
	}
	return out;
}

/** True when a document belongs to nothing — refused at the save boundary. */
export function isUnlinked(picked: {
	people: string[];
	properties: string[];
	accounts: string[];
	subjects: string[];
}): boolean {
	return (
		picked.people.length === 0 &&
		picked.properties.length === 0 &&
		picked.accounts.length === 0 &&
		picked.subjects.length === 0
	);
}
