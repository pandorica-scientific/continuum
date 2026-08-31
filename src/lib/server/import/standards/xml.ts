// SPDX-License-Identifier: AGPL-3.0-or-later
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

/**
 * A numeric reference that names a real character, or nothing.
 *
 * `parseInt` returns any magnitude it is given but `String.fromCodePoint`
 * accepts only 0..0x10FFFF, so `&#x110000;` in an uploaded statement threw a
 * RangeError out of the parser and surfaced as the raw internal message
 * "Invalid code point 1114112". An unrepresentable reference is malformed
 * input, not a crash: leave it as it was written.
 */
const codePoint = (digits: string, radix: number, whole: string): string => {
	const value = parseInt(digits, radix);
	if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return whole;
	return String.fromCodePoint(value);
};

export function decodeEntities(raw: string): string {
	return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			return codePoint(body.slice(2), 16, whole);
		}
		if (body.startsWith('#')) return codePoint(body.slice(1), 10, whole);
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
	//
	// Comments are removed to a FIXED POINT; everything else is one pass. A
	// single pass leaves the opener behind on input the removal itself creates —
	// `<!--<!-- -->` loses the inner comment and keeps a bare `<!--`, and the tag
	// scanner below then reads the rest of the document as one unterminated
	// element. Such a file is not valid XML, but this parser is handed whatever a
	// bank exports, and the failure is silent: a statement that reads as empty
	// rather than as broken.
	//
	// Only the comments loop, because comments are the only one of the four
	// whose own removal can produce a fresh opener. Re-running the whole chain
	// would additionally re-scan whatever a CDATA section unwrapped into, which
	// is a behaviour change nothing here needs.
	let text = source.replace(/<\?[\s\S]*?\?>/g, '');
	for (;;) {
		const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
		if (stripped === text) break;
		text = stripped;
	}
	text = text
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
