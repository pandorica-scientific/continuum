#!/usr/bin/env node
/**
 * Design-token reference generator and drift check.
 *
 * `src/lib/styles/app.css` is the single source of truth for the design system.
 * This script never invents values — it reads that file, so a token's meaning is
 * whatever its comment in the stylesheet says, and the reference cannot drift
 * from the code by construction.
 *
 *   node scripts/design-tokens.mjs           write design_system/TOKENS.md
 *   node scripts/design-tokens.mjs --check   verify TOKENS.md is current, every
 *                                            var(--x) in the design canvases
 *                                            resolves, and every token value a
 *                                            handoff doc quotes still matches
 *
 * Check exits non-zero when a canvas references a token that is defined neither
 * in app.css nor locally in that canvas — a typo that silently renders as
 * nothing. Tokens a canvas defines for itself are reported, not failed: a
 * canvas is allowed to prototype a token ahead of the code, and that list is
 * the queue of candidates to promote into app.css.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CSS = join(root, 'src/lib/styles/app.css');
const OUT = join(root, 'design_system/TOKENS.md');
const CANVAS_DIR = join(root, 'design_system');

const DARK_SELECTOR = ':root {';
const LIGHT_SELECTOR = "html[data-ledger-theme='light'] {";

/** Slice the body of the rule whose opening line starts with `selector`. */
function ruleBody(css, selector) {
	const start = css.indexOf(selector);
	if (start === -1) throw new Error(`no rule starting "${selector}" in ${relative(root, CSS)}`);
	let depth = 0;
	for (let i = start + selector.length - 1; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) return css.slice(start + selector.length, i);
	}
	throw new Error(`unterminated rule "${selector}"`);
}

/**
 * Walk a rule body, attaching each custom property to the comment block that
 * most recently preceded it. The comment IS the documentation — the stylesheet
 * explains why every value is what it is, and that reasoning is the part worth
 * carrying into the reference.
 */
function parseGroups(body) {
	const groups = [];
	let comment = null;
	let previous = null;
	let lastWasComment = false;
	let sawToken = false;
	let pending = [];
	let current = null;

	const flush = () => {
		if (current && current.tokens.length) groups.push(current);
		current = null;
	};

	for (const raw of body.split('\n')) {
		const line = raw.trim();

		if (pending.length || line.startsWith('/*')) {
			pending.push(line);
			if (line.includes('*/')) {
				const text = pending
					.join('\n')
					.replace(/^\/\*+/, '')
					.replace(/\*+\/$/, '')
					.split('\n')
					.map((l) => l.replace(/^\s*\*\s?/, '').trim())
					.join('\n')
					.trim();
				pending = [];

				// A note butted straight against the tokens above it is a footnote on
				// those tokens, not a heading for what follows — app.css closes the
				// detection block that way. Keep it with the group it belongs to.
				if (sawToken && current) {
					current.comment = current.comment ? `${current.comment}\n\n${text}` : text;
					lastWasComment = false;
					flush();
					continue;
				}

				// Two notes with only whitespace between them document the same run of
				// tokens — keep both rather than letting the second discard the first,
				// which would drop the section heading the first one carries.
				comment = lastWasComment && previous ? `${previous}\n\n${text}` : text;
				previous = comment;
				lastWasComment = true;
				flush();
				continue;
			}
			continue;
		}

		if (line === '') {
			sawToken = false;
			continue;
		}

		lastWasComment = false;

		const m = line.match(/^(--[a-z0-9-]+)\s*:\s*([^;]+);/);
		if (m) {
			if (!current) current = { comment, tokens: [] };
			current.tokens.push({ name: m[1], value: m[2].trim() });
			sawToken = true;
			continue;
		}

		// A plain declaration (`color-scheme: dark;`) claims the comment above it,
		// so the run of tokens after it does not inherit a note about something else.
		if (/^[a-z-]+\s*:/.test(line)) comment = previous = null;
		sawToken = false;
		flush();
	}
	flush();
	return groups;
}

/**
 * A group's display heading: its boxed/dashed title, else its first sentence,
 * else the token family it shares. Derived in every case — a group never gets a
 * name this script invented for it.
 */
function heading(comment, tokens) {
	const first = comment ? comment.split('\n')[0].trim() : '';
	const boxed = first.match(/^[-─]*\s*(.+?)\s*[-─]{2,}\s*$/);
	if (boxed) return boxed[1];
	if (first) {
		const sentence = first.split(/(?<=[.:])\s/)[0].replace(/[.:]$/, '');
		if (sentence.length <= 75) return sentence;
	}
	return family(tokens);
}

/** The `--x-tint` / `--series-x` shape a group of tokens has in common. */
function family(tokens) {
	const names = tokens.map((t) => t.name.slice(2));
	const suffix = names[0].includes('-') ? '-' + names[0].split('-').pop() : null;
	if (suffix && names.length > 1 && names.every((n) => n.endsWith(suffix))) {
		return suffix.slice(1).replace(/^./, (c) => c.toUpperCase());
	}
	const prefix = names[0].includes('-') ? names[0].split('-')[0] + '-' : null;
	if (prefix && names.length > 1 && names.every((n) => n.startsWith(prefix))) {
		return prefix.slice(0, -1).replace(/^./, (c) => c.toUpperCase());
	}
	if (names.length === 1) return `\`--${names[0]}\``;
	return `\`--${names[0]}\` … \`--${names[names.length - 1]}\``;
}

function collect(dir, ext, acc = []) {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) collect(p, ext, acc);
		else if (entry.endsWith(ext)) acc.push(p);
	}
	return acc.sort();
}

const collectCanvases = (dir) => collect(dir, '.dc.html');
const collectDocs = (dir) => collect(dir, '.md');

function render(css) {
	const darkGroups = parseGroups(ruleBody(css, DARK_SELECTOR));
	const lightBody = ruleBody(css, LIGHT_SELECTOR);
	const light = new Map();
	for (const g of parseGroups(lightBody)) for (const t of g.tokens) light.set(t.name, t.value);

	const src = relative(root, CSS);
	const out = [];
	out.push('# Continuum design tokens');
	out.push('');
	out.push(
		`_Generated from \`${src}\` by \`scripts/design-tokens.mjs\`. Do not edit by hand — ` +
			'run `npm run design:tokens` after changing the stylesheet._'
	);
	out.push('');
	out.push(
		'The stylesheet is the source of truth. Every note below is its own comment, kept ' +
			'here so a mockup can be authored against the shipped system without opening the app. ' +
			'A token with no **Light** value takes the same value in both themes.'
	);
	out.push('');

	for (const g of darkGroups) {
		out.push(`## ${heading(g.comment, g.tokens)}`);
		out.push('');
		if (g.comment) {
			for (const l of g.comment.split('\n')) out.push(l.trim() ? `> ${l.trim()}` : '>');
			out.push('');
		}
		out.push('| Token | Dark | Light |');
		out.push('|---|---|---|');
		for (const t of g.tokens) {
			const l = light.get(t.name);
			out.push(`| \`${t.name}\` | \`${t.value}\` | ${l ? `\`${l}\`` : '—'} |`);
		}
		out.push('');
	}

	const darkNames = new Set(darkGroups.flatMap((g) => g.tokens.map((t) => t.name)));
	const lightOnly = [...light.keys()].filter((k) => !darkNames.has(k));
	if (lightOnly.length) {
		out.push('## Light-only');
		out.push('');
		out.push(
			'> Defined in the light theme with no dark counterpart. Usually a mistake — a token ' +
				'that exists in one theme resolves to nothing in the other.'
		);
		out.push('');
		out.push('| Token | Light |');
		out.push('|---|---|');
		for (const k of lightOnly) out.push(`| \`${k}\` | \`${light.get(k)}\` |`);
		out.push('');
	}

	return out.join('\n');
}

/** Report every var(--x) in the canvases that app.css does not define. */
function drift(css) {
	const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
	const unresolved = [];
	const local = [];

	for (const file of collectCanvases(CANVAS_DIR)) {
		const text = readFileSync(file, 'utf8');
		const selfDefined = new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
		const used = new Set([...text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
		for (const name of [...used].sort()) {
			if (defined.has(name)) continue;
			(selfDefined.has(name) ? local : unresolved).push({ file: basename(file), name });
		}
	}
	return { unresolved, local };
}

/**
 * Hand-written handoff docs quote token values in tables. They are allowed to —
 * a handoff should read standalone — but a quoted value that no longer matches
 * the stylesheet is worse than no value at all, so every quote is checked
 * against both themes. TOKENS.md is exempt: it is generated from the stylesheet.
 */
function quoted(css) {
	const dark = new Map(
		[...ruleBody(css, DARK_SELECTOR).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [
			m[1],
			m[2].trim()
		])
	);
	const light = new Map(
		[...ruleBody(css, LIGHT_SELECTOR).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [
			m[1],
			m[2].trim()
		])
	);
	const same = (a, b) => b !== undefined && a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

	const wrong = [];
	for (const file of collectDocs(CANVAS_DIR)) {
		if (file === OUT) continue;
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
			const [, name, value] = m;
			if (!dark.has(name) && !light.has(name)) {
				wrong.push({ file: basename(file), name, value, expected: 'not defined in app.css' });
			} else if (!same(value, dark.get(name)) && !same(value, light.get(name))) {
				wrong.push({
					file: basename(file),
					name,
					value,
					expected: [dark.get(name), light.get(name)].filter(Boolean).join(' / ')
				});
			}
		}
	}
	return wrong;
}

const css = readFileSync(CSS, 'utf8');
const check = process.argv.includes('--check');
const doc = render(css);

if (!check) {
	writeFileSync(OUT, doc.endsWith('\n') ? doc : doc + '\n');
	const count = (doc.match(/^\| `--/gm) || []).length;
	console.log(`design:tokens — wrote ${relative(root, OUT)} (${count} tokens)`);
	process.exit(0);
}

let failed = false;

const currentDoc = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
if (currentDoc === null || currentDoc.trimEnd() !== doc.trimEnd()) {
	console.error(
		`design:tokens — ${relative(root, OUT)} is out of date with ${relative(root, CSS)}.\n` +
			'  Run: npm run design:tokens'
	);
	failed = true;
}

const { unresolved, local } = drift(css);

if (unresolved.length) {
	console.error(
		'\ndesign:tokens — canvas references a token defined nowhere (renders as nothing):'
	);
	for (const u of unresolved) console.error(`  ${u.file}: var(${u.name})`);
	failed = true;
}

const stale = quoted(css);
if (stale.length) {
	console.error('\ndesign:tokens — doc quotes a token value that no longer matches app.css:');
	for (const w of stale)
		console.error(`  ${w.file}: ${w.name} = ${w.value} (app.css: ${w.expected})`);
	failed = true;
}

if (local.length) {
	console.log('\ndesign:tokens — canvas-local tokens, candidates to promote into app.css:');
	const byFile = new Map();
	for (const l of local) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l.name]);
	for (const [file, names] of byFile) console.log(`  ${file}: ${names.join(' ')}`);
}

if (!failed)
	console.log(
		'\ndesign:tokens — reference current, every canvas token resolves, every quoted value matches.'
	);
process.exit(failed ? 1 : 0);
