// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which devices are offered the camera and scan buttons.
//
// The rule lives in a media query, so the question it answers — "is this a
// phone or a tablet" — is only ever asked by a browser. That makes it exactly
// the kind of rule that regresses silently: it is invisible in markup, no
// screenshot can cover every device, and getting it wrong on a phone removes
// the feature from the only device it is for.
//
// So the query is READ OUT OF THE COMPONENT and evaluated here against real
// device profiles. Asserting the text of the query would only restate it; this
// asserts what it decides.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');

/** The condition of the rule that hides the buttons, as the component ships it. */
function shippedCondition(): string {
	const rule = SOURCE.match(/@media ([^{]+)\{\s*\.capture-btn \{\s*display: none;/);
	if (!rule) throw new Error('No media rule hides .capture-btn — has the gate moved?');
	return rule[1].trim();
}

interface Device {
	/** The PRIMARY pointer, which is what `pointer` and `hover` report on. */
	pointer: 'fine' | 'coarse' | 'none';
	hover: 'hover' | 'none';
	/**
	 * Every pointer available. Undefined models a browser too old to know the
	 * `any-pointer` feature at all, where the term is simply false.
	 */
	anyPointer?: ('fine' | 'coarse')[];
}

/**
 * Evaluate a conjunction of `(feature: value)` and `(not (feature: value))`.
 *
 * Only the shape the component actually uses. A term naming a feature this
 * knows nothing about is false, which is how a browser treats one it does not
 * support — the behaviour the rule's fallback reasoning depends on.
 */
function hides(condition: string, device: Device): boolean {
	return condition
		.split(' and ')
		.map((raw) => raw.trim())
		.every((term) => {
			const negated = term.startsWith('(not ');
			const inner = negated ? term.slice(5, -1) : term;
			const [feature, value] = inner.replace(/^\(|\)$/g, '').split(':');
			const key = feature.trim();
			const wanted = value.trim();
			const held =
				key === 'pointer'
					? device.pointer === wanted
					: key === 'hover'
						? device.hover === wanted
						: key === 'any-pointer'
							? (device.anyPointer?.includes(wanted as 'fine' | 'coarse') ?? false)
							: false;
			return negated ? !held : held;
		});
}

const DEVICES: Record<string, Device> = {
	iphone: { pointer: 'coarse', hover: 'none', anyPointer: ['coarse'] },
	'android phone': { pointer: 'coarse', hover: 'none', anyPointer: ['coarse'] },
	ipad: { pointer: 'coarse', hover: 'none', anyPointer: ['coarse'] },
	// The case the primary pointer alone gets wrong: a tablet answers "trackpad"
	// the moment one is attached, and is still a tablet with a rear camera.
	'ipad on a magic keyboard': { pointer: 'fine', hover: 'hover', anyPointer: ['fine', 'coarse'] },
	'surface under its type cover': {
		pointer: 'fine',
		hover: 'hover',
		anyPointer: ['fine', 'coarse']
	},
	// Fine pointer, no hover — a pen. Touch is there too, so it is a tablet.
	'stylus tablet': { pointer: 'fine', hover: 'none', anyPointer: ['fine', 'coarse'] },
	'touchscreen laptop': { pointer: 'fine', hover: 'hover', anyPointer: ['fine', 'coarse'] },
	macbook: { pointer: 'fine', hover: 'hover', anyPointer: ['fine'] },
	'desktop with a mouse': { pointer: 'fine', hover: 'hover', anyPointer: ['fine'] }
};

const OFFERED = [
	'iphone',
	'android phone',
	'ipad',
	'ipad on a magic keyboard',
	'surface under its type cover',
	'stylus tablet',
	// Not a device the feature is for, but it has a camera and a finger, and a
	// spare button is the cheaper mistake.
	'touchscreen laptop'
];
const WITHHELD = ['macbook', 'desktop with a mouse'];

describe('who is offered the capture buttons', () => {
	const condition = shippedCondition();

	for (const name of OFFERED) {
		it(`offers them to a ${name}`, () => {
			expect(hides(condition, DEVICES[name])).toBe(false);
		});
	}

	for (const name of WITHHELD) {
		it(`withholds them from a ${name}`, () => {
			expect(hides(condition, DEVICES[name])).toBe(true);
		});
	}

	it('cannot withhold them from a phone even where nothing else can be trusted', () => {
		// The primary-pointer clause is the one that guarantees this: whatever a
		// browser makes of the rest, a phone never reports a fine primary pointer.
		const strange: Device = { pointer: 'coarse', hover: 'none' };
		expect(hides(condition, strange)).toBe(false);
	});

	it('falls back to the primary pointer where any-pointer is not understood', () => {
		// An old browser evaluates the unknown term as false, so the negation
		// holds and the rule reduces to the mouse test — which still spares every
		// phone, and correctly withholds on a desktop.
		expect(hides(condition, { pointer: 'coarse', hover: 'none' })).toBe(false);
		expect(hides(condition, { pointer: 'fine', hover: 'hover' })).toBe(true);
	});
});
