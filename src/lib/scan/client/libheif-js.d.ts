// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// libheif-js ships no types. Declared here rather than pulled from DefinitelyTyped
// so the engine stays self-contained, and narrowly: only the three calls the
// decoder actually makes, so a wrong assumption shows up as a type error rather
// than as an `any` that compiles and throws at runtime.
declare module 'libheif-js' {
	interface HeifImage {
		get_width(): number;
		get_height(): number;
		/** A HEIC can hold several images — a burst, a Live Photo still. */
		is_primary?(): boolean;
		display(target: ImageData, done: (result: unknown) => void): void;
	}

	interface HeifDecoder {
		decode(bytes: Uint8Array): HeifImage[];
	}

	const libheif: { HeifDecoder: new () => HeifDecoder };
	export default libheif;
}
