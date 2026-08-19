// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
const focusable =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
	if (count === 0) return -1;
	if (backwards) return current <= 0 ? count - 1 : current - 1;
	return current >= count - 1 ? 0 : current + 1;
}

function focusablesIn(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(focusable)].filter(
		(element) =>
			!element.hasAttribute('disabled') &&
			!element.hidden &&
			!element.hasAttribute('hidden') &&
			element.getAttribute('aria-hidden') !== 'true' &&
			element.getClientRects().length > 0
	);
}

function activateOverlay(node: HTMLElement, options: { onclose: () => void }) {
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const changed: { element: HTMLElement; inert: boolean; ariaHidden: string | null }[] = [];

	let child: HTMLElement = node;
	let parent = node.parentElement;
	while (parent && parent !== document.body) {
		for (const sibling of parent.children) {
			if (
				sibling === child ||
				!(sibling instanceof HTMLElement) ||
				sibling.hasAttribute('data-overlay-keep')
			)
				continue;
			changed.push({
				element: sibling,
				inert: sibling.inert,
				ariaHidden: sibling.getAttribute('aria-hidden')
			});
			sibling.inert = true;
			sibling.setAttribute('aria-hidden', 'true');
		}
		child = parent;
		parent = parent.parentElement;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			options.onclose();
			return;
		}
		if (event.key !== 'Tab') return;
		const items = focusablesIn(node);
		const current = items.indexOf(document.activeElement as HTMLElement);
		const next = nextFocusIndex(items.length, current, event.shiftKey);
		if (next >= 0) {
			event.preventDefault();
			items[next].focus();
		}
	}

	node.addEventListener('keydown', onkeydown);
	queueMicrotask(() => (focusablesIn(node)[0] ?? node).focus());

	return () => {
		node.removeEventListener('keydown', onkeydown);
		for (const state of changed) {
			state.element.inert = state.inert;
			if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
			else state.element.setAttribute('aria-hidden', state.ariaHidden);
		}
		opener?.focus();
	};
}

/** Focus, contain, and restore focus for a modal-like overlay. */
export function overlayFocus(
	node: HTMLElement,
	options: { onclose: () => void; active?: boolean }
) {
	let deactivate = options.active === false ? undefined : activateOverlay(node, options);
	return {
		update(next: { onclose: () => void; active?: boolean }) {
			deactivate?.();
			deactivate = next.active === false ? undefined : activateOverlay(node, next);
		},
		destroy() {
			deactivate?.();
		}
	};
}
