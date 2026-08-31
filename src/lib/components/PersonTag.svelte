<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A person's name, in that person's colour.
	 *
	 * The colour is the household's, not the screen's — see `personHues` in
	 * $lib/people — so the same person is the same colour on Salary, Tax and
	 * Documents alike. That is the whole point of it: a tag whose colour changes
	 * per screen is decoration, and reading a table by colour then teaches
	 * something untrue.
	 *
	 * The name is always printed. Colour is a second channel on top of it, never
	 * the only one: a household of two whose members cannot tell the two hues
	 * apart still has to be able to read the row.
	 */
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
		/* Tinted from the person's own colour rather than from a fixed token, so
		   one rule covers every hue and both themes. */
		background: color-mix(in srgb, var(--tag) 12%, transparent);
		color: var(--tag);
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
