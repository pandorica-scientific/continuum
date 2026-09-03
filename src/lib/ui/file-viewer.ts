// SPDX-License-Identifier: AGPL-3.0-or-later

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
const FILE_PREFIX = '/files/';

/**
 * A document's bytes are served through the document, not through the filename
 * — `/files/[name]` cannot say which document a name belongs to, which is how a
 * member could once open a restricted one by holding its stored name.
 */
const DOCUMENT_FILE = /^\/documents\/([0-9a-fA-F-]{36})\/file$/;

/** The link a document's file is opened through. */
export function documentFileHref(id: string): string {
	return `/documents/${id}/file`;
}

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
	return fileKindFromExtension(extensionOf(name));
}

/**
 * The same answer from an extension alone.
 *
 * A `/documents/<id>/file` link carries no filename, so the row states the
 * extension it already holds — `PDF`, `JPG` — and the dot and the case are
 * this function's problem rather than every call site's.
 */
function fileKindFromExtension(ext: string): FileKind {
	const dotted = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	if (IMAGE_EXT.has(dotted)) return 'image';
	if (dotted === '.pdf') return 'pdf';
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

/** Where the overlay reads from, and how it can show it. */
export type ViewerSource = { src: string; kind: FileKind; download: string };

/**
 * What the overlay should open for this click, from either link shape.
 *
 * `/files/<name>` carries its own extension; `/documents/<id>/file` does not,
 * so the anchor states it (`data-file-ext`). A link whose kind cannot be worked
 * out falls through to the browser, which is the same thing the server would do
 * with it anyway.
 */
export function viewerSourceFor(
	href: string | null | undefined,
	intent: ClickIntent,
	ext?: string | null
): ViewerSource | null {
	if (intent.download || !isPlainClick(intent)) return null;

	const name = fileNameFrom(href);
	if (name) {
		const kind = fileKind(name);
		if (kind === 'download') return null;
		return { src: `${FILE_PREFIX}${encodeURIComponent(name)}`, kind, download: name };
	}

	const path = href && /^https?:\/\//i.test(href) ? safePathname(href) : (href ?? '');
	const document = path && DOCUMENT_FILE.test(path.split(/[?#]/)[0]);
	if (!document || !ext) return null;
	const kind = fileKindFromExtension(ext);
	if (kind === 'download') return null;
	return { src: path.split(/[?#]/)[0], kind, download: '' };
}

function safePathname(href: string): string {
	try {
		return new URL(href).pathname;
	} catch {
		return '';
	}
}
