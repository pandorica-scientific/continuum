// Signature counters detect cloned authenticators — but only some hardware
// reports them. Synced passkeys (iCloud Keychain, and most platform
// authenticators) always send 0, so a clone is detectable only when both the
// stored and the incoming value are non-zero.
//
// This is the only counter policy in force. @simplewebauthn/server has its own,
// stricter rule — it rejects a non-increasing counter whenever *either* side is
// non-zero — which would refuse the synced-passkey case this exists to permit,
// and which fired first and made everything below unreachable. login/verify
// therefore hands the library a counter of 0 to stand its check down.

export function isCloneSignal(stored: number, incoming: number): boolean {
	if (stored === 0 || incoming === 0) return false;
	return incoming <= stored;
}
