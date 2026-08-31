// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Show as many chips as fit on one line, and count the rest.
 *
 * A fixed "first three" wastes a wide row and overflows a narrow one. This
 * measures instead: every child marked `data-chip` is shown in order until the
 * next would not fit beside the `data-more` counter, and the counter says how
 * many are hidden. It re-measures whenever the container resizes, so a row
 * keeps filling its own width as the inspector opens and closes.
 *
 * The container must be a single-line flex row with `overflow: hidden`; the
 * gap is read from it rather than assumed.
 */
export function fitChips(node: HTMLElement, deps?: unknown) {
	void deps;

	function measure() {
		const chips = [...node.querySelectorAll<HTMLElement>('[data-chip]')];
		const more = node.querySelector<HTMLElement>('[data-more]');
		if (chips.length === 0) {
			if (more) more.hidden = true;
			return;
		}
		// Everything visible for one measurement, then hide what does not fit.
		for (const chip of chips) chip.hidden = false;
		if (more) more.hidden = false;

		const gap = parseFloat(getComputedStyle(node).columnGap) || 0;
		const available = node.clientWidth;
		const widths = chips.map((chip) => chip.getBoundingClientRect().width);
		const moreWidth = more ? more.getBoundingClientRect().width : 0;

		let used = 0;
		let shown = 0;
		for (let i = 0; i < chips.length; i++) {
			const width = widths[i] + (i > 0 ? gap : 0);
			const rest = chips.length - (i + 1);
			// The counter needs room only if something would be left over.
			const counter = rest > 0 ? moreWidth + gap : 0;
			if (used + width + counter <= available) {
				used += width;
				shown++;
			} else {
				break;
			}
		}

		chips.forEach((chip, i) => (chip.hidden = i >= shown));
		const hiddenCount = chips.length - shown;
		if (more) {
			more.hidden = hiddenCount === 0;
			more.textContent = `+${hiddenCount}`;
		}
	}

	const observer = new ResizeObserver(() => measure());
	observer.observe(node);
	measure();

	return {
		update() {
			measure();
		},
		destroy() {
			observer.disconnect();
		}
	};
}
