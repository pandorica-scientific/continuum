import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A floating element must not be painted with a translucent token.
 *
 * `--card`, `--card2` and `--card3` are TINTS in the dark theme —
 * `rgba(255,255,255,0.03)` and friends — designed to sit on top of the page
 * background and read as a slightly raised panel. That works for a card in the
 * document flow. It does not work for anything that floats: whatever is behind
 * shows straight through, and the text becomes unreadable.
 *
 * It is a trap because it looks correct in the light theme, where the same
 * tokens are opaque hex. This was found by looking at a tooltip in dark mode,
 * not by any test — hence this one.
 *
 * Use `--bg` or `--bg2`, which are opaque in both themes. Lightbox already does.
 */

const TRANSLUCENT = ['--card', '--card2', '--card3'];

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return svelteFiles(full);
		return name.endsWith('.svelte') ? [full] : [];
	});
}

/** Rule bodies from a <style> block, as {selector, body} pairs. */
function rules(source: string): Array<{ selector: string; body: string }> {
	const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1];
	if (!style) return [];

	const out: Array<{ selector: string; body: string }> = [];
	// Flat rules only. Nesting inside @media is handled by the same scan, since
	// an inner rule still matches selector { … } on its own.
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match;
	while ((match = pattern.exec(style)) !== null) {
		out.push({ selector: match[1].trim(), body: match[2] });
	}
	return out;
}

describe('floating elements use an opaque surface', () => {
	const files = [...svelteFiles('src/lib'), ...svelteFiles('src/routes')];

	it('finds style blocks to check', () => {
		expect(files.length).toBeGreaterThan(10);
	});

	it('never paints a positioned element with a translucent card token', () => {
		const offences: string[] = [];

		for (const file of files) {
			for (const rule of rules(readFileSync(file, 'utf8'))) {
				const floats = /position:\s*(absolute|fixed)/.test(rule.body);
				if (!floats) continue;

				for (const token of TRANSLUCENT) {
					// `background:` or `background-color:`, but not `background-image`
					// or a border — only the surface the text sits on.
					const paints = new RegExp(`background(-color)?:[^;]*var\\(\\s*${token}\\s*[,)]`).test(
						rule.body
					);
					if (paints) {
						offences.push(`${file} — ${rule.selector} uses var(${token})`);
					}
				}
			}
		}

		expect(offences, offences.join('\n')).toEqual([]);
	});
});
