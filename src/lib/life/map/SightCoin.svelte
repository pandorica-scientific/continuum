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
	import { FOIL, LABEL_PAPER } from '$lib/life/map/materials';

	interface Props {
		name: string;
		/** Where it is, printed under the name. */
		where: string;
		/** Already marked off: the coin starts gone. */
		seen: boolean;
		onseen: () => void;
	}

	let { name, where, seen, onseen }: Props = $props();

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

	/** Paint the coin: the foil gradient, its grain, and the name in black. */
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

		printName(context);
	}

	/**
	 * The name, in black, wrapped to the coin.
	 *
	 * Measured rather than guessed: a coin is 84 units across and the names are
	 * anything from "Serralves" to "Mosteiro dos Jerónimos".
	 */
	function printName(context: CanvasRenderingContext2D) {
		context.save();
		context.fillStyle = '#1c1608';
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		const size = name.length > 18 ? 8 : name.length > 12 ? 9 : 10;
		context.font = `600 ${size}px system-ui, -apple-system, sans-serif`;

		const lines: string[] = [];
		let line = '';
		for (const word of name.split(' ')) {
			const next = line ? `${line} ${word}` : word;
			if (context.measureText(next).width > SIZE - 18 && line) {
				lines.push(line);
				line = word;
			} else {
				line = next;
			}
		}
		if (line) lines.push(line);

		const step = size * 1.2;
		const top = SIZE / 2 - ((lines.length - 1) * step) / 2;
		lines.forEach((one, at) => context.fillText(one, SIZE / 2, top + at * step));
		context.restore();
	}

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
	<span class="disc" class:gone style:--paper={LABEL_PAPER}>
		<!-- Underneath: the name again, so a rubbed coin still says what it was. -->
		<span class="under">{name}</span>

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
	/* Once it is rubbed the disc wears the area's colour, which is how the map
	   says "seen" everywhere else. */
	.disc.gone {
		border-color: color-mix(in srgb, var(--rose) 55%, transparent);
		background: color-mix(in srgb, var(--rose) 16%, transparent);
	}
	.under {
		padding: 0 var(--space-4);
		font-size: var(--text-2xs);
		font-weight: 600;
		line-height: 1.2;
		text-align: center;
		color: var(--fg3);
	}
	.disc.gone .under {
		color: var(--rose);
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
