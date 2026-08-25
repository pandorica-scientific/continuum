// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { viewerFileFor, viewerTitle, fileKind } from '$lib/ui/file-viewer';

/**
 * Opening an uploaded file in the app rather than in a new browser tab, for
 * every `/files/…` link under the node this is attached to.
 *
 * Delegated on purpose. The alternative was a `<FileLink>` component at each of
 * the call sites, which works until the next screen writes a plain `<a>` and
 * quietly gets the old behaviour back. One listener on the shell covers the
 * screens that exist and the ones that do not yet, and the links stay ordinary
 * anchors — so cmd-click still opens a tab, right-click still saves, and the
 * markup still means something with no JavaScript running.
 */
export function filePreview(
	node: HTMLElement,
	options: { open: (file: string, title: string) => void }
) {
	let open = options.open;

	function onclick(event: MouseEvent) {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a');
		if (!anchor) return;
		const file = viewerFileFor(anchor.getAttribute('href'), {
			button: event.button,
			metaKey: event.metaKey,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			defaultPrevented: event.defaultPrevented,
			download: anchor.hasAttribute('download')
		});
		if (!file) return;
		event.preventDefault();
		// `data-file-name` is how a call site says what the file is called when
		// its link is an icon or a word like "slip"; the link text and the title
		// attribute are what every other link already carries.
		open(
			file,
			viewerTitle(
				[anchor.dataset.fileName, anchor.getAttribute('title'), anchor.textContent],
				fileKind(file)
			)
		);
	}

	node.addEventListener('click', onclick);
	return {
		update(next: { open: (file: string, title: string) => void }) {
			open = next.open;
		},
		destroy() {
			node.removeEventListener('click', onclick);
		}
	};
}
