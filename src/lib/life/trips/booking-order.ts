// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The order a trip's bookings are read in: travel order, not entry order.
 *
 * Mostly that is just "by when it starts". The part worth writing down is what
 * happens when two bookings share a moment, which they routinely do — a
 * household types the flight and the hotel as the same afternoon, because from
 * where they are standing it is one afternoon.
 *
 * When that happens, the thing that MOVES you comes before the thing that
 * HOUSES you. You cannot check into a hotel in Porto before the flight that
 * takes you there, so a timeline that draws it the other way is telling a small
 * lie about the day.
 *
 * Pure, and tested on its own: it is the only arithmetic on the trip page, and
 * the component around it is markup.
 */
import type { EnumValue } from '$lib/enums';

type BookingKind = EnumValue<'booking.kind'>;

export interface OrderableBooking {
	kind: BookingKind;
	startsAt: Date | string;
	title?: string;
}

/**
 * How each kind ranks when two share a moment.
 *
 * Lower is earlier. Only three ranks, because only three distinctions are real:
 * something that carries you somewhere, something you stay in, and everything
 * else. Ranking `flight` above `train` would be inventing a fact.
 */
const RANK: Record<BookingKind, number> = {
	flight: 0,
	train: 0,
	bus: 0,
	ferry: 0,
	car: 1,
	hotel: 2,
	other: 1
};

const at = (value: Date | string): number =>
	value instanceof Date ? value.getTime() : Date.parse(value);

/**
 * Sort a copy, never in place.
 *
 * A loader handing its own array to a component that then re-sorted it was the
 * shape of a bug elsewhere in this codebase; returning a new array costs
 * nothing at the size of a trip.
 */
export function orderBookings<T extends OrderableBooking>(bookings: readonly T[]): T[] {
	return [...bookings].sort((a, b) => {
		const byTime = at(a.startsAt) - at(b.startsAt);
		if (byTime !== 0) return byTime;

		const byKind = RANK[a.kind] - RANK[b.kind];
		if (byKind !== 0) return byKind;

		// Same moment, same kind: fall back to the title so the order is stable
		// between loads. Two identical bookings on one trip is a duplicate the
		// household can see and delete, not something to hide by shuffling.
		return (a.title ?? '').localeCompare(b.title ?? '');
	});
}
