// One definition of how an opaque bearer token becomes a database key.
//
// Sessions, API tokens and enrollment links are all handed out once as random
// bytes and stored only as sha256(raw), so a database dump hands nobody a
// working credential. Each of the three used to carry its own private copy of
// this line while its comment claimed to match the others — which meant nothing
// stopped one of them being changed, a different digest or an added pepper,
// while the other two quietly stayed as they were. There is now a single symbol
// to grep for, and changing it changes all three together.

import { createHash } from 'node:crypto';

export function hashToken(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}
