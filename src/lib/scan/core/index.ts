// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The isomorphic half of the scan engine: everything that needs no DOM.
//
// Nothing here may import a canvas, a File, or anything else the browser owns —
// that is what lets the pipeline and its memory discipline be tested under node.
//
// Relative imports carry their `.ts` extension. Node resolves ESM by exact
// filename and this barrel is loaded by `npm run test:scan` under plain node;
// TypeScript accepts it via `rewriteRelativeImportExtensions`, already set in
// tsconfig.json, and Vite resolves it unchanged.
export * from './types.ts';
export { loadCv, heapBytes, allocMark, type CV } from './opencv.ts';
export { withMats, type Arena, type Disposable } from './arena.ts';
