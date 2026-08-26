/**
 * Split opencv.js into a small loader and a separate .wasm file.
 *
 * `@techstark/opencv-js` ships one 10.4 MB JavaScript file with the entire
 * 7.6 MB WebAssembly module inlined as a base64 `data:` URI. That is fatal in a
 * browser for two reasons, and the second one is not obvious:
 *
 *   1. Bundling it means 10 MB of JavaScript to parse before anything runs.
 *   2. Emscripten explicitly SKIPS `WebAssembly.instantiateStreaming` when the
 *      binary is a data URI (`!isDataURI(wasmBinaryFile)` guards the branch), so
 *      the module can never stream-compile — it must decode 10.6 million base64
 *      characters and compile the result in one go.
 *
 * Bundled through Vite that combination does not merely run slowly: it never
 * finishes, and the tab locks up with no error to read. Measured, split into
 * these two files, the same OpenCV is ready in ~245 ms and the main thread stays
 * responsive throughout.
 *
 * Runs at BUILD time, never at import time — the same rule fetch-tessdata.mjs
 * follows. Nothing here reaches the network: the bytes come from node_modules.
 *
 *   npm run prepare:opencv
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'node_modules/@techstark/opencv-js/dist/opencv.js';
const DIRECTORY = join('static', 'opencv');
/**
 * A BARE FILENAME, not a path.
 *
 * Emscripten resolves this through `locateFile`, which prepends the directory
 * the loader script was served from. Give it `/opencv/opencv.wasm` and it asks
 * for `/opencv//opencv/opencv.wasm` — a 404 whose HTML error page it then tries
 * to compile as WebAssembly, reporting only "HTTP status code is not ok".
 * A bare name resolves to the binary sitting beside the loader, which is the
 * arrangement Emscripten expects.
 */
const WASM_URL = 'opencv.wasm';

const DATA_URI = /wasmBinaryFile\s*=\s*"(data:application\/octet-stream;base64,([A-Za-z0-9+/=]+))"/;

const source = await readFile(SOURCE, 'utf8');
const match = DATA_URI.exec(source);
if (!match) {
	console.error(
		`No inlined wasm found in ${SOURCE}.\n` +
			'The package may have changed shape — check whether it now ships a separate\n' +
			'.wasm, in which case this script can simply copy it instead.'
	);
	process.exit(1);
}

const wasm = Buffer.from(match[2], 'base64');
if (wasm.subarray(0, 4).toString('binary') !== '\0asm') {
	console.error('The extracted bytes are not a WebAssembly module.');
	process.exit(1);
}

// Point the loader at the file instead of the blob. This one substitution is
// also what re-enables streaming compilation, because the data-URI guard in
// `instantiateAsync` stops matching.
const loader = source.slice(0, match.index) + source.slice(match.index).replace(match[1], WASM_URL);

await mkdir(DIRECTORY, { recursive: true });
await writeFile(join(DIRECTORY, 'opencv.wasm'), wasm);
await writeFile(join(DIRECTORY, 'opencv.js'), loader);

const mb = async (name) => ((await stat(join(DIRECTORY, name))).size / 1024 / 1024).toFixed(2);
console.log(
	`OpenCV ready in ${DIRECTORY}/ — opencv.js ${await mb('opencv.js')} MB, ` +
		`opencv.wasm ${await mb('opencv.wasm')} MB ` +
		`(from one ${(source.length / 1024 / 1024).toFixed(1)} MB file).`
);
