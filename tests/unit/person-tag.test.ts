// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PersonTag from '$lib/components/PersonTag.svelte';

describe('the person tag', () => {
	it('prints the name, so colour is never the only channel', () => {
		const { body } = render(PersonTag, { props: { name: 'Kseniya', hue: '--series-r10' } });
		expect(body).toContain('Kseniya');
	});

	it('draws itself in the colour it was given', () => {
		const { body } = render(PersonTag, { props: { name: 'Robert', hue: '--series-r9' } });
		expect(body).toContain('var(--series-r9)');
	});

	// A crowded row gets the monogram, but a name a person can still reach.
	it('keeps the full name reachable when it shows initials', () => {
		const { body } = render(PersonTag, {
			props: { name: 'Robert Kiewisz', hue: '--series-r9', compact: true }
		});
		expect(body).toContain('RK');
		expect(body).toContain('aria-label="Robert Kiewisz"');
	});
});
