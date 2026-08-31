// SPDX-License-Identifier: AGPL-3.0-or-later
// The reader's entry point: a file arrives, something works out what it is, and
// what it says becomes rows.
//
// Everything else in here is imported by its own path on purpose. A
// `export *` barrel over all nineteen modules would pull the OCR and PDF stacks
// into every caller, including those that only wanted a type.
export { detectAndParseAll } from './detect';
export { ingestFile } from './ingest';
