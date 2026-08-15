import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextFocusIndex, overlayFocus } from '$lib/actions/overlay';

class FakeElement {
	tagName = 'BUTTON';
	parentElement: FakeElement | null = null;
	children: FakeElement[] = [];
	inert = false;
	hidden = false;
	offsetParent: FakeElement | null = null;
	private attributes = new Map<string, string>();
	private listeners = new Map<string, (event: KeyboardEvent) => void>();
	private descendants: FakeElement[] = [];

	constructor(
		readonly name: string,
		readonly visible = true
	) {}

	append(...children: FakeElement[]) {
		for (const child of children) child.parentElement = this;
		this.children.push(...children);
		this.descendants.push(...children);
	}

	setFocusableDescendants(...elements: FakeElement[]) {
		this.descendants = elements;
	}

	querySelectorAll() {
		return this.descendants;
	}

	getClientRects() {
		return this.visible ? ([{}] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
	}

	hasAttribute(name: string) {
		return this.attributes.has(name);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}

	getAttributeNames() {
		return [...this.attributes.keys()];
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	removeAttribute(name: string) {
		this.attributes.delete(name);
	}

	focus() {
		(globalThis.document as unknown as { activeElement: FakeElement }).activeElement = this;
	}

	addEventListener(type: string, listener: (event: KeyboardEvent) => void) {
		this.listeners.set(type, listener);
	}

	removeEventListener(type: string) {
		this.listeners.delete(type);
	}

	key(event: Partial<KeyboardEvent> & { key: string }) {
		const preventDefault = vi.fn();
		this.listeners.get('keydown')?.({ ...event, preventDefault } as KeyboardEvent);
		return preventDefault;
	}
}

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;

afterEach(() => {
	Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
	Object.defineProperty(globalThis, 'HTMLElement', {
		configurable: true,
		value: originalHTMLElement
	});
});

function installDocument(activeElement: FakeElement) {
	Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement });
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { activeElement, body: new FakeElement('body') }
	});
}

describe('nextFocusIndex', () => {
	it('wraps forward Tab from the last overlay control to the first', () => {
		expect(nextFocusIndex(3, 2, false)).toBe(0);
	});

	it('wraps Shift+Tab from the first overlay control to the last', () => {
		expect(nextFocusIndex(3, 0, true)).toBe(2);
	});

	it('focuses a fixed-position close button, traps Shift+Tab, inerts the background, and restores the opener', async () => {
		const opener = new FakeElement('opener');
		const app = new FakeElement('app');
		const background = new FakeElement('background');
		const modal = new FakeElement('modal');
		const close = new FakeElement('close');
		const field = new FakeElement('field');
		field.offsetParent = modal;
		app.append(background, modal);
		modal.setFocusableDescendants(close, field);
		installDocument(opener);
		const onclose = vi.fn();

		const action = overlayFocus(modal as unknown as HTMLElement, { onclose });
		await Promise.resolve();

		// A fixed-position control has no offsetParent, but it is still visible.
		expect((globalThis.document as unknown as { activeElement: FakeElement }).activeElement).toBe(
			close
		);
		expect(background.inert).toBe(true);
		expect(background.getAttribute('aria-hidden')).toBe('true');

		modal.key({ key: 'Tab', shiftKey: true });
		expect((globalThis.document as unknown as { activeElement: FakeElement }).activeElement).toBe(
			field
		);
		modal.key({ key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();

		action.destroy();
		expect(background.inert).toBe(false);
		expect((globalThis.document as unknown as { activeElement: FakeElement }).activeElement).toBe(
			opener
		);
	});

	it('activates a drawer without inerting its retained scrim and closes it on Escape', async () => {
		const opener = new FakeElement('menu opener');
		const shell = new FakeElement('shell');
		const drawer = new FakeElement('drawer');
		const scrim = new FakeElement('scrim');
		const main = new FakeElement('main');
		scrim.setAttribute('data-overlay-keep', '');
		const link = new FakeElement('drawer link');
		shell.append(drawer, scrim, main);
		drawer.setFocusableDescendants(link);
		installDocument(opener);
		const onclose = vi.fn();

		const action = overlayFocus(drawer as unknown as HTMLElement, { onclose, active: false });
		action.update({ onclose, active: true });
		await Promise.resolve();

		expect(main.inert).toBe(true);
		expect(scrim.inert).toBe(false);
		drawer.key({ key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});
});
