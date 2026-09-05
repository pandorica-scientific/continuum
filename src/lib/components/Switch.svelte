<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later

	/**
	 * A form's submit button, wearing a track and a knob.
	 *
	 * A button and not a checkbox, deliberately: all three switches in the
	 * product sit alone in a `<form method="POST">` and ARE the submission — a
	 * module toggle, a calendar feed, the marker setting. Written as a checkbox
	 * they would need script to submit anything, and the no-JavaScript path is
	 * the one this app keeps.
	 *
	 * `role="switch"` with `aria-checked` rather than a bare button: without it
	 * a screen reader announces "Toggle Salary, button" and never says whether
	 * it is currently on.
	 *
	 * This existed three times — twice in Settings, once in Calendar — with the
	 * markup and about thirty lines of CSS copied between them. Green when on
	 * rather than blue: it reads as "running", not "selected", and everything
	 * it wears is an on/off state of something live.
	 */
	interface Props {
		on: boolean;
		/** What is being switched. Required: the track says nothing on its own. */
		label: string;
		disabled?: boolean;
	}

	let { on, label, disabled = false }: Props = $props();
</script>

<button
	type="submit"
	class="switch"
	class:on
	role="switch"
	aria-checked={on}
	aria-label={label}
	{disabled}
>
	<span class="knob"></span>
</button>

<style>
	.switch {
		position: relative;
		width: 38px;
		height: 22px;
		border-radius: 22px;
		border: 1px solid var(--bd2);
		background: var(--card2);
		padding: 0;
		flex: none;
		cursor: pointer;
		transition:
			background-color var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.switch.on {
		background: var(--green-tint);
		border-color: var(--green);
	}
	.switch:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-pill);
		background: var(--fg3);
		transition:
			left var(--dur) var(--ease),
			background-color var(--dur) var(--ease);
	}
	.switch.on .knob {
		left: 18px;
		background: var(--green);
	}
	.switch:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
