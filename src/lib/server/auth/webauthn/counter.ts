// Signature counters detect cloned authenticators — but only some hardware
// reports them. Synced passkeys (iCloud Keychain, and most platform
// authenticators) always send 0, so a clone is detectable only when both the
// stored and the incoming value are non-zero.

export function isCloneSignal(stored: number, incoming: number): boolean {
	if (stored === 0 || incoming === 0) return false;
	return incoming <= stored;
}
