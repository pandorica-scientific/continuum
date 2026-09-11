<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The gold coating over an opened country, and the pointer that takes it off.
	 *
	 * A canvas laid over the region SVG. Everything that moves lives in the
	 * `Foil` engine, not in reactive state: a `$state` list of flakes would
	 * re-render this component sixty times a second to move some rectangles.
	 *
	 * `prefers-reduced-motion` drops the residue and the frame loop, and the
	 * scratch still works. It is the interaction, not decoration.
	 */
	import { Foil, type Cell } from '$lib/life/map/foil';

	interface Props {
		cells: Cell[];
		/** Regions already visited when this opened: no coating over them. */
		clear: number[];
		/** A region has just been scratched through. */
		oncleared: (index: number, name: string) => void;
		/** A double tap on the sea, which is how somebody leaves. */
		onexit?: () => void;
	}

	let { cells, clear, oncleared, onexit }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let foil: Foil | null = null;

	$effect(() => {
		// Read so the engine is rebuilt when the country changes.
		const list = cells;
		const element = canvas;
		if (!element || list.length === 0) return;

		const engine = new Foil(element, list, new Set(clear), oncleared);
		foil = engine;
		return () => {
			engine.destroy();
			if (foil === engine) foil = null;
		};
	});

	/** Where a pointer landed, in the map's own 960 × 480 space. */
	function pointIn(event: PointerEvent): [number, number] {
		const box = (event.currentTarget as Element).getBoundingClientRect();
		return [
			((event.clientX - box.left) * 960) / box.width,
			((event.clientY - box.top) * 480) / box.height
		];
	}

	/** A single tap on the sea must not bail out mid-scratch. Two does. */
	let lastSeaTap = 0;

	function down(event: PointerEvent) {
		if (!foil) return;
		const [x, y] = pointIn(event);
		if (foil.begin(x, y)) {
			try {
				(event.currentTarget as Element).setPointerCapture(event.pointerId);
			} catch {
				// A synthetic pointer has no capture to take. Not a problem.
			}
			return;
		}

		const now = Date.now();
		if (now - lastSeaTap < 320) {
			lastSeaTap = 0;
			onexit?.();
		} else {
			lastSeaTap = now;
		}
	}
</script>

<canvas
	bind:this={canvas}
	width="960"
	height="480"
	aria-hidden="true"
	onpointerdown={down}
	onpointermove={(event) => foil?.move(...pointIn(event))}
	onpointerup={() => foil?.end()}
	onpointercancel={() => foil?.end()}
	onpointerleave={() => foil?.end()}
></canvas>

<style>
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* The coin, near enough: a scratch is a drag, and the cursor should not
		   promise a click. */
		cursor: crosshair;
		touch-action: none;
	}
</style>
