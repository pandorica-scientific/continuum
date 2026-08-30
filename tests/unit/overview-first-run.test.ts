// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The picker stands ABOVE the board, not in the branch the board draws when it
 * is holding nothing. That distinction is the whole interaction: inside the
 * empty branch, the first chip somebody pressed put a panel on the board and
 * took the other seventeen off the screen with it — which is not what "pick as
 * many panels as you like" offers. Above it, the board fills in underneath
 * while the picker stands, and only Done closes it.
 *
 * That is a question about WHERE a component sits in the template, and reading
 * the file as text cannot answer it — an `{#if}` nested inside the empty branch
 * and one wrapped around the whole grid look much the same in a string. So the
 * component is parsed and the tree is walked, the way svelte-markup.ts parses
 * rather than reaching for a regular expression.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';

const BOARD = 'src/lib/overview/Board.svelte';

type Node = Record<string, unknown>;

const source = readFileSync(BOARD, 'utf8');
const board = parse(source, { modern: true });

/** A node's own text, for reading a condition back as it was written. */
const sourceOf = (node: Node): string => source.slice(node.start as number, node.end as number);

/** Every node under `value`, at any depth. */
function nodesIn(value: unknown, seen = new Set<unknown>()): Node[] {
	if (!value || typeof value !== 'object' || seen.has(value)) return [];
	seen.add(value);
	const self =
		!Array.isArray(value) && typeof (value as Node).type === 'string' ? [value as Node] : [];
	return [...self, ...Object.values(value).flatMap((child) => nodesIn(child, seen))];
}

/** The components rendered somewhere under `value`, named. */
const componentsUnder = (value: unknown): string[] =>
	nodesIn(value)
		.filter((node) => node.type === 'Component')
		.map((node) => node.name as string);

/** The `{#each}` block over a given expression. */
function eachOver(expression: string): Node {
	const block = nodesIn(board.fragment).find(
		(node) =>
			node.type === 'EachBlock' && (node.expression as Node | undefined)?.name === expression
	);
	if (!block) throw new Error(`${BOARD} has no {#each} over ${expression}.`);
	return block;
}

describe('the first-run picker', () => {
	it('stands outside the board, so picking a panel does not close it', () => {
		// Not in the each block at all — neither in a placed panel nor in the
		// fallback, which is the version that vanished on the first press.
		expect(componentsUnder(eachOver('ordered'))).not.toContain('FirstRunPicker');
		// And exactly once in the component, so there is one offer to close.
		expect(
			componentsUnder(board.fragment).filter((name) => name === 'FirstRunPicker')
		).toHaveLength(1);
	});

	it('is shown until it is dismissed, and never over the Customise tray', () => {
		const gate = nodesIn(board.fragment).find(
			(node) =>
				node.type === 'IfBlock' && componentsUnder(node.consequent).includes('FirstRunPicker')
		);
		expect(gate, 'the picker is behind no condition at all').toBeDefined();
		// `untouched` is the person's own dismissal, not the board's contents:
		// gating on what is placed is what made the first pick close it.
		expect(sourceOf(gate!.test as Node)).toBe('untouched && !customising');
	});

	it('draws the tray from the same chip the picker uses', () => {
		const tray = eachOver('unplaced');
		expect(componentsUnder(tray.body)).toContain('PanelChip');
		// The chip owns the button and its styling now. One left behind here is
		// the copy that drifts from the one in the picker.
		const elements = nodesIn(tray.body)
			.filter((node) => node.type === 'RegularElement')
			.map((node) => node.name as string);
		expect(elements).not.toContain('button');
	});
});
