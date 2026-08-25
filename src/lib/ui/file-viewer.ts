// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Opening an uploaded file used to mean a new browser tab: the app disappeared,
 * the browser's own viewer took over, and getting back to the row you were
 * reading was a tab switch away. Files now open in an overlay on top of the
 * screen that linked to them.
 *
 * The decision of WHETHER a click becomes an overlay lives here rather than in
 * the layout, because it is the part with rules worth testing: which extensions
 * can be shown at all, and which clicks a person meant to be a real navigation.
 */

export type FileKind = 'image' | 'pdf' | 'download';

// Kept in step with CONTENT_TYPES in $lib/server/system/files. An extension the
// server will not serve inline cannot be shown inline here either.
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

/** Where an uploaded file's bytes are served from. */
export const FILE_PREFIX = '/files/';

function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * How a file can be shown. `download` covers the data formats the server hands
 * over as an attachment (.csv, .ofx, .xlsx and friends) — nothing renders them,
 * so the overlay must not try.
 */
export function fileKind(name: string): FileKind {
	const ext = extensionOf(name);
	if (IMAGE_EXT.has(ext)) return 'image';
	if (ext === '.pdf') return 'pdf';
	return 'download';
}

/** The stored name inside a `/files/…` link, or null if it is not one. */
export function fileNameFrom(href: string | null | undefined): string | null {
	if (!href) return null;
	// Relative links are what the app writes; an absolute one from the same
	// origin means the same file and is accepted on its pathname.
	let path = href;
	if (/^https?:\/\//i.test(href)) {
		try {
			path = new URL(href).pathname;
		} catch {
			return null;
		}
	}
	if (!path.startsWith(FILE_PREFIX)) return null;
	const name = decodeURIComponent(path.slice(FILE_PREFIX.length).split(/[?#]/)[0]);
	// A nested path is not a file this app serves.
	return name.length > 0 && !name.includes('/') ? name : null;
}

/**
 * The parts of a click that decide whether the browser was meant to handle it.
 * Taken as plain fields so the rule can be tested without a DOM.
 */
export type ClickIntent = {
	button?: number;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	defaultPrevented?: boolean;
	/** The anchor carries a `download` attribute — the person asked to save it. */
	download?: boolean;
};

/**
 * A modified click is a deliberate instruction to the browser: cmd/ctrl opens a
 * background tab, shift a window, alt saves the target, the middle button opens
 * a tab. Swallowing any of those to show an overlay instead takes away controls
 * the anchor is expected to have — which is also why every call site stays a
 * real `<a href>` rather than a button.
 */
export function isPlainClick(intent: ClickIntent): boolean {
	if (intent.defaultPrevented) return false;
	if (intent.button !== undefined && intent.button !== 0) return false;
	return !intent.metaKey && !intent.ctrlKey && !intent.shiftKey && !intent.altKey;
}

/**
 * The file an overlay should open for this click, or null to let the browser
 * do whatever the anchor says. Download-only formats fall through on purpose:
 * the server sends them as an attachment, so the click never opened a tab to
 * begin with and the save must keep working.
 */
export function viewerFileFor(href: string | null | undefined, intent: ClickIntent): string | null {
	if (intent.download || !isPlainClick(intent)) return null;
	const name = fileNameFrom(href);
	if (!name || fileKind(name) === 'download') return null;
	return name;
}

// A link's own text is the best name available for a file whose stored name is
// a uuid, but plenty of the links are an icon: "📎" as the heading of a viewer
// says nothing, and reads as nothing at all to a screen reader.
const MEANINGFUL = /\p{L}|\p{N}/u;

/**
 * What to call the file on screen: the first candidate that carries actual
 * words, falling back to what kind of thing it is.
 */
export function viewerTitle(
	candidates: readonly (string | null | undefined)[],
	kind: FileKind
): string {
	for (const candidate of candidates) {
		const text = candidate?.trim();
		if (text && MEANINGFUL.test(text)) return text;
	}
	return kind === 'image' ? 'Image' : 'Document';
}
