import { describe, expect, it } from 'vitest';
import {
	fileKind,
	fileNameFrom,
	isPlainClick,
	viewerFileFor,
	viewerTitle
} from '$lib/ui/file-viewer';

const NAME = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('how a file can be shown', () => {
	it('renders the image formats the server serves inline', () => {
		for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']) {
			expect(fileKind(`${NAME}${ext}`)).toBe('image');
		}
	});

	it('renders a pdf', () => {
		expect(fileKind(`${NAME}.pdf`)).toBe('pdf');
	});

	// These come back with content-disposition: attachment. Framing one shows an
	// empty box and eats the download the click was for.
	it('leaves the data formats as downloads', () => {
		for (const ext of ['.csv', '.xml', '.ofx', '.abo', '.xlsx']) {
			expect(fileKind(`${NAME}${ext}`)).toBe('download');
		}
	});

	it('treats an unknown or missing extension as a download', () => {
		expect(fileKind(`${NAME}.exe`)).toBe('download');
		expect(fileKind(NAME)).toBe('download');
	});

	it('ignores the case of the extension', () => {
		expect(fileKind(`${NAME}.PDF`)).toBe('pdf');
		expect(fileKind(`${NAME}.JPG`)).toBe('image');
	});
});

describe('recognising an uploaded file link', () => {
	it('reads the stored name out of a relative link', () => {
		expect(fileNameFrom(`/files/${NAME}.pdf`)).toBe(`${NAME}.pdf`);
	});

	it('accepts an absolute link to the same route', () => {
		expect(fileNameFrom(`https://continuum.local/files/${NAME}.pdf`)).toBe(`${NAME}.pdf`);
	});

	it('drops a query string or fragment', () => {
		expect(fileNameFrom(`/files/${NAME}.pdf?v=2`)).toBe(`${NAME}.pdf`);
		expect(fileNameFrom(`/files/${NAME}.pdf#page=3`)).toBe(`${NAME}.pdf`);
	});

	it('is not fooled by another route that merely starts alike', () => {
		expect(fileNameFrom('/filesystem/report.pdf')).toBeNull();
		expect(fileNameFrom('/documents/1')).toBeNull();
		expect(fileNameFrom('/files/')).toBeNull();
		expect(fileNameFrom('/files/nested/thing.pdf')).toBeNull();
	});

	it('says nothing for a link with no href', () => {
		expect(fileNameFrom(null)).toBeNull();
		expect(fileNameFrom(undefined)).toBeNull();
		expect(fileNameFrom('')).toBeNull();
	});
});

describe('which clicks the overlay may take', () => {
	it('takes an ordinary left click', () => {
		expect(isPlainClick({ button: 0 })).toBe(true);
		expect(isPlainClick({})).toBe(true);
	});

	// Each of these is a browser instruction the anchor is expected to honour.
	it('leaves a modified click to the browser', () => {
		expect(isPlainClick({ button: 0, metaKey: true })).toBe(false);
		expect(isPlainClick({ button: 0, ctrlKey: true })).toBe(false);
		expect(isPlainClick({ button: 0, shiftKey: true })).toBe(false);
		expect(isPlainClick({ button: 0, altKey: true })).toBe(false);
	});

	it('leaves the middle button to the browser', () => {
		expect(isPlainClick({ button: 1 })).toBe(false);
	});

	it('stays out of the way of a handler that already acted', () => {
		expect(isPlainClick({ button: 0, defaultPrevented: true })).toBe(false);
	});
});

describe('deciding what a click opens', () => {
	it('opens a viewable file', () => {
		expect(viewerFileFor(`/files/${NAME}.pdf`, { button: 0 })).toBe(`${NAME}.pdf`);
		expect(viewerFileFor(`/files/${NAME}.png`, { button: 0 })).toBe(`${NAME}.png`);
	});

	it('lets a download-only file download', () => {
		expect(viewerFileFor(`/files/${NAME}.csv`, { button: 0 })).toBeNull();
	});

	it('lets an explicit download link alone', () => {
		expect(viewerFileFor(`/files/${NAME}.pdf`, { button: 0, download: true })).toBeNull();
	});

	it('lets a modified click open its tab', () => {
		expect(viewerFileFor(`/files/${NAME}.pdf`, { button: 0, metaKey: true })).toBeNull();
	});

	it('ignores links that are not uploaded files', () => {
		expect(viewerFileFor('/documents', { button: 0 })).toBeNull();
	});
});

describe('naming the file on screen', () => {
	it('takes the first candidate that says something', () => {
		expect(viewerTitle([null, '  ', 'Electricity bill'], 'pdf')).toBe('Electricity bill');
	});

	// The property screen links its bills with a paperclip, and the tax screen
	// with an arrow. Neither is a heading.
	it('skips a candidate that is only an icon', () => {
		expect(viewerTitle(['📎'], 'pdf')).toBe('Document');
		expect(viewerTitle(['📎', 'March invoice'], 'pdf')).toBe('March invoice');
	});

	it('falls back to what kind of file it is', () => {
		expect(viewerTitle([], 'image')).toBe('Image');
		expect(viewerTitle([undefined, ''], 'pdf')).toBe('Document');
	});
});
