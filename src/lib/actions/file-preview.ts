// SPDX-License-Identifier: AGPL-3.0-or-later
import { viewerSourceFor, viewerTitle, type ViewerSource } from '$lib/ui/file-viewer';

/**
 * Opening an uploaded file in the app rather than in a new browser tab, for
 * every `/files/…` and `/documents/<id>/file` link under the node this is
 * attached to.
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
	options: { open: (source: ViewerSource, title: string) => void }
) {
	let open = options.open;

	function onclick(event: MouseEvent) {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a');
		if (!anchor) return;
		const source = viewerSourceFor(
			anchor.getAttribute('href'),
			{
				button: event.button,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				defaultPrevented: event.defaultPrevented,
				download: anchor.hasAttribute('download')
			},
			// A document's link is addressed by id, so the row states the
			// extension it already holds rather than the overlay guessing.
			anchor.dataset.fileExt
		);
		if (!source) return;
		event.preventDefault();
		// `data-file-name` is how a call site says what the file is called when
		// its link is an icon or a word like "slip"; the link text and the title
		// attribute are what every other link already carries.
		open(
			source,
			viewerTitle(
				[anchor.dataset.fileName, anchor.getAttribute('title'), anchor.textContent],
				source.kind
			)
		);
	}

	node.addEventListener('click', onclick);
	return {
		update(next: { open: (source: ViewerSource, title: string) => void }) {
			open = next.open;
		},
		destroy() {
			node.removeEventListener('click', onclick);
		}
	};
}
