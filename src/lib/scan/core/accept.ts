// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The camera button appears when `accept` admits an image type — no new prop
// for it, because every call site already passes `accept`. A settings JSON
// restore and an .xlsx broker report simply never draw one.

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.gif', '.bmp'];

export function admitsImages(accept: string | undefined): boolean {
	if (!accept) return false;
	return accept
		.toLowerCase()
		.split(',')
		.map((entry) => entry.trim())
		.some(
			(entry) =>
				entry === 'image/*' || entry.startsWith('image/') || IMAGE_EXTENSIONS.includes(entry)
		);
}
