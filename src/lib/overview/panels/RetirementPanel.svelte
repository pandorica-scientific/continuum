<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Pill from '$lib/components/Pill.svelte';
	import type { Hue } from '$lib/ui/hue';

	let { data }: { data: { hue: Hue; pill: string; headline: string; detail: string } } = $props();
</script>

<div class="stack">
	<Pill hue={data.hue}>{data.pill}</Pill>
	<span class="headline">{data.headline}</span>
	<span class="detail">{data.detail}</span>
	<a href="/retirement" class="open-link">Open the projection →</a>
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
	}
	.headline {
		font-size: 14px;
		font-weight: 500;
		line-height: 1.4;
	}
	.detail {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.5;
	}
	.open-link {
		font-size: 12.5px;
	}
</style>
