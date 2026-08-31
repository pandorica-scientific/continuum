import { createHash } from 'node:crypto';

/**
 * A stable uuid for a readable label.
 *
 * Ids became `uuid` in the v0.3.9 schema lock, so a fixture can no longer say
 * `id: 'person-a'`. Writing raw hex instead would cost every test its
 * legibility — `'11111111-1111-…'` says nothing about what the row is — so
 * fixtures keep their names and this turns each one into the same uuid every
 * time.
 *
 * Derived from a hash rather than a counter, so two suites naming the same
 * thing get the same id and a suite's ids do not shift when one is added above
 * them. Version and variant bits are set, because the column is a real uuid and
 * will reject anything that is not.
 */
export function rowId(label: string): string {
	const h = createHash('sha256').update(label).digest();
	h[6] = (h[6] & 0x0f) | 0x50; // version 5: named, not random
	h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
	const hex = h.subarray(0, 16).toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
