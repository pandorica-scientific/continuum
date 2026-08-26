// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which capture buttons a file input should offer, decided from `accept`.
//
// No extra prop for this: every call site already says what it takes, and the
// answer follows from that. A settings JSON restore and an .xlsx broker report
// simply never draw a button.

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.gif', '.bmp'];

const entries = (accept: string) =>
	accept
		.toLowerCase()
		.split(',')
		.map((entry) => entry.trim());

/** Can a plain photograph be uploaded here, as it comes off the camera? */
export function admitsImages(accept: string | undefined): boolean {
	if (!accept) return false;
	return entries(accept).some(
		(entry) => entry === 'image/*' || entry.startsWith('image/') || IMAGE_EXTENSIONS.includes(entry)
	);
}

/**
 * Can a SCAN be uploaded here?
 *
 * A scan is a PDF whatever it was photographed with, so this asks about PDFs
 * rather than about cameras. The two questions genuinely differ: the payslip
 * dialog takes both, the documents shelf takes both, and a site that only wants
 * a picture of a person takes one and not the other.
 */
export function admitsPdf(accept: string | undefined): boolean {
	if (!accept) return false;
	return entries(accept).some((entry) => entry === 'application/pdf' || entry === '.pdf');
}
