<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The colour is the household's (see `personHues` in $lib/people), so the
	// same person is the same colour on every screen. Name is always printed;
	// colour is a secondary channel, never the only one.
	import { initialsFor } from '$lib/people';

	let {
		name,
		hue,
		compact = false
	}: {
		name: string;
		/** A `--series-…` token from `personHues`. */
		hue: string;
		/** Initials instead of the full name, for a crowded row. */
		compact?: boolean;
	} = $props();
</script>

<span
	class="person-tag"
	style:--tag={`var(${hue})`}
	title={compact ? name : undefined}
	aria-label={compact ? name : undefined}
>
	<span class="dot" aria-hidden="true"></span>
	{compact ? initialsFor(name) : name}
</span>

<style>
	.person-tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid color-mix(in srgb, var(--tag) 45%, transparent);
		background: color-mix(in srgb, var(--tag) 12%, transparent);
		/* Mixed towards --fg1 rather than the raw hue: some --series-… greens
		   fall below 2.8:1 contrast at full saturation on the light theme. The
		   dot keeps the exact colour; only the lettering needs to clear AA. */
		color: color-mix(in srgb, var(--tag) 70%, var(--fg1));
		border-radius: var(--radius-xl);
		padding: 1px 8px;
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--tag);
		flex: none;
	}
</style>
