// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The hues a traffic-light pill can take.
 *
 * Green, amber and red always mean state — good, watch, bad — and are never
 * decorative. Blue, teal and purple carry a data series; grey is neutral.
 *
 * Kept as a standalone type, importable outside `Pill.svelte`, since Svelte
 * components can't export types other files can import.
 */
export type Hue = 'green' | 'yellow' | 'red' | 'blue' | 'teal' | 'purple' | 'grey';
