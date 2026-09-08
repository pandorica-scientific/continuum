// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Bundle the scan child into one file the runtime image actually has.
 *
 * The child is a SEPARATE NODE PROCESS, so nothing SvelteKit does for the
 * server bundle reaches it: no `$lib` alias, no TypeScript, no module graph. And
 * `src/` is not copied into the runtime image — only `build/`, `node_modules`,
 * `drizzle` and `tessdata` are — so the child cannot load its own sources
 * there either.
 *
 * Hence one self-contained CommonJS bundle in `build/`, which travels with the
 * image for free. This step replaces `prepare-opencv.mjs`, which used to split
 * OpenCV out for the BROWSER to load; nothing in the browser loads it any more.
 *
 * CommonJS on purpose. `await import('@techstark/opencv-js')` under node hangs
 * with no error, so the child reaches OpenCV through `createRequire` — which
 * needs a module format where that is meaningful.
 */
// esbuild is NOT a direct devDependency, and cannot be: package.json already
// carries an `overrides` entry pinning it to >=0.25.0 as a security floor, and
// npm refuses a direct dependency on a package it is overriding. It arrives
// through vite, which cannot build without it, and the override guarantees the
// version. Adding it directly means removing that override first — which would
// trade a security floor for a tidier dependency list.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
	entryPoints: [`${root}src/lib/server/scan/worker/entry.ts`],
	outfile: `${root}build/scan-worker.cjs`,
	bundle: true,
	platform: 'node',
	// Matches the `node:26-alpine` the image is built on and the engines the
	// project already targets.
	target: 'node22',
	format: 'cjs',
	// These three are found in node_modules at runtime and must NOT be inlined.
	// OpenCV is 10 MB with 7.6 MB of base64 WebAssembly inside it, mupdf ships
	// its own .wasm beside itself, and libheif is an Emscripten build that
	// resolves its .wasm relative to its own file.
	external: ['@techstark/opencv-js', 'mupdf', 'libheif-js'],
	alias: { $lib: `${root}src/lib` },
	logLevel: 'info'
});
