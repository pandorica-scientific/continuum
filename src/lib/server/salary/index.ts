// SPDX-License-Identifier: AGPL-3.0-or-later
// The salary module's public surface. Each half in its own file: `entries` is
// salary as it is RECORDED, `history` assembles it for the screen, and `reader`
// pulls it out of a payslip PDF.
export * from './entries';
export * from './history';
export * from './reader';
