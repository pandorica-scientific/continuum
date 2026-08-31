// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The hues a traffic-light pill can take.
 *
 * Green, amber and red always mean state — good, watch, bad — and are never
 * decorative. Blue, teal and purple carry a data series; grey is neutral.
 *
 * This lived inside Pill.svelte until the Overview panels needed to name the
 * same set in their own props. A type is not importable from a component, and
 * two copies of a seven-member union drift.
 */
export type Hue = 'green' | 'yellow' | 'red' | 'blue' | 'teal' | 'purple' | 'grey';
