// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The salary module's public surface. Each half in its own file: `entries` is
// salary as it is RECORDED, `history` assembles it for the screen, and `reader`
// pulls it out of a payslip PDF.
export * from './entries';
export * from './history';
export * from './reader';
