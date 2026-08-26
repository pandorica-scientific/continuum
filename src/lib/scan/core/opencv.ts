// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The OpenCV handle.
//
// This module does NOT load OpenCV. The import is type-only and therefore
// erased, so nothing here pulls the WebAssembly into a bundle — which is what
// keeps `core` free of the DOM and free of a 10 MB dependency. Loading lives in
// `client/opencv-load.ts`, because it needs a document.

import type cv from '@techstark/opencv-js';

export type CV = typeof cv;
