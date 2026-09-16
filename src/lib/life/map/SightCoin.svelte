<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One place worth the detour, under a gold coin you rub off.
	 *
	 * The same material as the map — the foil gradient and the same crumbly brush
	 * stamps — at coin scale. The name is printed ON the coin in black, so a
	 * covered coin still tells you what it is: the scratch marks it as SEEN, it
	 * does not reveal a secret. A coin you cannot read is a lottery ticket, and
	 * this is a list of places.
	 *
	 * Cleared at 78% of the disc, sampled on a grid — the prototype's number.
	 */
	import { FOIL } from '$lib/life/map/materials';

	interface Props {
		name: string;
		/** Where it is, printed under the name. */
		where: string;
		/**
		 * The engraving the gold hides.
		 *
		 * Never null: a place without one is not offered as a coin at all, because
		 * a gold disc hiding nothing promises a reveal it cannot deliver.
		 */
		art: string;
		/**
		 * The country's own palette token, so a rubbed coin wears the same colour
		 * its country wears on the map. Passed in rather than worked out here: the
		 * assignment is spatial and lives in `country-colour.ts`.
		 */
		colour: string;
		/** Already marked off: the coin starts gone. */
		seen: boolean;
		onseen: () => void;
	}

	let { name, where, art, colour, seen, onseen }: Props = $props();

	/** The coin's drawn size. The element scales; the canvas is fixed. */
	const SIZE = 84;

	/** Cleared enough to count. Below this a coin can be nudged by accident. */
	const CLEARED = 0.78;

	let canvas = $state<HTMLCanvasElement | null>(null);
	let rubbed = $state(false);
	let stamps: HTMLCanvasElement[] = [];
	let rubbing = false;

	const gone = $derived(seen || rubbed);

	/** Crumbly stamps, as the map's brush uses. Made once per coin. */
	function makeStamps(): HTMLCanvasElement[] {
		return Array.from({ length: 6 }, () => {
			const made = document.createElement('canvas');
			made.width = 30;
			made.height = 30;
			const context = made.getContext('2d')!;
			context.fillStyle = '#fff';
			context.beginPath();
			context.arc(15, 15, 7, 0, 7);
			context.fill();
			for (let i = 0; i < 34; i++) {
				const angle = Math.random() * 7;
				const away = 15 * (0.3 + Math.random() * 0.65);
				context.globalAlpha = 0.35 + Math.random() * 0.65;
				context.beginPath();
				context.arc(
					15 + Math.cos(angle) * away,
					15 + Math.sin(angle) * away,
					1 + Math.random() * 2.6,
					0,
					7
				);
				context.fill();
			}
			return made;
		});
	}

	/** Paint the coin: the foil gradient and its grain. Nothing else. */
	function paint(element: HTMLCanvasElement) {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		element.width = SIZE * dpr;
		element.height = SIZE * dpr;
		const context = element.getContext('2d')!;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, SIZE, SIZE);

		const gold = context.createLinearGradient(0, 0, SIZE, SIZE);
		gold.addColorStop(0, FOIL[0]);
		gold.addColorStop(0.5, FOIL[2]);
		gold.addColorStop(1, FOIL[3]);
		context.fillStyle = gold;
		context.beginPath();
		context.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, 7);
		context.fill();

		// The rolled grain, as on the map's foil.
		context.save();
		context.beginPath();
		context.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, 7);
		context.clip();
		for (let y = 0; y < SIZE; y += 1.6) {
			const light = ((0.42 + Math.random() * 0.2) * 100) | 0;
			context.strokeStyle = `hsla(42, 34%, ${light}%, ${(0.07 + Math.random() * 0.14).toFixed(2)})`;
			context.lineWidth = 0.4 + Math.random();
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(SIZE, y + (Math.random() - 0.5) * 2);
			context.stroke();
		}
		context.restore();
	}

	/**
	 * Undo, without the parent reaching in.
	 *
	 * A coin is gone because the server said so (`seen`) or because it was just
	 * rubbed (`rubbed`). When the parent takes this place back out of its seen
	 * list, the local flag has to go with it or the gold never returns — so the
	 * coin watches the prop rather than exposing a method for the row to call.
	 *
	 * That is also what keeps the row free of component handles: an undo is a
	 * change of state, and state flows down.
	 */
	$effect(() => {
		if (!seen) rubbed = false;
	});

	$effect(() => {
		const element = canvas;
		if (!element) return;
		if (gone) {
			const context = element.getContext('2d');
			context?.clearRect(0, 0, element.width, element.height);
			return;
		}
		stamps = makeStamps();
		paint(element);
	});

	function rub(event: PointerEvent) {
		const element = canvas;
		if (!element || gone) return;

		const box = element.getBoundingClientRect();
		const dpr = element.width / box.width;
		const x = (event.clientX - box.left) * dpr;
		const y = (event.clientY - box.top) * dpr;

		const context = element.getContext('2d')!;
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.globalCompositeOperation = 'destination-out';
		const size = 30 * dpr;
		context.translate(x, y);
		context.rotate(Math.random() * 7);
		context.drawImage(
			stamps[(Math.random() * stamps.length) | 0],
			-size / 2,
			-size / 2,
			size,
			size
		);
		context.restore();

		check(element);
	}

	/** How much of the disc is gone, on a grid inside the circle. */
	function check(element: HTMLCanvasElement) {
		const context = element.getContext('2d')!;
		const w = element.width;
		const h = element.height;
		let clear = 0;
		let total = 0;

		for (let i = 3; i < 12; i++) {
			for (let j = 3; j < 12; j++) {
				const px = Math.round((w * i) / 14);
				const py = Math.round((h * j) / 14);
				if (Math.hypot(px - w / 2, py - h / 2) > w / 2 - 2) continue;
				total++;
				if (context.getImageData(px, py, 1, 1).data[3] < 90) clear++;
			}
		}

		if (total && clear / total >= CLEARED) {
			rubbed = true;
			onseen();
		}
	}
</script>

<div class="sight">
	<span class="disc" class:gone style:--coin="var(--{colour})">
		<!--
			Underneath: the engraving of this place. The name is NOT here — it sits
			below the ring, where it is legible whatever the coin's state. What the
			gold hides should be worth uncovering, and a name is not.
		-->
		<img class="art" src={art} alt="" width={SIZE} height={SIZE} loading="lazy" />

		{#if !gone}
			<canvas
				bind:this={canvas}
				width={SIZE}
				height={SIZE}
				aria-hidden="true"
				onpointerdown={(event) => {
					rubbing = true;
					try {
						(event.currentTarget as Element).setPointerCapture(event.pointerId);
					} catch {
						// A synthetic pointer has no capture to take.
					}
					rub(event);
				}}
				onpointermove={(event) => rubbing && rub(event)}
				onpointerup={() => (rubbing = false)}
				onpointercancel={() => (rubbing = false)}
				onpointerleave={() => (rubbing = false)}
			></canvas>
		{/if}
	</span>

	<span class="name" class:gone>{name}</span>
	{#if where}<span class="where">{where}</span>{/if}
</div>

<style>
	.sight {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		width: 84px;
		flex: 0 0 auto;
	}
	.disc {
		position: relative;
		width: 84px;
		height: 84px;
		border-radius: var(--radius-pill);
		overflow: hidden;
		display: grid;
		place-items: center;
		border: 1px solid rgba(46, 37, 8, 0.5);
	}
	/*
	 * Once it is rubbed the disc IS the country's colour — 82%, the same strength
	 * `countryFill` paints that country with on the map, so a coin from Czechia
	 * and Czechia itself are the same blue.
	 *
	 * The remaining 18% is paper rather than the page. The engraving is dark ink
	 * on transparency with no white behind it, so on a dark ground it needs a
	 * bright backing to read as ink rather than ink-on-ink — inverting the image
	 * instead would turn these dense tonal engravings into photographic negatives.
	 *
	 * `--label-paper` for the same reason the bottle plates use it: a print is the
	 * same colour in a dark room as a lit one, so this pair of tokens deliberately
	 * does not follow the theme.
	 */
	.disc.gone {
		border-color: color-mix(in srgb, var(--coin) 55%, transparent);
		background: color-mix(in srgb, var(--coin) 82%, var(--label-paper));
	}
	.art {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: crosshair;
	}
	.name {
		font-size: var(--text-sm);
		line-height: 1.25;
		text-align: center;
		color: var(--fg3);
	}
	.name.gone {
		color: var(--fg1);
	}
	.where {
		font-size: var(--text-2xs);
		color: var(--fg3);
	}
</style>
