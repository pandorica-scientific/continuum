import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';

/**
 * A component's TEMPLATE, with its script and style blocks taken out.
 *
 * Several tests assert something about markup — that no `{#await}` wraps an
 * `import()`, that `srcObject` is never bound in a template — and each has to
 * search the template alone. Searching the whole file flags the comments that
 * explain the very rule being enforced, which is how the first version of one
 * of these tests failed.
 *
 * This replaced a `replace(/<script[\s\S]*?<\/script>/g, '')`, which worked on
 * every component here but is wrong in two ways. It leaves `<style>` behind, so
 * the "markup" it returns includes CSS and a selector or a content string can
 * match a rule meant for the template. And it reads to a static analyser as a
 * hand-rolled HTML sanitiser — which it is not, since nothing here renders
 * anything — so it raises security alerts that have to be dismissed by hand on
 * every pass.
 *
 * Svelte's own parser already knows exactly where those blocks begin and end,
 * so it is asked instead. A file that will not parse throws, which is worth
 * hearing about rather than swallowing.
 */
export function markupOf(path: string): string {
	return markupIn(readFileSync(path, 'utf8'));
}

/** The same, for a component held as a string. */
export function markupIn(source: string): string {
	const ast = parse(source, { modern: true });
	// Last one first, so removing a block cannot shift the offsets of the next.
	const blocks = [ast.instance, ast.module, ast.css]
		.filter((block) => block != null)
		.sort((one, two) => two.start - one.start);

	let markup = source;
	for (const block of blocks) {
		markup = markup.slice(0, block.start) + markup.slice(block.end);
	}
	return markup;
}
