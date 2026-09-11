<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * What a trip is made of, in travel order.
	 *
	 * A timeline inside the trip rather than a table: the question a person asks
	 * a booking list is "what happens next", which a line answers and a grid of
	 * columns does not. The order comes from `booking-order.ts`, which is where
	 * the one non-obvious rule lives.
	 */
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import type { EnumValue } from '$lib/enums';

	interface Booking {
		id: string;
		kind: EnumValue<'booking.kind'>;
		title: string;
		startsAt: Date | string;
		endsAt: Date | string | null;
		reference: string;
		documentId: string | null;
		documentName: string | null;
	}

	let {
		bookings,
		/** Draw a remove control per row. Off where the timeline is only read. */
		ondelete = false,
		/** Asks the page to open the attach dialog for one booking. */
		onattach
	}: {
		bookings: Booking[];
		ondelete?: boolean;
		onattach?: (booking: Booking) => void;
	} = $props();

	/**
	 * One glyph per kind.
	 *
	 * A bus and a ferry take the train's carriage: at 16px the question a reader
	 * asks is "does this move me or house me", and three more silhouettes that
	 * close up into the same shape answer nothing. A flight, a car and a bed are
	 * genuinely different and get their own.
	 */
	const GLYPH: Record<EnumValue<'booking.kind'>, IconName> = {
		flight: 'plane',
		train: 'train',
		bus: 'train',
		ferry: 'train',
		car: 'car',
		hotel: 'bed',
		other: 'pin'
	};

	const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

	const day = (value: Date | string): string =>
		asDate(value).toLocaleDateString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});

	const time = (value: Date | string): string =>
		asDate(value).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC'
		});

	/** "3 nights" for a stay, so a hotel row says how long rather than when it ends. */
	const nights = (from: Date | string, to: Date | string): number =>
		Math.max(1, Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000));
</script>

{#if bookings.length}
	<ol class="timeline">
		{#each bookings as booking (booking.id)}
			<li class="item">
				<span class="mark" aria-hidden="true">
					<Icon name={GLYPH[booking.kind]} size={16} />
				</span>
				<div class="what">
					<span class="title">{booking.title}</span>
					<span class="meta">
						<span class="kind">{booking.kind}</span>
						{#if booking.reference}
							<span class="dot" aria-hidden="true">·</span>
							<span class="mono">{booking.reference}</span>
						{/if}
						{#if booking.endsAt && booking.kind === 'hotel'}
							<span class="dot" aria-hidden="true">·</span>
							<span
								><span class="mono">{nights(booking.startsAt, booking.endsAt)}</span> nights</span
							>
						{/if}
					</span>

					{#if onattach}
						<!-- The confirmation. Filed in the archive like every other piece
						     of paper and linked to the trip, so it is searchable with
						     everything else; the booking points at it as well, so a trip
						     with five documents still knows which is this flight's. -->
						<span class="paper">
							{#if booking.documentId}
								<a class="attached" href="/documents/{booking.documentId}/file" target="_blank">
									<Icon name="receipt" size={13} />
									{booking.documentName ?? 'Confirmation'}
								</a>
								<form method="POST" action="?/detachBooking" use:enhance>
									<input type="hidden" name="id" value={booking.id} />
									<button class="unlink" type="submit">Unhook</button>
								</form>
							{:else}
								<button class="btn pick" type="button" onclick={() => onattach?.(booking)}>
									<Icon name="plus" size={14} /> Attach the confirmation
								</button>
							{/if}
						</span>
					{/if}
				</div>
				<div class="when">
					<span class="mono">{day(booking.startsAt)}</span>
					<span class="mono clock">{time(booking.startsAt)}</span>
				</div>
				{#if ondelete}
					<form method="POST" action="?/deleteBooking" use:enhance>
						<input type="hidden" name="id" value={booking.id} />
						<button class="remove" type="submit" aria-label="Remove {booking.title}">
							<Icon name="plus" size={13} />
						</button>
					</form>
				{/if}
			</li>
		{/each}
	</ol>
{:else}
	<p class="empty">
		Nothing booked yet. A flight, a room, a train — whatever is actually arranged.
	</p>
{/if}

<style>
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.item {
		position: relative;
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-5) 0;
	}
	/* The line down the timeline, drawn behind the marks rather than as a
	   border on each row: a border would break at every gap. */
	.item::before {
		content: '';
		position: absolute;
		left: 17px;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--bd);
	}
	.item:first-child::before {
		top: 50%;
	}
	.item:last-child::before {
		bottom: 50%;
	}
	.mark {
		position: relative;
		z-index: 1;
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		background: var(--bg2);
		color: var(--rose);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.paper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-sm);
	}
	.attached {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--blue);
	}
	.unlink {
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.unlink:hover {
		color: var(--red);
	}
	/* A real button, not a quiet link. It is the one thing a reader does to a
	   booking row that has no confirmation yet, and as text it disappeared into
	   the metadata line above it. Compact, because the row is a row. */
	.pick {
		min-height: auto;
		padding: var(--space-2) var(--space-5);
		font-size: var(--text-sm);
	}
	.title {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.meta {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.kind {
		text-transform: capitalize;
	}
	.dot {
		margin: 0 var(--space-2);
	}
	.when {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg2);
		white-space: nowrap;
	}
	.clock {
		color: var(--fg3);
	}
	.empty {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	/* The ✕, rotated out of `plus`. */
	.remove {
		width: 24px;
		height: 24px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: none;
		color: var(--fg3);
		transform: rotate(45deg);
	}
	.remove:hover {
		color: var(--red);
	}
</style>
