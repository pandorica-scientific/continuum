<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The places worth the detour in one country, as coins to rub off.
	 *
	 * Only places whose engraving has been drawn appear here — a place without
	 * one is not a coin, because a gold disc hiding nothing promises a reveal it
	 * cannot deliver. So a country shows a full row, a short one, or no band at
	 * all, and fills in as batches of artwork land.
	 *
	 * Rubbing a coin records that the PLACE has been seen and says nothing about
	 * the country. That is the whole point of the separation and it is stated
	 * under the row, because it is the one thing here that looks like a bug.
	 */
	import { submitAction } from '$lib/actions/result';
	import SightCoin from '$lib/life/map/SightCoin.svelte';

	interface Sight {
		id: string;
		name: string;
		where: string;
		art: string;
	}

	let {
		sights,
		seen,
		colour,
		onseen
	}: {
		sights: Sight[];
		/** The country's palette token, for a rubbed coin's colour. */
		colour: string;
		/** Place ids already rubbed off, from the server. */
		seen: string[];
		/** Record it, and say whether that stuck. */
		onseen: (id: string) => Promise<boolean>;
	} = $props();

	/** Rubbed in this session, on top of what the server already knew. */
	let justSeen = $state<string[]>([]);
	/**
	 * Taken back in this session, which has to outrank `seen`.
	 *
	 * Dropping the id from `justSeen` alone is not enough: a region scratched in
	 * the same five seconds invalidates the visit query, the page's `seen` comes
	 * back carrying this place, and the coin would stay rubbed over a row the
	 * server has already deleted. The next load agrees with this list.
	 */
	let takenBack = $state<string[]>([]);
	const gone = $derived(new Set([...seen, ...justSeen].filter((id) => !takenBack.includes(id))));

	let toast = $state<string | null>(null);
	let undoable = $state<{ id: string; name: string } | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** The same five seconds the region scratch offers, for the same reason. */
	const UNDO_WINDOW_MS = 5000;

	function say(message: string, offer: { id: string; name: string } | null = null) {
		toast = message;
		undoable = offer;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			toast = null;
			undoable = null;
		}, UNDO_WINDOW_MS);
	}

	async function rubbed(sight: Sight) {
		takenBack = takenBack.filter((one) => one !== sight.id);
		justSeen = [...justSeen, sight.id];
		say(`${sight.name} — seen.`, { id: sight.id, name: sight.name });
		if (!(await onseen(sight.id))) {
			say(`${sight.name} — seen here, but it could not be saved.`);
		}
	}

	/**
	 * Put the gold back.
	 *
	 * The coating goes back first and unconditionally: somebody just undid a
	 * gesture on purpose, so the screen obeys rather than waiting to hear whether
	 * a delete succeeded.
	 */
	async function undo() {
		const taking = undoable;
		if (!taking) return;
		undoable = null;

		// Each coin watches its own `seen` prop and puts its gold back when this
		// stops being true — which means overriding what the server last said as
		// well as forgetting the rub.
		justSeen = justSeen.filter((one) => one !== taking.id);
		takenBack = [...takenBack, taking.id];

		const body = new FormData();
		body.set('place', taking.id);
		// `submitAction` deserializes the action's own result. The bare fetch this
		// replaces only caught a network error — `fetch` does not throw on 400 or
		// 500 — so a refused delete still said "put back".
		const outcome = await submitAction('?/unseen', body, { updatePage: false });
		if (outcome.type !== 'success') {
			// The override comes off again: the row is still there, so the coin
			// should go back to agreeing with the server rather than holding a
			// state nothing else believes in.
			takenBack = takenBack.filter((one) => one !== taking.id);
			justSeen = [...justSeen, taking.id];
			say(`${taking.name} — it could not be put back.`);
			return;
		}
		say(`${taking.name} — put back.`);
	}
</script>

<section class="sights">
	<h2 class="eyebrow">Worth the detour</h2>

	<div class="row">
		{#each sights as sight (sight.id)}
			<SightCoin
				name={sight.name}
				where={sight.where}
				art={sight.art}
				{colour}
				seen={gone.has(sight.id)}
				onseen={() => rubbed(sight)}
			/>
		{/each}
	</div>

	{#if toast}
		<p class="toast" role="status">
			<span>{toast}</span>
			{#if undoable}
				<button type="button" class="undo" onclick={undo}>Undo</button>
			{/if}
		</p>
	{/if}

	<p class="credit">
		Places from <a href="https://wikivoyage.org" rel="noreferrer">Wikivoyage</a> and
		<a href="https://whc.unesco.org" rel="noreferrer">UNESCO</a>, CC BY-SA 4.0.
	</p>
</section>

<style>
	.sights {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-top: var(--space-7);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		align-self: flex-start;
		margin: 0;
		padding: var(--space-3) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		background: var(--bg2);
		color: var(--fg1);
		font-size: var(--text-sm);
	}
	.undo {
		padding: 0;
		border: 0;
		background: none;
		color: var(--brand);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.undo:hover {
		color: var(--fg1);
	}
	.credit {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
