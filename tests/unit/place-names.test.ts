// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The name printed under a coin.
 *
 * A rule about 315 of the dataset's 3,422 places that nothing else would notice
 * breaking: the geodata build does not run in CI, and a regression would reach
 * somebody as a coin labelled in a script they cannot read.
 */
import { describe, expect, it } from 'vitest';
import { readableName } from '$lib/life/geo/place-name';

describe('readableName', () => {
	it('takes the Latin name the dataset already carries', () => {
		expect(readableName({ name: 'ཐིམ་ཕུ', alternateNames: ['Thimphu'] })).toBe('Thimphu');
		expect(readableName({ name: 'Київ', alternateNames: ['Kyiv'] })).toBe('Kyiv');
		expect(readableName({ name: 'กรุงเทพมหานคร', alternateNames: ['Bangkok'] })).toBe('Bangkok');
	});

	it('takes the first Latin alternate, accents and all', () => {
		// The dataset orders them; the first one that can be read wins, and an
		// accented spelling is no less readable than an unaccented one.
		expect(readableName({ name: 'ᠮᠥᠷᠡᠨ', alternateNames: ['Moeroen', 'Mörön'] })).toBe('Moeroen');
		expect(readableName({ name: 'ᠮᠥᠷᠡᠨ', alternateNames: ['Mörön'] })).toBe('Mörön');
	});

	it('skips an alternate that is in another script again', () => {
		expect(readableName({ name: '東京都', alternateNames: ['とうきょう', 'Tokyo'] })).toBe('Tokyo');
	});

	it('leaves a name that is already Latin exactly as it is', () => {
		// Including one whose alternates spell it differently: the dataset's own
		// name is the name, and this rule is only ever a rescue.
		expect(readableName({ name: "Xi'an", alternateNames: ['Xi’an'] })).toBe("Xi'an");
		expect(readableName({ name: 'Kyoto', alternateNames: ['Kyoto-shi'] })).toBe('Kyoto');
	});

	it('leaves a name alone when nothing better is offered', () => {
		// Inventing a transliteration here would be the build making up a name.
		expect(readableName({ name: 'Київ', alternateNames: [] })).toBe('Київ');
		expect(readableName({ name: 'Київ' })).toBe('Київ');
	});

	it('does not call a name of digits and punctuation foreign', () => {
		expect(readableName({ name: '1911', alternateNames: ['Something else'] })).toBe('1911');
		expect(readableName({})).toBe('');
	});
});
