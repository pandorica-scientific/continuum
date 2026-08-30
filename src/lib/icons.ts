// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The icon set, drawn as inline SVG primitives.
//
// No library and no CDN: this ships as a self-hosted package, so the icons are
// data in the bundle rather than a font or a fetch. Every icon is authored on a
// 24 viewBox with no fill, `currentColor` stroke, 1.7 width and round caps —
// change those in Icon.svelte, not here.
//
// Primitives rather than raw markup so nothing needs `{@html}` and a typo in a
// path cannot inject anything.

export type IconPrimitive =
	| { path: string }
	| { circle: [cx: number, cy: number, r: number] }
	| { rect: [x: number, y: number, w: number, h: number, r: number] }
	| { line: [x1: number, y1: number, x2: number, y2: number] };

export const ICONS = {
	// Areas and screens
	compass: [{ circle: [12, 12, 9] }, { path: 'M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z' }],
	flow: [{ path: 'M3 12h5l4-7h9' }, { path: 'M8 12l4 7h9' }, { path: 'M18 2.5 21 5l-3 2.5' }],
	bank: [
		{ path: 'M3 10 12 4.5 21 10' },
		{ line: [5.5, 10.5, 5.5, 18] },
		{ line: [12, 10.5, 12, 18] },
		{ line: [18.5, 10.5, 18.5, 18] },
		{ line: [3, 20.5, 21, 20.5] }
	],
	ledger: [
		{ path: 'M5 4.8A1.8 1.8 0 0 1 6.8 3H19v18H6.8A1.8 1.8 0 0 1 5 19.2z' },
		{ line: [9, 3, 9, 21] }
	],
	receipt: [
		{ path: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z' },
		{ line: [9, 8, 15, 8] },
		{ line: [9, 12, 15, 12] }
	],
	inbox: [
		{ line: [12, 3, 12, 13] },
		{ path: 'M8 9.5l4 4 4-4' },
		{ path: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }
	],
	sliders: [
		{ line: [3.5, 8, 20.5, 8] },
		{ circle: [9, 8, 2.2] },
		{ line: [3.5, 16, 20.5, 16] },
		{ circle: [15, 16, 2.2] }
	],
	tag: [
		{ path: 'M3 12.6V4.4A1.4 1.4 0 0 1 4.4 3h8.2L21 11.4 12.6 21z' },
		{ circle: [7.6, 7.6, 1.5] }
	],
	buildings: [
		{ path: 'M4 21V8.5L11 5v16' },
		{ path: 'M11 21V11l8-2.5V21' },
		{ line: [3, 21, 21, 21] },
		{ line: [7, 10.5, 7.8, 10.5] },
		{ line: [14.5, 14, 15.3, 14] }
	],
	chart: [{ path: 'M4 16l4.5-4.5 3 3L18 8' }, { path: 'M14.5 8H18v3.5' }, { path: 'M3 3v17h18' }],
	card: [
		{ rect: [2.5, 5, 19, 14, 2.5] },
		{ line: [2.5, 10, 21.5, 10] },
		{ line: [6, 14.5, 10, 14.5] }
	],
	// A wallet, for Salary. Distinct from `card` (Loans) and `bank` (Accounts):
	// the flap and the stud read as something money arrives INTO, which is what
	// separates it from the two icons it sits nearest in the sidebar.
	wallet: [
		{ rect: [2.5, 6, 19, 13, 2.5] },
		{ path: 'M2.5 9.5h12A1.5 1.5 0 0 1 16 11v3a1.5 1.5 0 0 1-1.5 1.5h-12' },
		{ circle: [17.5, 12.5, 1.1] }
	],
	target: [{ circle: [12, 12, 9] }, { circle: [12, 12, 5] }, { circle: [12, 12, 1.4] }],
	house: [{ path: 'M3 10.6 12 3.5l9 7.1' }, { path: 'M5.6 9.6V20.5h12.8V9.6' }],
	calendar: [
		{ rect: [3, 5, 18, 16, 2.5] },
		{ line: [3, 10, 21, 10] },
		{ line: [8, 3, 8, 7] },
		{ line: [16, 3, 16, 7] }
	],
	folders: [
		{
			path: 'M3 7.6A1.6 1.6 0 0 1 4.6 6H9l2.2 2.6h8.2A1.6 1.6 0 0 1 21 10.2v8.2A1.6 1.6 0 0 1 19.4 20H4.6A1.6 1.6 0 0 1 3 18.4z'
		}
	],
	// A ring with a stem and a dot, rather than a glyph "i": drawn as strokes it
	// stays legible at 14px and matches the weight of every other icon here.
	info: [{ circle: [12, 12, 9] }, { line: [12, 11, 12, 16.5] }, { line: [12, 7.8, 12, 8.2] }],
	// Two figures rather than one: a single head-and-shoulders reads as "my
	// profile", and this list is other people, not the person looking at it.
	// The second figure is drawn as two open arcs so it stays legible at 18px
	// without becoming a smudge behind the first.
	people: [
		{ circle: [9.2, 8.4, 3.1] },
		{ path: 'M3.6 19.4a5.6 5.6 0 0 1 11.2 0' },
		{ path: 'M15.6 5.7a3.1 3.1 0 0 1 0 5.4' },
		{ path: 'M17.2 13.6a5.6 5.6 0 0 1 3.2 5.8' }
	],
	gear: [
		{ circle: [12, 12, 2.4] },
		{ circle: [12, 12, 5.6] },
		{ line: [17.6, 12.0, 20.4, 12.0] },
		{ line: [15.96, 15.96, 17.94, 17.94] },
		{ line: [12.0, 17.6, 12.0, 20.4] },
		{ line: [8.04, 15.96, 6.06, 17.94] },
		{ line: [6.4, 12.0, 3.6, 12.0] },
		{ line: [8.04, 8.04, 6.06, 6.06] },
		{ line: [12.0, 6.4, 12.0, 3.6] },
		{ line: [15.96, 8.04, 17.94, 6.06] }
	],

	// Actions
	plus: [{ line: [12, 5.5, 12, 18.5] }, { line: [5.5, 12, 18.5, 12] }],
	clock: [{ circle: [12, 12, 8.5] }, { path: 'M12 7.2V12l3.2 2' }],

	// Scan flow
	camera: [
		{
			path: 'M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.3-2h8l1.3 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z'
		},
		{ circle: [12, 13, 3.4] }
	],
	bolt: [{ path: 'M13 2.5 5.5 13.5H11l-1 8 8.5-11H13z' }],
	// Corner brackets around a page: the shape every scanner app uses, and
	// readable at 18px in a way a camera-with-a-document is not.
	scan: [
		{ path: 'M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7' },
		{ path: 'M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8' },
		{ path: 'M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17' },
		{ path: 'M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16' },
		{ line: [3, 12, 21, 12] }
	],
	rotate: [{ path: 'M20 12a8 8 0 1 1-2.6-5.9' }, { path: 'M20 3.5V8h-4.5' }],
	// Six dots, not three lines: a grip that reads as a drag handle rather than
	// as a menu, which three stacked lines always will.
	grip: [
		{ circle: [9, 6, 1.1] },
		{ circle: [15, 6, 1.1] },
		{ circle: [9, 12, 1.1] },
		{ circle: [15, 12, 1.1] },
		{ circle: [9, 18, 1.1] },
		{ circle: [15, 18, 1.1] }
	],
	check: [{ path: 'M4.5 12.5 9.5 17.5 19.5 6.5' }],

	// Documents
	//
	// A closed padlock, and it stays closed: an open one reads as "unlocked",
	// which is the opposite of what a restricted document is. Shown quietly, to
	// an admin only — restricted is an access state, never a warning.
	lock: [{ rect: [5, 10.5, 14, 10, 2] }, { path: 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3' }],
	// Edit mode on the shelf rail: reorder, rename, remove.
	pencil: [{ path: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z' }, { path: 'M13.5 6.5l3 3' }],
	// A magnifier whose handle leaves the circle at 45°, so it reads at 16px.
	search: [{ circle: [11, 11, 6.5] }, { line: [15.8, 15.8, 20, 20] }],
	arrowUp: [{ line: [12, 20, 12, 4] }, { path: 'M6 10l6-6 6 6' }],
	arrowDown: [{ line: [12, 4, 12, 20] }, { path: 'M18 14l-6 6-6-6' }],

	// Overview board and briefing
	//
	// These sit at 14px on an uppercase eyebrow, beside the panel's own title,
	// so each one only has to be tellable from its neighbours on the same board
	// — it never has to be read on its own.
	bell: [
		{ path: 'M6.5 10a5.5 5.5 0 0 1 11 0c0 4.3 1.1 5.7 1.9 6.5H4.6c.8-.8 1.9-2.2 1.9-6.5z' },
		{ path: 'M10 19.4a2.2 2.2 0 0 0 4 0' }
	],
	// Three plates, for what a total is made of.
	layers: [
		{ path: 'M12 3.5 21 8l-9 4.5L3 8z' },
		{ path: 'M3 12l9 4.5L21 12' },
		{ path: 'M3 16l9 4.5L21 16' }
	],
	// Two short discs leaning on each other rather than one tall drum: a single
	// column of stacked rims is the database glyph, and that is a hard thing to
	// unsee once someone has noticed it sitting on a savings panel.
	coins: [
		{ path: 'M4 7.5a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0' },
		{ path: 'M4 7.5v2.4a6.5 2.6 0 0 0 13 0V7.5' },
		{ path: 'M7 14a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0' },
		{ path: 'M7 14v2.4a6.5 2.6 0 0 0 13 0V14' }
	],
	// Bars against a baseline, for one group measured against another. `chart`
	// is the line that means a course over time; this is a comparison, which is
	// what the overspend briefing card actually says.
	bars: [
		{ line: [3.5, 20.5, 20.5, 20.5] },
		{ line: [7.5, 20.5, 7.5, 14] },
		{ line: [12, 20.5, 12, 9] },
		{ line: [16.5, 20.5, 16.5, 5.5] }
	],
	// The rising line WITHOUT `chart`'s axes. Net worth and the portfolio sit on
	// the same board, so the two cannot both be a line in a frame.
	trend: [{ path: 'M3 16.5 9 10.5l3.5 3.5L21 5.5' }, { path: 'M15 5.5h6v6' }],
	key: [
		{ circle: [7.6, 16.4, 3.9] },
		{ line: [10.4, 13.6, 20.5, 3.5] },
		{ line: [17.6, 6.4, 19.6, 8.4] },
		{ line: [14.8, 9.2, 16.8, 11.2] }
	],
	// `info`'s stem and dot inside a triangle rather than a ring. The shape has
	// to carry the warning by itself: hue is a second channel, not the only one.
	alert: [
		{ path: 'M12 4.2 21 19.8H3z' },
		{ line: [12, 10.5, 12, 15] },
		{ line: [12, 17.6, 12, 17.8] }
	]
} as const satisfies Record<string, readonly IconPrimitive[]>;

export type IconName = keyof typeof ICONS;
