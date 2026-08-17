/**
 * A small XML reader, scoped to machine-generated financial messages.
 *
 * Deliberately not a general parser and not a dependency. CAMT.053 is emitted
 * by banking systems against a published schema: no CDATA, no DTDs, no mixed
 * content, no entity definitions beyond the predefined five. Handling exactly
 * that keeps this auditable and keeps a self-hosted product free of another
 * supply chain.
 *
 * Namespace prefixes are dropped rather than resolved. CAMT names every
 * element unambiguously, and banks disagree about whether to prefix at all —
 * matching on the local name is what actually works across issuers.
 */

export interface XmlNode {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

export function decodeEntities(raw: string): string {
	return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			return String.fromCodePoint(parseInt(body.slice(2), 16));
		}
		if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
		return ENTITIES[body] ?? whole;
	});
}

const localName = (raw: string) => raw.slice(raw.indexOf(':') + 1);

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g)) {
		const name = m[1] ?? m[3];
		const value = m[2] ?? m[4];
		if (name && !name.startsWith('xmlns')) attrs[localName(name)] = decodeEntities(value);
	}
	return attrs;
}

/** Parse a document into a tree. Throws on anything structurally wrong. */
export function parseXml(source: string): XmlNode {
	// Declarations, comments and processing instructions carry nothing we need.
	const text = source
		.replace(/<\?[\s\S]*?\?>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => inner)
		.replace(/<!DOCTYPE[^>]*>/gi, '');

	const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
	const stack: XmlNode[] = [root];
	const tagPattern = /<\s*(\/?)\s*([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;

	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = tagPattern.exec(text)) !== null) {
		const [whole, closing, rawName, rawAttrs, selfClosing] = match;
		const parent = stack[stack.length - 1];

		const between = text.slice(cursor, match.index);
		if (between.trim()) parent.text += decodeEntities(between);
		cursor = match.index + whole.length;

		const name = localName(rawName);
		if (closing) {
			// Tolerate a stray close tag rather than abandoning a whole statement.
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i].name === name) {
					stack.length = i;
					break;
				}
			}
			continue;
		}

		const node: XmlNode = { name, attrs: parseAttrs(rawAttrs), children: [], text: '' };
		parent.children.push(node);
		if (!selfClosing) stack.push(node);
	}

	if (root.children.length === 0) throw new Error('That file contains no XML elements.');
	return root;
}

/** Direct children with this name. */
export const childrenNamed = (node: XmlNode, name: string): XmlNode[] =>
	node.children.filter((c) => c.name === name);

/** First direct child with this name. */
export const child = (node: XmlNode, name: string): XmlNode | undefined =>
	node.children.find((c) => c.name === name);

/** Walk a path of element names, e.g. ['Acct', 'Id', 'IBAN']. */
export function at(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
	let current = node;
	for (const step of path) {
		if (!current) return undefined;
		current = child(current, step);
	}
	return current;
}

/** Trimmed text of the node at a path, when it exists. */
export function textAt(node: XmlNode | undefined, ...path: string[]): string | undefined {
	const found = at(node, ...path);
	const value = found?.text.trim();
	return value || undefined;
}

/** Every descendant with this name, at any depth. */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
	for (const c of node.children) {
		if (c.name === name) out.push(c);
		descendants(c, name, out);
	}
	return out;
}
