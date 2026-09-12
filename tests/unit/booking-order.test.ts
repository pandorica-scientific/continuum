// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { orderBookings, type OrderableBooking } from '$lib/life/trips/booking-order';

const booking = (
	kind: OrderableBooking['kind'],
	startsAt: string,
	title?: string
): OrderableBooking => ({ kind, startsAt, title: title ?? kind });

describe('ordering a trip’s bookings', () => {
	it('reads in travel order, whatever order they were typed in', () => {
		const typed = [
			booking('flight', '2026-06-08T18:00:00Z', 'Porto → Prague'),
			booking('hotel', '2026-06-01T15:00:00Z', 'Ribeira'),
			booking('flight', '2026-06-01T09:00:00Z', 'Prague → Porto'),
			booking('train', '2026-06-05T08:00:00Z', 'Porto → Pinhão')
		];
		expect(orderBookings(typed).map((b) => b.title)).toEqual([
			'Prague → Porto',
			'Ribeira',
			'Porto → Pinhão',
			'Porto → Prague'
		]);
	});

	// The case the module exists for. A household types the flight and the hotel
	// as the same afternoon, because from where they are standing it is one
	// afternoon — and a timeline that checks you in before you land is wrong.
	it('puts what moves you before what houses you, at the same moment', () => {
		const sameMoment = [
			booking('hotel', '2026-06-01T14:00:00Z'),
			booking('flight', '2026-06-01T14:00:00Z')
		];
		expect(orderBookings(sameMoment).map((b) => b.kind)).toEqual(['flight', 'hotel']);
	});

	it('puts a hire car after the flight and before the hotel', () => {
		const sameMoment = [
			booking('hotel', '2026-06-01T14:00:00Z'),
			booking('car', '2026-06-01T14:00:00Z'),
			booking('ferry', '2026-06-01T14:00:00Z')
		];
		expect(orderBookings(sameMoment).map((b) => b.kind)).toEqual(['ferry', 'car', 'hotel']);
	});

	it('does not rank one way of travelling above another', () => {
		const sameMoment = [
			booking('train', '2026-06-01T09:00:00Z', 'B'),
			booking('flight', '2026-06-01T09:00:00Z', 'A')
		];
		// Sorted by title, because there is no real fact saying which comes first.
		expect(orderBookings(sameMoment).map((b) => b.title)).toEqual(['A', 'B']);
	});

	it('is stable for two identical bookings', () => {
		const twice = [
			booking('hotel', '2026-06-01T14:00:00Z', 'Ribeira'),
			booking('hotel', '2026-06-01T14:00:00Z', 'Ribeira')
		];
		expect(orderBookings(twice)).toHaveLength(2);
		expect(orderBookings(twice)).toEqual(orderBookings(twice));
	});

	it('accepts a Date as readily as a string', () => {
		const mixed: OrderableBooking[] = [
			{ kind: 'hotel', startsAt: new Date('2026-06-02T14:00:00Z'), title: 'second' },
			{ kind: 'flight', startsAt: '2026-06-01T09:00:00Z', title: 'first' }
		];
		expect(orderBookings(mixed).map((b) => b.title)).toEqual(['first', 'second']);
	});

	it('leaves the array it was handed alone', () => {
		const original = [
			booking('hotel', '2026-06-02T14:00:00Z'),
			booking('flight', '2026-06-01T09:00:00Z')
		];
		const copy = [...original];
		orderBookings(original);
		expect(original).toEqual(copy);
	});

	it('has nothing to say about an empty trip', () => {
		expect(orderBookings([])).toEqual([]);
	});
});
