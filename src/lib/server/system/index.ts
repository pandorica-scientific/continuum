// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The machinery every domain uses and none of them owns: what a password must
// look like, where an uploaded file lives, what the instance reports about
// itself, how settings travel in and out, and the demo household.
//
// Kept apart from the domains so that "where does this belong?" has an answer
// for code that belongs to no domain — which is how twenty loose files
// accumulated at the level above.
export * from './policy';
export * from './files';
export * from './status';
export * from './config-file';
export * from './demo';
