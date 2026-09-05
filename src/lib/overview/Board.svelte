<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import FirstRunPicker from './FirstRunPicker.svelte';
	import Panel from './Panel.svelte';
	import PanelChip from './PanelChip.svelte';
	import PanelContent from './PanelContent.svelte';
	import PeriodControls from '$lib/charts/PeriodControls.svelte';
	import {
		COLUMNS,
		compact,
		firstFreeSlot,
		packInOrder,
		visible,
		type OverviewPlacement
	} from './layout';
	import { SUGGESTED_LAYOUT, PANELS, panelDefinition } from './panels';

	let {
		layout,
		panels,
		currency,
		available,
		firstRun,
		customising = $bindable(false)
	}: {
		layout: OverviewPlacement[];
		// Panel data is keyed by panel key; each component types its own shape.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		panels: Record<string, any>;
		currency: string;
		available: (key: string) => boolean;
		/** This person has never stored an arrangement, so the empty board is a
		 *  question rather than a state they put it in. */
		firstRun: boolean;
		/** Owned by the screen, which draws the Customise button in its header;
		 *  the board reads it and clears it when Done is pressed from the tray. */
		customising?: boolean;
	} = $props();

	const ROW = 40;
	const GAP = 16;
	const PITCH = ROW + GAP;
	const NARROW = 900;

	// The board owns the arrangement once it is mounted; the loader's copy is
	// only the starting point, and re-reading it on every save would fight the
	// drag in progress.
	let working = $state<OverviewPlacement[]>(untrack(() => structuredClone(layout)));
	// Whether the picker is still on screen. Nothing but Done takes it away —
	// picking a panel is not an answer to "which panels do you want", and a
	// picker that closed on the first press would put the other seventeen back
	// behind a Customise button this person has not found yet.
	//
	// Untracked for the same reason `working` is: `add` invalidates, which tells
	// the loader this person now has a stored arrangement, and the picker must
	// not disappear underneath the panel they just chose.
	let untouched = $state(untrack(() => firstRun));
	let narrow = $state(false);
	let failed = $state(false);
	let board = $state<HTMLDivElement | null>(null);

	// While customising, the true stored arrangement is shown — including the
	// space held by panels whose module is off. Editing a gap-closed board would
	// write back positions that are not the ones being stored, and re-enabling a
	// module would no longer restore a panel to where its owner put it.
	const placements = $derived(customising ? working : visible(working, available));

	// The narrow view has no grid to place panels on, so it renders in array
	// order, so it is sorted by cell: that makes a coordinate change visible,
	// and makes the stack read top-to-bottom the way the wide board does rather
	// than showing the order panels happened to be added in.
	const ordered = $derived(
		narrow ? [...placements].sort((a, b) => a.y - b.y || a.x - b.x) : placements
	);

	$effect(() => {
		const query = window.matchMedia(`(max-width: ${NARROW - 1}px)`);
		const sync = () => (narrow = query.matches);
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

	const unplaced = $derived(
		PANELS.filter((panel) => available(panel.key) && !working.some((p) => p.k === panel.key))
	);

	function columnWidth(): number {
		const width = board?.getBoundingClientRect().width ?? 0;
		return (width - GAP * (COLUMNS - 1)) / COLUMNS;
	}

	// Only the newest save may adopt a response: an earlier request answering
	// late would otherwise undo a later change.
	let saved = 0;

	async function save(next: OverviewPlacement[]) {
		working = next;
		const attempt = ++saved;
		try {
			const response = await fetch('/overview/layout', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(next)
			});
			failed = !response.ok;
			// The endpoint hands back what it actually stored, having clamped
			// anything out of bounds. Taking it is what stops the board and the
			// database disagreeing until the next reload — but never on top of a
			// gesture in progress.
			if (response.ok && attempt === saved && !gesture) {
				const body = await response.json();
				if (Array.isArray(body?.layout)) working = body.layout;
			}
		} catch {
			// Keep the arrangement on screen: rolling back the drag someone just
			// made is a worse answer than telling them it has not been saved.
			failed = true;
		}
	}

	function indexOf(key: string): number {
		return working.findIndex((p) => p.k === key);
	}

	// ---- Dragging and resizing ----

	let gesture = $state<{
		key: string;
		mode: 'move' | 'resize';
		startX: number;
		startY: number;
		from: OverviewPlacement;
		col: number;
		live: boolean;
	} | null>(null);

	function begin(mode: 'move' | 'resize', key: string, event: PointerEvent) {
		const index = indexOf(key);
		if (index < 0) return;
		event.preventDefault();
		// Capture keeps the gesture alive if the pointer leaves the window, but it
		// throws when the browser does not consider this pointer active. The
		// window listeners below are what actually drive the drag, so a refused
		// capture must not take the whole gesture down with it.
		try {
			(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		} catch {
			// Nothing to do: the drag works without it.
		}
		gesture = {
			key,
			mode,
			startX: event.clientX,
			startY: event.clientY,
			from: { ...working[index] },
			col: columnWidth(),
			live: false
		};
	}

	function move(event: PointerEvent) {
		if (!gesture) return;
		const dx = event.clientX - gesture.startX;
		const dy = event.clientY - gesture.startY;
		// Five pixels of slack separates a drag from a click.
		if (!gesture.live && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
		gesture.live = true;

		const index = indexOf(gesture.key);
		if (index < 0) return;
		const from = gesture.from;
		const bounds = panelDefinition(gesture.key);
		if (!bounds) return;
		const dCol = Math.round(dx / (gesture.col + GAP));
		const dRow = Math.round(dy / PITCH);

		const next = [...working];
		if (gesture.mode === 'move') {
			next[index] = {
				...from,
				x: Math.min(COLUMNS - from.w, Math.max(0, from.x + dCol)),
				y: Math.max(0, from.y + dRow)
			};
		} else {
			const w = Math.min(COLUMNS - from.x, Math.max(bounds.minW, from.w + dCol));
			next[index] = { ...from, w, h: Math.max(bounds.minH, from.h + dRow) };
		}
		working = compact(next, index);
	}

	function end() {
		if (!gesture) return;
		const { key, live } = gesture;
		gesture = null;
		if (!live) return;
		// On release the dropped panel joins the rest: the board pulls up so it
		// holds no empty rows, and its own row decides where it lands.
		if (indexOf(key) >= 0) save(compact(working));
	}

	// ---- Tray, removal, reordering, reset ----

	function add(key: string) {
		const panel = panelDefinition(key);
		if (!panel) return;
		const slot = firstFreeSlot(working, panel.defaultW, panel.defaultH);
		save(compact([...working, { k: key, ...slot, w: panel.defaultW, h: panel.defaultH }])).then(
			() =>
				// The panel has no data until the loader knows it is placed.
				invalidateAll()
		);
	}

	function remove(key: string) {
		save(compact(working.filter((p) => p.k !== key)));
	}

	// Exchange the two panels in reading order and lay the board out again.
	// Swapping their cells does not work: a short panel traded with a tall one
	// overlaps it, and the board then pushes the short one straight back below,
	// leaving the order on screen exactly as it was.
	function reorder(key: string, direction: -1 | 1) {
		const list = [...ordered];
		const at = list.findIndex((p) => p.k === key);
		const target = at + direction;
		if (at < 0 || target < 0 || target >= list.length) return;
		[list[at], list[target]] = [list[target], list[at]];
		save(packInOrder(list));
	}

	function reset() {
		untouched = false;
		save(structuredClone(SUGGESTED_LAYOUT)).then(() => invalidateAll());
	}
</script>

<svelte:window onpointermove={move} onpointerup={end} onpointercancel={end} />

{#if customising || failed}
	<!-- The Customise button itself is in the screen header, beside the title,
	     where the handoff puts a screen's one action. This bar holds only what
	     is said while arranging. -->
	<div class="bar">
		{#if customising}
			<button type="button" onclick={reset}>Reset to the suggested board</button>
			{#if narrow}
				<span class="note">
					There is one board. Reordering here also changes how it is arranged on a wider screen.
				</span>
			{/if}
		{/if}
		{#if failed}
			<span class="failed">That change has not been saved. It will be retried on the next one.</span
			>
		{/if}
	</div>
{/if}

{#if customising && unplaced.length}
	<div class="tray">
		<span class="tray-label">Add a panel</span>
		{#each unplaced as panel (panel.key)}
			<!-- No description here: the board behind the tray is already showing
			     what these panels look like. -->
			<PanelChip
				icon={panel.icon}
				hue={panel.hue}
				title={panel.title}
				onclick={() => add(panel.key)}
			/>
		{/each}
	</div>
{/if}

<!--
	Above the board rather than inside its empty branch. In the branch, the first
	chip somebody pressed filled the board and took the other seventeen off the
	screen with it — not what "pick as many panels as you like" offers. Here the
	board fills in underneath while the picker stands, and a panel that has been
	placed leaves the grid on its own because it leaves `unplaced`. Customising
	hides it: the tray above is the same offer in the mode built for it.
-->
{#if untouched && !customising}
	<div class="first-run">
		<FirstRunPicker
			panels={unplaced}
			onadd={add}
			onsuggested={reset}
			ondone={() => (untouched = false)}
		/>
	</div>
{/if}

<div
	class="board"
	class:narrow
	bind:this={board}
	style:--row="{ROW}px"
	style:--gap="{GAP}px"
	style:--columns={COLUMNS}
>
	{#each ordered as placement (placement.k)}
		{@const panel = panelDefinition(placement.k)}
		{@const off = !available(placement.k)}
		<div
			class="slot"
			style:grid-column={narrow ? '1 / -1' : `${placement.x + 1} / span ${placement.w}`}
			style:grid-row={narrow ? 'auto' : `${placement.y + 1} / span ${placement.h}`}
			class:lifted={gesture?.key === placement.k && gesture.live}
		>
			{#if !panel}
				<div class="reserved">
					<span class="reserved-note">This panel no longer exists in this version.</span>
				</div>
			{:else if off}
				<div class="reserved">
					<span class="eyebrow"><Icon name={panel.icon} size={14} />{panel.title}</span>
					<span class="reserved-note">
						Its module is switched off. The space is held so the panel comes back where you left it.
					</span>
					<button type="button" onclick={() => remove(placement.k)}>Remove anyway</button>
				</div>
			{:else}
				<Panel
					title={panel.title}
					icon={panel.icon}
					hue={panel.hue}
					href={panel.href}
					headControls={panel.headControls}
					{customising}
					{narrow}
					dragging={gesture?.key === placement.k && gesture.live}
					widthBadge={gesture?.key === placement.k && gesture.live
						? `${placement.w}/${COLUMNS}`
						: null}
					canMoveUp={ordered.indexOf(placement) > 0}
					canMoveDown={ordered.indexOf(placement) < ordered.length - 1}
					onremove={() => remove(placement.k)}
					onmoveup={() => reorder(placement.k, -1)}
					onmovedown={() => reorder(placement.k, 1)}
					onpointerdown={(event) => begin('move', placement.k, event)}
					onresizestart={(event) => begin('resize', placement.k, event)}
				>
					{#snippet controls()}
						{#if panel.headControls === 'period' && panels[placement.k]}
							<!-- The window comes out of the figures rather than off a prop
							     of its own: the loader clamps the anchor against what the
							     record holds, so the only period the control can show is
							     the one the chart beneath it was drawn for. -->
							<PeriodControls
								period={panels[placement.k].period}
								anchor={panels[placement.k].anchor}
								bounds={panels[placement.k].bounds}
								caption={panels[placement.k].caption}
							/>
						{/if}
					{/snippet}
					<PanelContent panelKey={placement.k} data={panels[placement.k]} {currency} />
				</Panel>
			{/if}
		</div>
	{:else}
		<!-- Only where the picker is not already asking. This line is for the
		     other empty board: somebody who took every panel off, who has
		     answered this question once and is not being asked it again. -->
		{#if !untouched || customising}
			<p class="empty">
				Your board is empty. Press Customise to add a panel, or reset to the suggested board.
			</p>
		{/if}
	{/each}
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.bar button {
		background: var(--card2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		color: var(--fg2);
		font-size: var(--text-md);
		padding: 6px 13px;
		cursor: pointer;
	}
	.bar button:hover {
		background: var(--card3);
	}
	.note,
	.failed {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.45;
	}
	.failed {
		color: var(--yellow);
	}
	/* The chips inside are PanelChip's, styling and all: the tray and the
	   first-run picker offer the same thing and used to draw it twice. */
	/* Dashed and brand-tinted: the tray only exists in customise mode, and the
	   dashes say "a place things go" rather than "a card of content" — the same
	   vocabulary as the dashed Add-a-shelf and Add-a-loan cards. */
	.tray {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		padding: var(--space-6) var(--space-7);
		margin-bottom: var(--space-8);
		background: color-mix(in srgb, var(--brand) 6%, transparent);
		border: 1px dashed color-mix(in srgb, var(--brand) 45%, transparent);
		border-radius: var(--radius-card);
	}
	.tray-label {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	/* Rows are a floor, not a size: a panel taller than the rows it was given
	   makes them taller and everything below moves down. Nothing on the board
	   scrolls inside itself; the page is the one thing that scrolls. */
	.board {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
		grid-auto-rows: minmax(var(--row), auto);
		gap: var(--gap);
	}
	/* One column, natural height: fixed row pitch and inner scrollbars are
	   miserable on a phone. */
	.board.narrow {
		grid-template-columns: minmax(0, 1fr);
		grid-auto-rows: auto;
	}
	.slot {
		min-width: 0;
		min-height: 0;
	}
	.slot.lifted {
		z-index: 5;
	}
	.reserved {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		height: 100%;
		padding: var(--space-7) var(--space-8);
		border: 1px dashed var(--bd2);
		border-radius: var(--radius-lg);
		opacity: 0.7;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.reserved-note {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.45;
	}
	.reserved button {
		background: none;
		border: none;
		padding: 0;
		color: var(--fg3);
		font-size: var(--text-sm);
		text-decoration: underline;
		cursor: pointer;
	}
	.empty {
		grid-column: 1 / -1;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	/* Its own block above the board, spaced like the bar and the tray are. */
	.first-run {
		margin-bottom: 16px;
	}
</style>
