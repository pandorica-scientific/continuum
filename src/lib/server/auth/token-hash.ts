// SPDX-License-Identifier: AGPL-3.0-or-later
// One definition of how an opaque bearer token becomes a database key.
//
// Sessions, API tokens and enrollment links are all handed out once as random
// bytes and stored only as sha256(raw), so a database dump hands nobody a
// working credential. One symbol so the three can never drift apart.

import { createHash } from 'node:crypto';

export function hashToken(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}
