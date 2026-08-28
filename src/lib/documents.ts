// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the documents screen and its form share that is not shelf-shaped.
//
// `SHELVES` used to live here: ten keys and labels the screen, the form and the
// CHECK constraint all had to agree about. Shelves are rows now — see
// `src/lib/server/documents/shelves.ts` — so the list is loaded, not compiled.

import { ENUMS } from '$lib/enums';

/** Derived, so the document form and the CHECK on document.expiry_verb agree. */
export const EXPIRY_VERBS = ENUMS['document.expiry_verb'];
