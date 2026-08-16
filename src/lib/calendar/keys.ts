// Stable identity for calendar events, on both sides of a sync.
//
// Two-way sync needs an id that survives everything: a restart, a rebuilt link
// table, a full reconcile after a provider invalidates our cursor. Authored
// events have a UUID. Generated events have no row at all — they are recomputed
// from loans, tenancies and documents on every request — so their identity has
// to be DERIVED from what produced them, deterministically, or the same mortgage
// payment would look like a new event every pass and pile up duplicates.

/**
 * The ledger row a generated event came from.
 *
 * Two jobs, which is why it is one object: it tells write-back which field a
 * remote date move should update, and it tells the marker code which module owns
 * the event (loan → Loans, tenancy → Property, document → Documents). Rules with
 * no row behind them — the import reminder, the quarterly report — have no
 * binding, and correctly cannot be written back to.
 */
export interface OriginBinding {
	// loanFixationPeriod is listed for IDENTITY, not for write-back. A fixation
	// end and a document expiry both come from the `expiry` rule, so without a
	// distinct table name their keys would collide. Whether a bound field may be
	// written back is decided separately, and fixation dates are not: moving one
	// re-cuts the interest schedule, which is not a thing a calendar drag should
	// mean.
	table: 'loan' | 'loanFixationPeriod' | 'tenancy' | 'document';
	rowId: string;
	field: string;
}

/**
 * The stable local key of a generated event.
 *
 * Built from the binding rather than the rule alone, because `expiry` covers
 * lease ends, fixation ends, passports and policies at once: keyed on the rule
 * only, a tenancy end and a document expiry would collide and overwrite each
 * other on every sync.
 */
export function generatedKey(
	ruleKey: string,
	binding: OriginBinding | null,
	month?: string
): string {
	const parts = ['gen', ruleKey];
	// The FIELD is part of the identity, not just the row. One tenancy produces
	// both a lease-end event and a renewal-notice event from the same rule and the
	// same row; keyed on the row alone they collide, and the published feed
	// carries two events under one UID — which is how a subscriber ends up seeing
	// only one of them.
	if (binding) parts.push(binding.table, binding.rowId, binding.field);
	if (month) parts.push(month);
	return parts.join(':');
}

// RFC 4648 base32hex, lowercase. Google requires event ids to use exactly this
// alphabet, be at least 5 characters, and at most 1024.
const B32HEX = '0123456789abcdefghijklmnopqrstuv';
const MIN_LENGTH = 5;
const MAX_LENGTH = 1024;

function encodeBase32Hex(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32HEX[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32HEX[(value << (5 - bits)) & 31];
	return out;
}

/**
 * A 64-bit FNV-1a digest, as base32hex.
 *
 * Only reached by the overflow path below. Deliberately not a cryptographic
 * hash: nothing here is a secret, this file stays free of node:crypto so it can
 * run in the browser too, and FNV-1a is deterministic across engines, which is
 * the only property that matters for an identifier.
 */
function digest(input: string): string {
	let high = 0xcbf2_9ce4;
	let low = 0x8422_2325;
	for (let i = 0; i < input.length; i++) {
		low ^= input.charCodeAt(i) & 0xff;
		// 64-bit FNV prime (0x100000001b3) via 32-bit halves.
		const lowMul = Math.imul(low, 0x1b3) >>> 0;
		const carry = Math.floor((low * 0x1b3) / 0x1_0000_0000);
		high = (Math.imul(high, 0x1b3) + Math.imul(low, 0x1_0000) + carry) >>> 0;
		low = lowMul;
	}
	const bytes = new Uint8Array(8);
	for (let i = 0; i < 4; i++) {
		bytes[i] = (high >>> (24 - i * 8)) & 0xff;
		bytes[4 + i] = (low >>> (24 - i * 8)) & 0xff;
	}
	return encodeBase32Hex(bytes);
}

/**
 * The remote id for a local key.
 *
 * Deterministic, so the mapping in `calendar_sync_link` is a cache and not the
 * source of truth — if that table is lost, a full reconcile recomputes the same
 * ids and re-attaches to the existing remote events instead of creating a second
 * copy of every one.
 */
export function toRemoteId(localKey: string): string {
	const encoded = encodeBase32Hex(new TextEncoder().encode(localKey));

	// base32hex expands 8 bits into 5, so the encoding is 1.6× the input. Real
	// keys are ~55 characters (rule name, table, a UUID, a month) and encode to
	// ~90, nowhere near the limit. This branch exists so an unforeseen long key
	// yields a legal id rather than one Google rejects at the API boundary.
	if (encoded.length > MAX_LENGTH) return `v${digest(localKey)}`;

	return encoded.padEnd(MIN_LENGTH, '0');
}
