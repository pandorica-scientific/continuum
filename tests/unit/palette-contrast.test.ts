import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every pill is translucent ink over a translucent tint over a card that is
// itself over a gradient canvas. Reading that stack from the browser is what
// makes contrast auditing here unreliable — a getComputedStyle walk sees the
// tint's own rgba and, in dark mode, falls back to white for the ground and
// reports nonsense. So the stack is flattened arithmetically from the token
// values instead, which is exact and needs no browser.

type Rgb = [number, number, number];

const CSS = readFileSync('src/lib/styles/app.css', 'utf8');

function block(selector: string): Record<string, string> {
	const start = CSS.indexOf(selector);
	if (start < 0) throw new Error(`No ${selector} block in app.css`);
	const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
	);
}

function parse(value: string): { rgb: Rgb; alpha: number } {
	const hex = value.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
	}
	const rgba = value.match(/^rgba?\(([^)]+)\)$/);
	if (!rgba) throw new Error(`Cannot parse colour: ${value}`);
	const parts = rgba[1].split(',').map((p) => Number(p.trim()));
	return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
}

/** Composite `over` onto `under`, both already opaque-resolved. */
function flatten(over: { rgb: Rgb; alpha: number }, under: Rgb): Rgb {
	return under.map((u, i) => over.rgb[i] * over.alpha + u * (1 - over.alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Derived, never listed. A hardcoded roster is a hole that opens silently: this
 * list held seven names while the palette had nine tint families, so `--indigo`
 * and `--brand` shipped as pill fills that no test had ever measured. Reading the
 * families out of the stylesheet means a hue added tomorrow is checked tomorrow.
 *
 * A tint with no ink of the same name is not a pill and is skipped — `--grey-tint`
 * is a ground, and there is no `--grey` to set on it.
 */
function pillHues(tokens: Record<string, string>): string[] {
	return Object.keys(tokens)
		.filter((name) => name.endsWith('-tint'))
		.map((name) => name.slice(2, -'-tint'.length))
		.filter((hue) => tokens[`--${hue}`] !== undefined);
}

/** The canvas is a gradient; its lighter end is the harder ground for dark ink. */
function ground(tokens: Record<string, string>): Rgb {
	const canvas = parse(tokens['--bg']).rgb;
	return flatten(parse(tokens['--card']), canvas);
}

describe.each([
	['dark', ':root {'],
	['light', "html[data-ledger-theme='light'] {"]
])('%s theme contrast', (_name, selector) => {
	const tokens = block(selector);

	const hues = pillHues(tokens);

	// Guards the derivation itself: an empty roster would make every case below
	// vacuous, which is exactly the failure the hardcoded list used to hide.
	it('has a pill hue to check', () => {
		expect(hues.length).toBeGreaterThan(7);
	});

	// A pill is its hue as text on its own tint, over a card, over the canvas.
	it.each(hues)('%s pill text clears AA on its own tint', (hue) => {
		const tint = tokens[`--${hue}-tint`];
		const ink = tokens[`--${hue}`];
		expect(tint, `--${hue}-tint is missing`).toBeDefined();
		const behind = flatten(parse(tint), ground(tokens));
		expect(ratio(parse(ink).rgb, behind)).toBeGreaterThanOrEqual(4.5);
	});

	it('muted body text clears AA on a card', () => {
		expect(ratio(parse(tokens['--fg3']).rgb, ground(tokens))).toBeGreaterThanOrEqual(4.5);
	});

	it('body text clears AA on a card', () => {
		expect(ratio(parse(tokens['--fg2']).rgb, ground(tokens))).toBeGreaterThanOrEqual(4.5);
	});
});
